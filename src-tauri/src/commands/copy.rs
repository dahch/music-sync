use music_sync_copy_engine::{CopyEngine, CopyItem, CopyItemResult};
use std::path::PathBuf;
use tauri::Emitter;

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

    let (progress_tx, mut progress_rx) = tokio::sync::mpsc::unbounded_channel();

    let emit_app = app.clone();
    tokio::spawn(async move {
        while let Some(progress) = progress_rx.recv().await {
            let _ = emit_app.emit("copy:progress", &progress);
        }
        let _ = emit_app.emit("copy:done", ());
    });

    let engine = CopyEngine::new();
    let results = engine
        .execute(
            &PathBuf::from(&source_root),
            &PathBuf::from(&destination_root),
            &items,
            progress_tx,
        )
        .await;

    Ok(results)
}
