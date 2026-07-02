use music_sync_copy_engine::{CopyController, CopyEngine, CopyHandle, CopyItem, CopyItemResult, CopyProgress};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Emitter;

/// Shared access to the currently active copy controller, if any.
static ACTIVE_CONTROLLER: std::sync::OnceLock<Mutex<Option<CopyController>>> =
    std::sync::OnceLock::new();

fn active_controller() -> &'static Mutex<Option<CopyController>> {
    ACTIVE_CONTROLLER.get_or_init(|| Mutex::new(None))
}

/// Drop guard that clears the active controller on drop (normal return or panic).
struct ClearController;

impl Drop for ClearController {
    fn drop(&mut self) {
        *active_controller().lock().unwrap() = None;
    }
}

/// Core copy logic extracted for testing without Tauri runtime.
#[allow(dead_code)]
pub async fn copy_files_inner(
    source_root: &str,
    destination_root: &str,
    items: &[CopyItem],
    handle: &CopyHandle,
) -> Result<Vec<CopyItemResult>, String> {
    if items.is_empty() {
        return Ok(Vec::new());
    }

    let (progress_tx, _progress_rx) =
        tokio::sync::mpsc::unbounded_channel::<CopyProgress>();

    let engine = CopyEngine::new();
    let results = engine
        .execute(
            &PathBuf::from(source_root),
            &PathBuf::from(destination_root),
            items,
            progress_tx,
            handle,
        )
        .await;

    Ok(results)
}

/// Clean up orphaned `.musicsync.tmp` files in a directory tree.
/// Called at app startup to remove leftovers from interrupted copies.
pub fn cleanup_tmp_files(root: &str) -> Result<(), String> {
    music_sync_copy_engine::cleanup_tmp_files(Path::new(root))
        .map_err(|e| format!("tmp cleanup failed: {}", e))
}

#[tauri::command]
pub async fn copy_files(
    app: tauri::AppHandle,
    source_root: String,
    destination_root: String,
    items: Vec<CopyItem>,
) -> Result<Vec<CopyItemResult>, String> {
    if items.is_empty() {
        return Ok(Vec::new());
    }

    // Clean up orphaned .tmp files from previous interrupted copies
    let _ = cleanup_tmp_files(&destination_root);

    let (progress_tx, mut progress_rx) =
        tokio::sync::mpsc::unbounded_channel::<CopyProgress>();

    let emit_app = app.clone();
    tokio::spawn(async move {
        while let Some(progress) = progress_rx.recv().await {
            let _ = emit_app.emit("copy:progress", &progress);
        }
        let _ = emit_app.emit("copy:done", ());
    });

    let (handle, controller) = CopyHandle::new_pair();

    // Store controller for pause/resume/cancel access from other commands
    {
        let mut guard = active_controller().lock().unwrap();
        *guard = Some(controller);
    }

    // Drop guard clears the controller even if execute() panics
    let _clear = ClearController;

    let engine = CopyEngine::new();
    let results = engine
        .execute(
            &PathBuf::from(&source_root),
            &PathBuf::from(&destination_root),
            &items,
            progress_tx,
            &handle,
        )
        .await;

    Ok(results)
}

#[tauri::command]
pub async fn pause_copy() -> Result<(), String> {
    let guard = active_controller().lock().unwrap();
    match guard.as_ref() {
        Some(ctrl) => {
            ctrl.pause();
            Ok(())
        }
        None => Err("No active copy in progress".into()),
    }
}

#[tauri::command]
pub async fn resume_copy() -> Result<(), String> {
    let guard = active_controller().lock().unwrap();
    match guard.as_ref() {
        Some(ctrl) => {
            ctrl.resume();
            Ok(())
        }
        None => Err("No active copy in progress".into()),
    }
}

#[tauri::command]
pub async fn cancel_copy() -> Result<(), String> {
    let guard = active_controller().lock().unwrap();
    match guard.as_ref() {
        Some(ctrl) => {
            ctrl.cancel();
            Ok(())
        }
        None => Err("No active copy in progress".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn empty_items_returns_empty_vec() {
        let (handle, _ctrl) = CopyHandle::new_pair();
        let result = copy_files_inner("/tmp/src", "/tmp/dst", &[], &handle).await;
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn copies_single_file() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();
        let (handle, _ctrl) = CopyHandle::new_pair();

        std::fs::write(src_dir.path().join("song.flac"), b"audio data").unwrap();

        let items = vec![CopyItem {
            relative_path: PathBuf::from("song.flac"),
            verify: false,
        }];

        let results = copy_files_inner(
            &src_dir.path().to_string_lossy(),
            &dst_dir.path().to_string_lossy(),
            &items,
            &handle,
        )
        .await
        .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].relative_path, PathBuf::from("song.flac"));

        let dst_content = std::fs::read(dst_dir.path().join("song.flac")).unwrap();
        assert_eq!(dst_content, b"audio data");
    }

    #[tokio::test]
    async fn copies_multiple_files() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();
        let (handle, _ctrl) = CopyHandle::new_pair();

        std::fs::write(src_dir.path().join("a.flac"), b"aaa").unwrap();
        std::fs::write(src_dir.path().join("b.flac"), b"bbb").unwrap();

        let items = vec![
            CopyItem {
                relative_path: PathBuf::from("a.flac"),
                verify: false,
            },
            CopyItem {
                relative_path: PathBuf::from("b.flac"),
                verify: false,
            },
        ];

        let results = copy_files_inner(
            &src_dir.path().to_string_lossy(),
            &dst_dir.path().to_string_lossy(),
            &items,
            &handle,
        )
        .await
        .unwrap();

        assert_eq!(results.len(), 2);
        assert_eq!(
            results[0].status,
            music_sync_domain::CopyStatus::Done
        );
    }

    #[tokio::test]
    async fn missing_source_returns_error_per_item() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();
        let (handle, _ctrl) = CopyHandle::new_pair();

        let items = vec![CopyItem {
            relative_path: PathBuf::from("nonexistent.flac"),
            verify: false,
        }];

        let results = copy_files_inner(
            &src_dir.path().to_string_lossy(),
            &dst_dir.path().to_string_lossy(),
            &items,
            &handle,
        )
        .await
        .unwrap();

        assert_eq!(results.len(), 1);
        assert!(
            matches!(
                &results[0].status,
                music_sync_domain::CopyStatus::Failed(_)
            ),
            "expected Failed status, got {:?}",
            results[0].status
        );
    }
}
