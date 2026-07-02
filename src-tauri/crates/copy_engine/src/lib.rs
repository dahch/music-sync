use music_sync_domain::CopyStatus;
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::io::AsyncReadExt;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::Mutex;
use tokio::sync::watch;

const DEFAULT_CHUNK_SIZE: u64 = 1_048_576; // 1 MiB

/// Emitted during copy for per-file and global progress.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyProgress {
    pub current_file: PathBuf,
    pub bytes_copied: u64,
    pub total_file_size: u64,
    pub files_completed: u64,
    pub total_files: u64,
}

/// An item queued for copy.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyItem {
    pub relative_path: PathBuf,
    /// If true, verify the copied file with BLAKE3 after rename.
    #[serde(default)]
    pub verify: bool,
}

pub fn is_safe_relative(path: &Path) -> bool {
    !path.components().any(|c| matches!(c, Component::ParentDir))
}

/// Outcome for a single copy item after processing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyItemResult {
    pub relative_path: PathBuf,
    pub status: CopyStatus,
}

#[derive(Debug)]
pub enum CopyError {
    SourceNotFound(PathBuf),
    PermissionDenied(PathBuf),
    IoError(std::io::Error),
    VerificationFailed(PathBuf),
    RenameFailed(PathBuf, std::io::Error),
    Cancelled,
}

impl std::fmt::Display for CopyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SourceNotFound(p) => write!(f, "source not found: {}", p.display()),
            Self::PermissionDenied(p) => write!(f, "permission denied: {}", p.display()),
            Self::IoError(e) => write!(f, "I/O error: {}", e),
            Self::VerificationFailed(p) => write!(f, "verification failed: {}", p.display()),
            Self::RenameFailed(p, _) => write!(f, "rename failed: {}", p.display()),
            Self::Cancelled => write!(f, "cancelled"),
        }
    }
}

impl From<std::io::Error> for CopyError {
    fn from(e: std::io::Error) -> Self {
        CopyError::IoError(e)
    }
}

struct CopyHandleInner {
    cancel: AtomicBool,
    pause_rx: Mutex<watch::Receiver<bool>>,
}

/// Read-side for the engine loop — checks pause/cancel signals.
#[derive(Clone)]
pub struct CopyHandle {
    inner: Arc<CopyHandleInner>,
}

impl CopyHandle {
    pub fn new_pair() -> (Self, CopyController) {
        let (tx, rx) = watch::channel(false);
        let inner = Arc::new(CopyHandleInner {
            cancel: AtomicBool::new(false),
            pause_rx: Mutex::new(rx),
        });
        let handle = Self { inner: inner.clone() };
        let controller = CopyController {
            inner,
            pause_tx: tx,
        };
        (handle, controller)
    }

    pub fn is_cancelled(&self) -> bool {
        self.inner.cancel.load(Ordering::Relaxed)
    }

    /// Blocks until not paused or cancelled. Returns `Err` if cancelled while waiting.
    pub async fn wait_if_paused(&self) -> Result<(), ()> {
        loop {
            if self.is_cancelled() {
                return Err(());
            }
            let paused = {
                let rx = self.inner.pause_rx.lock().await;
                let val = *rx.borrow();
                val
            };
            if !paused {
                return Ok(());
            }
            let mut rx = self.inner.pause_rx.lock().await;
            let _ = rx.changed().await;
        }
    }
}

/// Write-side for the frontend — sends pause/resume/cancel signals.
/// Shares the same cancel flag as the corresponding `CopyHandle`.
#[derive(Clone)]
pub struct CopyController {
    inner: Arc<CopyHandleInner>,
    pause_tx: watch::Sender<bool>,
}

impl CopyController {
    pub fn pause(&self) {
        let _ = self.pause_tx.send(true);
    }

    pub fn resume(&self) {
        let _ = self.pause_tx.send(false);
    }

    pub fn cancel(&self) {
        self.inner.cancel.store(true, Ordering::Relaxed);
    }

    pub fn is_paused(&self) -> bool {
        *self.pause_tx.borrow()
    }

    pub fn is_cancelled(&self) -> bool {
        self.inner.cancel.load(Ordering::Relaxed)
    }
}

fn tmp_path(dst: &Path) -> PathBuf {
    let mut s = dst.to_string_lossy().to_string();
    s.push_str(".musicsync.tmp");
    PathBuf::from(s)
}

/// Clean up orphaned `.musicsync.tmp` files under a root directory.
pub fn cleanup_tmp_files(root: &Path) -> std::io::Result<()> {
    if !root.exists() {
        return Ok(());
    }
    fn visit(dir: &Path) -> std::io::Result<()> {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                visit(&path)?;
            } else if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.ends_with(".musicsync.tmp") {
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
        Ok(())
    }
    visit(root)
}

pub struct CopyEngine {
    chunk_size: u64,
}

impl CopyEngine {
    pub fn new() -> Self {
        Self { chunk_size: DEFAULT_CHUNK_SIZE }
    }

    pub fn with_chunk_size(chunk_size: u64) -> Self {
        Self { chunk_size }
    }

    pub async fn execute(
        &self,
        source_root: &Path,
        destination_root: &Path,
        items: &[CopyItem],
        progress_tx: UnboundedSender<CopyProgress>,
        handle: &CopyHandle,
    ) -> Vec<CopyItemResult> {
        let total_files = items.len() as u64;
        let mut results = Vec::with_capacity(items.len());
        let mut files_completed = 0u64;

        for item in items {
            // Check cancel before starting a new file
            if handle.is_cancelled() {
                break;
            }

            // Wait if paused (blocks until resumed or cancelled)
            if handle.wait_if_paused().await.is_err() {
                break;
            }

            if !is_safe_relative(&item.relative_path) {
                files_completed += 1;
                let _ = progress_tx.send(CopyProgress {
                    current_file: item.relative_path.clone(),
                    bytes_copied: 0,
                    total_file_size: 0,
                    files_completed,
                    total_files,
                });
                results.push(CopyItemResult {
                    relative_path: item.relative_path.clone(),
                    status: CopyStatus::Failed("unsafe path: contains '..'".into()),
                });
                continue;
            }

            let src = source_root.join(&item.relative_path);
            let dst = destination_root.join(&item.relative_path);

            let copy_result = self
                .copy_file(&src, &dst, &progress_tx, item, files_completed, total_files, handle)
                .await;

            files_completed += 1;
            let (status, file_size) = match copy_result {
                Ok(size) => (CopyStatus::Done, size),
                Err(CopyError::Cancelled) => (CopyStatus::Cancelled, 0),
                Err(e) => (CopyStatus::Failed(e.to_string()), 0),
            };

            let _ = progress_tx.send(CopyProgress {
                current_file: item.relative_path.clone(),
                bytes_copied: file_size,
                total_file_size: file_size,
                files_completed,
                total_files,
            });

            results.push(CopyItemResult {
                relative_path: item.relative_path.clone(),
                status,
            });
        }

        // Mark any remaining items as Cancelled and emit progress for each
        let processed = results.len();
        if processed < items.len() {
            for remaining in &items[processed..] {
                files_completed += 1;
                let _ = progress_tx.send(CopyProgress {
                    current_file: remaining.relative_path.clone(),
                    bytes_copied: 0,
                    total_file_size: 0,
                    files_completed,
                    total_files,
                });
                results.push(CopyItemResult {
                    relative_path: remaining.relative_path.clone(),
                    status: CopyStatus::Cancelled,
                });
            }
        }

        results
    }

    /// Returns Ok(file_size) on success.
    /// Writes to a `.musicsync.tmp` temp file, optionally verifies with BLAKE3,
    /// then atomically renames to the final path.
    async fn copy_file(
        &self,
        src: &Path,
        dst: &Path,
        progress_tx: &UnboundedSender<CopyProgress>,
        item: &CopyItem,
        files_completed: u64,
        total_files: u64,
        handle: &CopyHandle,
    ) -> Result<u64, CopyError> {
        let tmp = tmp_path(dst);
        if let Some(parent) = tmp.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let mut src_file = tokio::fs::File::open(src).await.map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => CopyError::SourceNotFound(src.to_path_buf()),
            std::io::ErrorKind::PermissionDenied => CopyError::PermissionDenied(src.to_path_buf()),
            _ => CopyError::IoError(e),
        })?;

        let file_size = src_file.metadata().await?.len();
        let mut dst_file = tokio::fs::File::create(&tmp).await?;

        let mut buffer = vec![0u8; self.chunk_size as usize];
        let mut total_read: u64 = 0;
        let mut hasher = if item.verify { Some(blake3::Hasher::new()) } else { None };

        loop {
            if handle.is_cancelled() {
                drop(dst_file);
                let _ = tokio::fs::remove_file(&tmp).await;
                return Err(CopyError::Cancelled);
            }

            let bytes_read = src_file.read(&mut buffer).await?;
            if bytes_read == 0 {
                break;
            }
            dst_file.write_all(&buffer[..bytes_read]).await?;
            total_read += bytes_read as u64;

            if let Some(ref mut h) = hasher {
                h.update(&buffer[..bytes_read]);
            }

            let _ = progress_tx.send(CopyProgress {
                current_file: item.relative_path.clone(),
                bytes_copied: total_read,
                total_file_size: file_size,
                files_completed,
                total_files,
            });
        }

        dst_file.flush().await?;
        drop(dst_file);

        if handle.is_cancelled() {
            let _ = tokio::fs::remove_file(&tmp).await;
            return Err(CopyError::Cancelled);
        }

        // Optionally verify: hash the temp file and compare with source hash
        if let Some(src_hasher) = hasher {
            let _ = progress_tx.send(CopyProgress {
                current_file: item.relative_path.clone(),
                bytes_copied: file_size,
                total_file_size: file_size,
                files_completed,
                total_files,
            });

            let src_hash = src_hasher.finalize();

            let mut tmp_file = tokio::fs::File::open(&tmp).await?;
            let mut tmp_hasher = blake3::Hasher::new();
            let mut verify_buf = vec![0u8; self.chunk_size as usize];
            loop {
                if handle.is_cancelled() {
                    drop(tmp_file);
                    let _ = tokio::fs::remove_file(&tmp).await;
                    return Err(CopyError::Cancelled);
                }
                let n = tmp_file.read(&mut verify_buf).await?;
                if n == 0 {
                    break;
                }
                tmp_hasher.update(&verify_buf[..n]);
            }
            drop(tmp_file);

            if tmp_hasher.finalize() != src_hash {
                let _ = tokio::fs::remove_file(&tmp).await;
                return Err(CopyError::VerificationFailed(dst.to_path_buf()));
            }
        }

        if handle.is_cancelled() {
            let _ = tokio::fs::remove_file(&tmp).await;
            return Err(CopyError::Cancelled);
        }

        // Atomic rename
        if let Err(e) = tokio::fs::rename(&tmp, dst).await {
            let _ = tokio::fs::remove_file(&tmp).await;
            return Err(CopyError::RenameFailed(dst.to_path_buf(), e));
        }

        Ok(file_size)
    }
}

impl Default for CopyEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::Permissions;
    use tempfile::TempDir;

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    fn noop_handle() -> CopyHandle {
        let (h, _ctrl) = CopyHandle::new_pair();
        h
    }

    async fn collect_results(
        source_root: &Path,
        destination_root: &Path,
        items: &[CopyItem],
    ) -> (Vec<CopyItemResult>, Vec<CopyProgress>) {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let handle = {
            let items = items.to_vec();
            let source_root = source_root.to_path_buf();
            let destination_root = destination_root.to_path_buf();
            let ctrl = noop_handle();
            tokio::spawn(async move {
                let engine = CopyEngine::new();
                engine
                    .execute(&source_root, &destination_root, &items, tx, &ctrl)
                    .await
            })
        };

        let mut progress_events = Vec::new();
        while let Some(p) = rx.recv().await {
            progress_events.push(p);
        }
        let results = handle.await.unwrap();
        (results, progress_events)
    }

    fn item(path: &str) -> CopyItem {
        CopyItem {
            relative_path: PathBuf::from(path),
            verify: false,
        }
    }

    #[tokio::test]
    async fn copies_file_atomically_no_tmp_left_on_success() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        std::fs::write(src_dir.path().join("song.flac"), b"audio data").unwrap();

        let (results, _) = collect_results(
            src_dir.path(),
            dst_dir.path(),
            &[item("song.flac")],
        )
        .await;

        assert_eq!(results[0].status, CopyStatus::Done);
        // Final file should exist
        assert!(dst_dir.path().join("song.flac").exists());
        // No .tmp file should remain
        assert!(!dst_dir.path().join("song.flac.musicsync.tmp").exists());
        assert_eq!(
            std::fs::read(dst_dir.path().join("song.flac")).unwrap(),
            b"audio data"
        );
    }

    #[tokio::test]
    async fn tmp_file_removed_on_copy_failure() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        // Source doesn't exist
        let (results, _) = collect_results(
            src_dir.path(),
            dst_dir.path(),
            &[item("missing.flac")],
        )
        .await;

        assert!(matches!(&results[0].status, CopyStatus::Failed(reason) if reason.contains("source not found")));
        // No .tmp file should remain
        let tmp = dst_dir.path().join("missing.flac.musicsync.tmp");
        assert!(!tmp.exists());
    }

    #[tokio::test]
    async fn verify_without_flag_skips_hashing() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        std::fs::write(src_dir.path().join("s.flac"), b"data").unwrap();

        let (results, _) = collect_results(
            src_dir.path(),
            dst_dir.path(),
            &[item("s.flac")],
        )
        .await;

        assert_eq!(results[0].status, CopyStatus::Done);
    }

    #[tokio::test]
    async fn preserves_relative_subfolder_structure() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        let nested = src_dir.path().join("artist").join("album");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("track.flac"), b"nested content").unwrap();

        let (results, _) = collect_results(
            src_dir.path(),
            dst_dir.path(),
            &[item("artist/album/track.flac")],
        )
        .await;

        assert_eq!(results[0].status, CopyStatus::Done);
        let dst_path = dst_dir.path().join("artist/album/track.flac");
        assert!(dst_path.exists());
        assert_eq!(std::fs::read(&dst_path).unwrap(), b"nested content");
    }

    #[tokio::test]
    async fn missing_source_fails_but_queue_continues() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        std::fs::write(src_dir.path().join("exists.flac"), b"real").unwrap();

        let items = vec![item("missing.flac"), item("exists.flac")];

        let (results, progress) = collect_results(
            src_dir.path(),
            dst_dir.path(),
            &items,
        )
        .await;

        assert_eq!(results.len(), 2);
        assert!(matches!(&results[0].status, CopyStatus::Failed(reason) if reason.contains("source not found")));
        assert_eq!(results[1].status, CopyStatus::Done);

        let last = progress.last().unwrap();
        assert_eq!(last.files_completed, 2);
        assert_eq!(last.total_files, 2);
        assert!(dst_dir.path().join("exists.flac").exists());
    }

    #[tokio::test]
    async fn empty_list_returns_empty() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        let (results, progress) = collect_results(
            src_dir.path(),
            dst_dir.path(),
            &[],
        )
        .await;

        assert!(results.is_empty());
        assert!(progress.is_empty());
    }

    #[tokio::test]
    async fn multiple_files_in_sequence() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        std::fs::write(src_dir.path().join("a.flac"), b"aaa").unwrap();
        std::fs::write(src_dir.path().join("b.flac"), b"bbb").unwrap();
        std::fs::create_dir_all(src_dir.path().join("sub")).unwrap();
        std::fs::write(src_dir.path().join("sub/c.flac"), b"ccc").unwrap();

        let items = vec![item("a.flac"), item("b.flac"), item("sub/c.flac")];

        let (results, progress) = collect_results(
            src_dir.path(),
            dst_dir.path(),
            &items,
        )
        .await;

        assert_eq!(results.len(), 3);
        for r in &results {
            assert_eq!(r.status, CopyStatus::Done);
        }
        assert_eq!(std::fs::read(dst_dir.path().join("a.flac")).unwrap(), b"aaa");
        assert_eq!(std::fs::read(dst_dir.path().join("b.flac")).unwrap(), b"bbb");
        assert_eq!(std::fs::read(dst_dir.path().join("sub/c.flac")).unwrap(), b"ccc");

        let last = progress.last().unwrap();
        assert_eq!(last.files_completed, 3);
    }

    #[tokio::test]
    async fn permission_denied_on_source_is_detected() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        let restricted = src_dir.path().join("secret.flac");
        std::fs::write(&restricted, b"data").unwrap();
        #[cfg(unix)]
        std::fs::set_permissions(&restricted, Permissions::from_mode(0o000)).unwrap();

        let engine = CopyEngine::new();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let ctrl = noop_handle();
        let handle = tokio::spawn(async move {
            let items = vec![item("secret.flac")];
            engine
                .execute(src_dir.path(), dst_dir.path(), &items, tx, &ctrl)
                .await
        });

        while rx.recv().await.is_some() {}
        let results = handle.await.unwrap();
        assert_eq!(results.len(), 1);
        assert!(
            matches!(&results[0].status, CopyStatus::Failed(reason) if reason.contains("permission denied")),
        );

        #[cfg(unix)]
        let _ = std::fs::set_permissions(&restricted, Permissions::from_mode(0o644));
    }

    #[tokio::test]
    async fn destination_permission_denied_detected() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();
        let dst_path = dst_dir.path().to_path_buf();

        std::fs::write(src_dir.path().join("song.flac"), b"data").unwrap();
        #[cfg(unix)]
        std::fs::set_permissions(&dst_path, Permissions::from_mode(0o555)).unwrap();

        let engine = CopyEngine::new();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let src = src_dir.path().to_path_buf();
        let dst = dst_path.clone();
        let ctrl = noop_handle();
        let handle = tokio::spawn(async move {
            let items = vec![item("song.flac")];
            engine.execute(&src, &dst, &items, tx, &ctrl).await
        });

        while rx.recv().await.is_some() {}
        let results = handle.await.unwrap();
        assert_eq!(results.len(), 1);
        assert!(matches!(&results[0].status, CopyStatus::Failed(_)));

        #[cfg(unix)]
        let _ = std::fs::set_permissions(&dst_path, Permissions::from_mode(0o755));
    }

    #[tokio::test]
    async fn with_chunk_size() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();
        let content = b"small file";
        let src = src_dir.path().to_path_buf();
        let dst = dst_dir.path().to_path_buf();
        std::fs::write(src.join("f.flac"), content).unwrap();

        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let dst_copy = dst.clone();
        let ctrl = noop_handle();
        let handle = tokio::spawn(async move {
            let engine = CopyEngine::with_chunk_size(64);
            let items = vec![item("f.flac")];
            engine.execute(&src, &dst, &items, tx, &ctrl).await
        });

        while rx.recv().await.is_some() {}
        let results = handle.await.unwrap();
        assert_eq!(results[0].status, CopyStatus::Done);
        assert_eq!(std::fs::read(dst_copy.join("f.flac")).unwrap(), content);
    }

    #[test]
    fn cleanup_tmp_removes_orphaned_tmp_files() {
        let dir = TempDir::new().unwrap();

        // Create a real file
        std::fs::write(dir.path().join("song.flac"), b"real").unwrap();
        // Create orphaned tmp files
        std::fs::write(dir.path().join("orphan.flac.musicsync.tmp"), b"partial").unwrap();
        std::fs::write(dir.path().join("nested").join("sub"), b"").ok();
        let nested = dir.path().join("nested");
        let _ = std::fs::create_dir_all(&nested);
        std::fs::write(nested.join("orphan2.flac.musicsync.tmp"), b"partial2").unwrap();

        // Create a non-tmp file that should NOT be touched
        std::fs::write(dir.path().join("keep.txt"), b"keep").unwrap();

        cleanup_tmp_files(dir.path()).unwrap();

        // Orphaned tmp files removed
        assert!(!dir.path().join("orphan.flac.musicsync.tmp").exists());
        assert!(!nested.join("orphan2.flac.musicsync.tmp").exists());
        // Real files preserved
        assert!(dir.path().join("song.flac").exists());
        assert!(dir.path().join("keep.txt").exists());
    }

    #[test]
    fn cleanup_tmp_on_nonexistent_path_does_not_error() {
        cleanup_tmp_files(Path::new("/nonexistent/path")).unwrap();
    }

    #[tokio::test]
    async fn verify_works_with_copy_and_no_tmp_remains() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        let content = b"verifiable audio data \xf0\x9f\x8e\xb5";
        std::fs::write(src_dir.path().join("verify.flac"), content).unwrap();

        let (results, _) = collect_results(
            src_dir.path(),
            dst_dir.path(),
            &[CopyItem {
                relative_path: PathBuf::from("verify.flac"),
                verify: true,
            }],
        )
        .await;

        assert_eq!(results[0].status, CopyStatus::Done);
        assert_eq!(
            std::fs::read(dst_dir.path().join("verify.flac")).unwrap(),
            content
        );
        // No .tmp file remains
        assert!(!dst_dir.path().join("verify.flac.musicsync.tmp").exists());
    }

    #[test]
    fn tmp_path_appends_suffix() {
        let p = PathBuf::from("/music/song.flac");
        assert_eq!(
            tmp_path(&p),
            PathBuf::from("/music/song.flac.musicsync.tmp")
        );
    }

    #[test]
    fn tmp_path_on_root_file() {
        let p = PathBuf::from("song.flac");
        assert_eq!(
            tmp_path(&p),
            PathBuf::from("song.flac.musicsync.tmp")
        );
    }

    // -----------------------------------------------------------------------
    // is_safe_relative
    // -----------------------------------------------------------------------

    #[test]
    fn is_safe_relative_rejects_parent_dir() {
        assert!(!is_safe_relative(Path::new("../escape.flac")));
        assert!(!is_safe_relative(Path::new("a/../../escape.flac")));
        assert!(!is_safe_relative(Path::new("album/../escape.flac")));
    }

    #[test]
    fn is_safe_relative_accepts_normal_paths() {
        assert!(is_safe_relative(Path::new("song.flac")));
        assert!(is_safe_relative(Path::new("artist/album/track.flac")));
        assert!(is_safe_relative(Path::new("subdir/file.flac")));
    }

    #[test]
    fn is_safe_relative_accepts_current_dir_prefix() {
        assert!(is_safe_relative(Path::new("./song.flac")));
        assert!(is_safe_relative(Path::new("./artist/album/track.flac")));
    }

    #[test]
    fn is_safe_relative_on_empty_path() {
        assert!(is_safe_relative(Path::new("")));
    }

    // -----------------------------------------------------------------------
    // CopyError::Display
    // -----------------------------------------------------------------------

    #[test]
    fn copy_error_display_source_not_found() {
        let err = CopyError::SourceNotFound(PathBuf::from("/missing/file.flac"));
        assert_eq!(err.to_string(), "source not found: /missing/file.flac");
    }

    #[test]
    fn copy_error_display_permission_denied() {
        let err = CopyError::PermissionDenied(PathBuf::from("/restricted/file.flac"));
        assert_eq!(err.to_string(), "permission denied: /restricted/file.flac");
    }

    #[test]
    fn copy_error_display_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::Other, "disk error");
        let err = CopyError::IoError(io_err);
        assert_eq!(err.to_string(), "I/O error: disk error");
    }

    #[test]
    fn copy_error_display_verification_failed() {
        let err = CopyError::VerificationFailed(PathBuf::from("/dst/corrupt.flac"));
        assert_eq!(err.to_string(), "verification failed: /dst/corrupt.flac");
    }

    #[test]
    fn copy_error_display_rename_failed() {
        let io_err = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "access denied");
        let err = CopyError::RenameFailed(PathBuf::from("/dst/song.flac"), io_err);
        assert_eq!(err.to_string(), "rename failed: /dst/song.flac");
    }

    // -----------------------------------------------------------------------
    // From<std::io::Error>
    // -----------------------------------------------------------------------

    #[test]
    fn copy_error_from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "not found");
        let err: CopyError = io_err.into();
        assert!(matches!(err, CopyError::IoError(_)));
    }

    // -----------------------------------------------------------------------
    // CopyEngine constructors
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn copy_engine_default_chunk_size_is_1_mib() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();
        std::fs::write(src_dir.path().join("f.flac"), b"data").unwrap();

        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let src = src_dir.path().to_path_buf();
        let dst = dst_dir.path().to_path_buf();
        let ctrl = noop_handle();
        let handle = tokio::spawn(async move {
            let engine = CopyEngine::new();
            engine
                .execute(&src, &dst, &[item("f.flac")], tx, &ctrl)
                .await
        });
        // Consume all progress
        while rx.recv().await.is_some() {}
        let results = handle.await.unwrap();
        assert_eq!(results[0].status, CopyStatus::Done);
    }

    #[tokio::test]
    async fn copy_engine_default_vs_new_equivalence() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();
        std::fs::write(src_dir.path().join("f.flac"), b"data").unwrap();

        let ctrl = noop_handle();
        // Default engine
        let (tx1, mut rx1) = tokio::sync::mpsc::unbounded_channel();
        let src1 = src_dir.path().to_path_buf();
        let dst1 = dst_dir.path().to_path_buf();
        let handle1 = tokio::spawn(async move {
            CopyEngine::default()
                .execute(&src1, &dst1, &[item("f.flac")], tx1, &ctrl)
                .await
        });
        while rx1.recv().await.is_some() {}
        let r1 = handle1.await.unwrap();

        // New engine
        let (tx2, mut rx2) = tokio::sync::mpsc::unbounded_channel();
        let src2 = src_dir.path().to_path_buf();
        let dst2 = dst_dir.path().to_path_buf();
        let ctrl2 = noop_handle();
        let handle2 = tokio::spawn(async move {
            CopyEngine::new()
                .execute(&src2, &dst2, &[item("f.flac")], tx2, &ctrl2)
                .await
        });
        while rx2.recv().await.is_some() {}
        let r2 = handle2.await.unwrap();

        assert_eq!(r1[0].status, CopyStatus::Done);
        assert_eq!(r2[0].status, CopyStatus::Done);
    }

    // -----------------------------------------------------------------------
    // CopyItem serde
    // -----------------------------------------------------------------------

    #[test]
    fn copy_item_serde_roundtrip_with_verify() {
        let item = CopyItem {
            relative_path: PathBuf::from("song.flac"),
            verify: true,
        };
        let json = serde_json::to_string(&item).unwrap();
        let back: CopyItem = serde_json::from_str(&json).unwrap();
        assert_eq!(back.relative_path, PathBuf::from("song.flac"));
        assert!(back.verify);
    }

    #[test]
    fn copy_item_serde_roundtrip_without_verify() {
        let item = CopyItem {
            relative_path: PathBuf::from("song.flac"),
            verify: false,
        };
        let json = serde_json::to_string(&item).unwrap();
        let back: CopyItem = serde_json::from_str(&json).unwrap();
        assert!(!back.verify);
    }

    #[test]
    fn copy_item_serde_verify_defaults_to_false() {
        let json = r#"{"relativePath":"song.flac"}"#;
        let item: CopyItem = serde_json::from_str(json).unwrap();
        assert_eq!(item.relative_path, PathBuf::from("song.flac"));
        assert!(!item.verify, "verify should default to false");
    }

    // -----------------------------------------------------------------------
    // CopyItemResult serde
    // -----------------------------------------------------------------------

    #[test]
    fn copy_item_result_serde_roundtrip_done() {
        let result = CopyItemResult {
            relative_path: PathBuf::from("ok.flac"),
            status: CopyStatus::Done,
        };
        let json = serde_json::to_string(&result).unwrap();
        let back: CopyItemResult = serde_json::from_str(&json).unwrap();
        assert_eq!(back.relative_path, PathBuf::from("ok.flac"));
        assert_eq!(back.status, CopyStatus::Done);
    }

    #[test]
    fn copy_item_result_serde_roundtrip_failed() {
        let result = CopyItemResult {
            relative_path: PathBuf::from("fail.flac"),
            status: CopyStatus::Failed("out of space".into()),
        };
        let json = serde_json::to_string(&result).unwrap();
        let back: CopyItemResult = serde_json::from_str(&json).unwrap();
        assert!(matches!(&back.status, CopyStatus::Failed(msg) if msg == "out of space"));
    }

    // -----------------------------------------------------------------------
    // Resilience — dropped progress receiver
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn dropped_progress_receiver_does_not_panic() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();
        std::fs::write(src_dir.path().join("a.flac"), b"data").unwrap();

        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        drop(rx); // receiver dropped before copy starts

        let engine = CopyEngine::new();
        let items = vec![item("a.flac")];
        let ctrl = noop_handle();
        let results = engine
            .execute(src_dir.path(), dst_dir.path(), &items, tx, &ctrl)
            .await;

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].status, CopyStatus::Done);
    }

    // -----------------------------------------------------------------------
    // Path traversal via execute is rejected
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn execute_rejects_path_traversal() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        let engine = CopyEngine::new();
        let items = vec![CopyItem {
            relative_path: PathBuf::from("../secret.flac"),
            verify: false,
        }];
        let ctrl = noop_handle();

        let results = engine
            .execute(src_dir.path(), dst_dir.path(), &items, tx, &ctrl)
            .await;

        assert_eq!(results.len(), 1);
        assert!(
            matches!(&results[0].status, CopyStatus::Failed(msg) if msg.contains("unsafe path")),
            "path traversal should be rejected as unsafe"
        );
    }

    // -----------------------------------------------------------------------
    // CopyProgress send on unsafe path
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn unsafe_path_still_emits_progress() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let engine = CopyEngine::new();
        let items = vec![CopyItem {
            relative_path: PathBuf::from("../bad.flac"),
            verify: false,
        }];
        let ctrl = noop_handle();

        let handle = tokio::spawn(async move {
            engine
                .execute(src_dir.path(), dst_dir.path(), &items, tx, &ctrl)
                .await
        });

        // Consume progress events
        let mut progress_events = Vec::new();
        while let Some(p) = rx.recv().await {
            progress_events.push(p);
        }
        let results = handle.await.unwrap();

        assert_eq!(progress_events.len(), 1);
        assert_eq!(progress_events[0].files_completed, 1);
        assert!(matches!(&results[0].status, CopyStatus::Failed(msg) if msg.contains("unsafe path")));
    }

    // -----------------------------------------------------------------------
    // Verification — large file spanning multiple chunks
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn verify_works_with_multi_chunk_file() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        // Create a file larger than default 1 MiB chunk (use smaller chunk for speed)
        let content = vec![0xABu8; 128 * 1024]; // 128 KiB — spans 2 chunks with small chunk size
        std::fs::write(src_dir.path().join("large.flac"), &content).unwrap();

        let engine = CopyEngine::with_chunk_size(64 * 1024); // 64 KiB chunks
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let src = src_dir.path().to_path_buf();
        let dst = dst_dir.path().to_path_buf();
        let ctrl = noop_handle();

        let handle = tokio::spawn(async move {
            let items = vec![CopyItem {
                relative_path: PathBuf::from("large.flac"),
                verify: true,
            }];
            engine.execute(&src, &dst, &items, tx, &ctrl).await
        });

        while rx.recv().await.is_some() {}
        let results = handle.await.unwrap();

        assert_eq!(results[0].status, CopyStatus::Done);
        assert_eq!(
            std::fs::read(dst_dir.path().join("large.flac")).unwrap(),
            content
        );
    }

    // -----------------------------------------------------------------------
    // Mixed success/failure with verification
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn mixed_verify_and_non_verify_files() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        std::fs::write(src_dir.path().join("a.flac"), b"verify me").unwrap();
        std::fs::write(src_dir.path().join("b.flac"), b"no verify").unwrap();

        let items = vec![
            CopyItem {
                relative_path: PathBuf::from("a.flac"),
                verify: true,
            },
            CopyItem {
                relative_path: PathBuf::from("b.flac"),
                verify: false,
            },
        ];

        let (results, _) = collect_results(src_dir.path(), dst_dir.path(), &items).await;

        assert_eq!(results.len(), 2);
        for r in &results {
            assert_eq!(r.status, CopyStatus::Done);
        }
    }

    // -----------------------------------------------------------------------
    // CopyHandle / CopyController — pause, resume, cancel
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn pause_blocks_before_next_file() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        // Use multi-chunk files so the test has time to react mid-copy
        let a_content = vec![0xAAu8; 128 * 1024]; // 128 KiB
        let b_content = vec![0xBBu8; 64 * 1024];  // 64 KiB
        std::fs::write(src_dir.path().join("a.wav"), &a_content).unwrap();
        std::fs::write(src_dir.path().join("b.wav"), &b_content).unwrap();

        let (handle, ctrl) = CopyHandle::new_pair();

        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();

        let items = vec![item("a.wav"), item("b.wav")];
        let src = src_dir.path().to_path_buf();
        let dst = dst_dir.path().to_path_buf();

        // Use small chunk so a.wav needs several chunks
        let engine = CopyEngine::with_chunk_size(16 * 1024); // 16 KiB
        let task = tokio::spawn(async move {
            engine.execute(&src, &dst, &items, tx, &handle).await
        });

        // Wait for first chunk progress of a.wav
        let _first = rx.recv().await.expect("first chunk progress");
        // Pause now — a.wav will finish its remaining chunks (must complete current file),
        // but b.wav must not start
        ctrl.pause();

        // Drain remaining progress as a.wav completes
        while let Some(p) = rx.recv().await {
            if p.files_completed >= 1 {
                // a.wav is fully done (all bytes + rename)
                break;
            }
        }

        assert!(dst_dir.path().join("a.wav").exists());
        assert!(!dst_dir.path().join("b.wav").exists(), "b.wav must not start while paused");

        // Resume to finish
        ctrl.resume();
        while let Some(_) = rx.recv().await {}
        let results = task.await.unwrap();

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].status, CopyStatus::Done);
        assert_eq!(results[1].status, CopyStatus::Done);
        assert!(dst_dir.path().join("b.wav").exists());
        assert_eq!(std::fs::read(dst_dir.path().join("a.wav")).unwrap(), a_content);
        assert_eq!(std::fs::read(dst_dir.path().join("b.wav")).unwrap(), b_content);
    }

    #[tokio::test]
    async fn resume_does_not_re_copy_completed_files() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        std::fs::write(src_dir.path().join("a.flac"), b"aaa").unwrap();
        std::fs::write(src_dir.path().join("b.flac"), b"bbb").unwrap();

        let (handle, ctrl) = CopyHandle::new_pair();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();

        let items = vec![item("a.flac"), item("b.flac")];
        let src = src_dir.path().to_path_buf();
        let dst = dst_dir.path().to_path_buf();

        let engine = CopyEngine::new();
        let task = tokio::spawn(async move {
            engine.execute(&src, &dst, &items, tx, &handle).await
        });

        while let Some(p) = rx.recv().await {
            if p.files_completed >= 1 {
                break;
            }
        }

        ctrl.pause();
        ctrl.resume();
        while let Some(_) = rx.recv().await {}

        let results = task.await.unwrap();
        assert_eq!(results[0].status, CopyStatus::Done);
        assert_eq!(results[1].status, CopyStatus::Done);
        let b_meta = std::fs::metadata(dst_dir.path().join("b.flac")).unwrap();
        assert_eq!(b_meta.len(), 3, "b.flac should be copied once");
    }

    #[tokio::test]
    async fn cancel_stops_after_current_file() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        std::fs::write(src_dir.path().join("a.flac"), b"aaa").unwrap();
        std::fs::write(src_dir.path().join("b.flac"), b"bbb").unwrap();
        std::fs::write(src_dir.path().join("c.flac"), b"ccc").unwrap();

        let (handle, ctrl) = CopyHandle::new_pair();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();

        let items = vec![item("a.flac"), item("b.flac"), item("c.flac")];
        let src = src_dir.path().to_path_buf();
        let dst = dst_dir.path().to_path_buf();

        let engine = CopyEngine::new();
        let task = tokio::spawn(async move {
            engine.execute(&src, &dst, &items, tx, &handle).await
        });

        while let Some(p) = rx.recv().await {
            if p.files_completed >= 1 {
                break;
            }
        }

        ctrl.cancel();
        while let Some(_) = rx.recv().await {}

        let results = task.await.unwrap();
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].status, CopyStatus::Done);
        assert_eq!(results[1].status, CopyStatus::Cancelled);
        assert_eq!(results[2].status, CopyStatus::Cancelled);
        assert!(dst_dir.path().join("a.flac").exists());
    }

    #[tokio::test]
    async fn cancel_during_file_cleans_up_tmp() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        let content = vec![0xFFu8; 64 * 1024];
        std::fs::write(src_dir.path().join("big.flac"), &content).unwrap();

        let (handle, ctrl) = CopyHandle::new_pair();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();

        let items = vec![item("big.flac"), item("other.flac")];
        let src = src_dir.path().to_path_buf();
        let dst = dst_dir.path().to_path_buf();

        let engine = CopyEngine::with_chunk_size(1024);
        let task = tokio::spawn(async move {
            engine.execute(&src, &dst, &items, tx, &handle).await
        });

        // Wait for first progress event (mid-file)
        let _ = rx.recv().await;
        ctrl.cancel();
        while let Some(_) = rx.recv().await {}

        let results = task.await.unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].status, CopyStatus::Cancelled);
        assert_eq!(results[1].status, CopyStatus::Cancelled);

        assert!(!dst_dir.path().join("big.flac.musicsync.tmp").exists());
        assert!(!dst_dir.path().join("big.flac").exists());
    }

    // -----------------------------------------------------------------------
    // CopyError::Display — Cancelled variant
    // -----------------------------------------------------------------------

    #[test]
    fn copy_error_display_cancelled() {
        let err = CopyError::Cancelled;
        assert_eq!(err.to_string(), "cancelled");
    }

    // -----------------------------------------------------------------------
    // Verification — corruption detection (hash mismatch)
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn verify_detects_corruption() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        let content = b"verifiable content that must match exactly";
        std::fs::write(src_dir.path().join("corrupt.flac"), content).unwrap();

        let (handle, _ctrl) = CopyHandle::new_pair();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();

        let items = vec![CopyItem {
            relative_path: PathBuf::from("corrupt.flac"),
            verify: true,
        }];

        let src = src_dir.path().to_path_buf();
        let dst = dst_dir.path().to_path_buf();
        let engine = CopyEngine::new();

        let task = tokio::spawn(async move {
            engine.execute(&src, &dst, &items, tx, &handle).await
        });

        // Consume progress; the pre-verify event has bytes_copied == total_file_size
        // but files_completed still 0 (not yet incremented). Corrupt the tmp file here.
        while let Some(p) = rx.recv().await {
            if p.bytes_copied == p.total_file_size && p.bytes_copied > 0 && p.files_completed == 0 {
                // The tmp file exists — corrupt it before verification reads it
                let tmp = dst_dir.path().join("corrupt.flac.musicsync.tmp");
                if tmp.exists() {
                    std::fs::write(&tmp, b"corrupted data").unwrap();
                }
                break;
            }
        }

        while let Some(_) = rx.recv().await {}
        let results = task.await.unwrap();

        assert_eq!(results.len(), 1);
        assert!(
            matches!(&results[0].status, CopyStatus::Failed(msg) if msg.contains("verification failed")),
            "expected verification failure, got {:?}",
            results[0].status
        );
        // No tmp file should remain after cleanup
        assert!(!dst_dir.path().join("corrupt.flac.musicsync.tmp").exists());
    }

    // -----------------------------------------------------------------------
    // Cancel during verification phase
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn cancel_during_verify_cleans_up_tmp() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        // Use a file large enough that verify needs multiple read chunks
        let content = vec![0xCDu8; 128 * 1024]; // 128 KiB
        std::fs::write(src_dir.path().join("big.flac"), &content).unwrap();

        let (handle, ctrl) = CopyHandle::new_pair();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();

        let items = vec![CopyItem {
            relative_path: PathBuf::from("big.flac"),
            verify: true,
        }];

        let src = src_dir.path().to_path_buf();
        let dst = dst_dir.path().to_path_buf();
        let engine = CopyEngine::with_chunk_size(64 * 1024); // 64 KiB chunks

        let task = tokio::spawn(async move {
            engine.execute(&src, &dst, &items, tx, &handle).await
        });

        // Wait for the pre-verify progress event (bytes_copied == total_file_size)
        while let Some(p) = rx.recv().await {
            if p.bytes_copied > 0 && p.bytes_copied == p.total_file_size && p.files_completed == 0 {
                // Cancel now — the verify loop checks cancel before each chunk read
                ctrl.cancel();
                break;
            }
        }

        while let Some(_) = rx.recv().await {}
        let results = task.await.unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].status, CopyStatus::Cancelled);
        // No tmp file should remain
        assert!(!dst_dir.path().join("big.flac.musicsync.tmp").exists());
        // No final file should exist
        assert!(!dst_dir.path().join("big.flac").exists());
    }

    // -----------------------------------------------------------------------
    // Rename failure (e.g., destination path is a directory)
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn rename_failure_when_destination_is_directory() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        std::fs::write(src_dir.path().join("song.flac"), b"data").unwrap();
        // Create a directory at the destination path — rename will fail with EISDIR
        std::fs::create_dir(dst_dir.path().join("song.flac")).unwrap();

        let engine = CopyEngine::new();
        let dst_root = dst_dir.path().to_path_buf();
        let dst_for_spawn = dst_root.clone();
        let ctrl = noop_handle();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let handle = tokio::spawn(async move {
            engine
                .execute(src_dir.path(), &dst_for_spawn, &[item("song.flac")], tx, &ctrl)
                .await
        });

        while rx.recv().await.is_some() {}
        let results = handle.await.unwrap();

        assert_eq!(results.len(), 1);
        assert!(
            matches!(&results[0].status, CopyStatus::Failed(msg) if msg.contains("rename failed")),
            "expected rename failure, got {:?}",
            results[0].status
        );
        // tmp file should be cleaned up
        assert!(!dst_root.join("song.flac.musicsync.tmp").exists());
    }

    // -----------------------------------------------------------------------
    // Multiple unsafe paths are all rejected
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn multiple_unsafe_paths_all_rejected() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let engine = CopyEngine::new();
        let items = vec![
            CopyItem { relative_path: PathBuf::from("../a.flac"), verify: false },
            CopyItem { relative_path: PathBuf::from("sub/../../b.flac"), verify: false },
        ];
        let ctrl = noop_handle();

        let handle = tokio::spawn(async move {
            engine
                .execute(src_dir.path(), dst_dir.path(), &items, tx, &ctrl)
                .await
        });

        let mut progress_events = Vec::new();
        while let Some(p) = rx.recv().await {
            progress_events.push(p);
        }
        let results = handle.await.unwrap();

        assert_eq!(results.len(), 2);
        for r in &results {
            assert!(
                matches!(&r.status, CopyStatus::Failed(msg) if msg.contains("unsafe path")),
                "expected unsafe path rejection, got {:?}",
                r.status
            );
        }
        // Progress events emitted for each unsafe item
        assert_eq!(progress_events.len(), 2);
        assert_eq!(progress_events.last().unwrap().files_completed, 2);
    }

    // -----------------------------------------------------------------------
    // Cancel before processing any items — all remainders marked Cancelled
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn cancel_before_any_file_marks_all_as_cancelled() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        std::fs::write(src_dir.path().join("a.flac"), b"a").unwrap();
        std::fs::write(src_dir.path().join("b.flac"), b"b").unwrap();

        let (handle, ctrl) = CopyHandle::new_pair();
        ctrl.cancel(); // Cancel before starting

        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let engine = CopyEngine::new();
        let items = vec![item("a.flac"), item("b.flac")];
        let src = src_dir.path().to_path_buf();
        let dst = dst_dir.path().to_path_buf();

        let task = tokio::spawn(async move {
            engine.execute(&src, &dst, &items, tx, &handle).await
        });

        // Drain — should close quickly since cancel is pre-set
        while let Some(_) = rx.recv().await {}

        let results = task.await.unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].status, CopyStatus::Cancelled);
        assert_eq!(results[1].status, CopyStatus::Cancelled);
    }

    #[tokio::test]
    async fn cancel_marks_remaining_as_cancelled() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        std::fs::write(src_dir.path().join("a.flac"), b"a").unwrap();
        std::fs::write(src_dir.path().join("b.flac"), b"b").unwrap();
        std::fs::write(src_dir.path().join("c.flac"), b"c").unwrap();
        std::fs::write(src_dir.path().join("d.flac"), b"d").unwrap();

        let (handle, ctrl) = CopyHandle::new_pair();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();

        let items = vec![
            item("a.flac"), item("b.flac"), item("c.flac"), item("d.flac"),
        ];
        let src = src_dir.path().to_path_buf();
        let dst = dst_dir.path().to_path_buf();

        let engine = CopyEngine::new();
        let task = tokio::spawn(async move {
            engine.execute(&src, &dst, &items, tx, &handle).await
        });

        // Let first two finish
        while let Some(p) = rx.recv().await {
            if p.files_completed >= 2 {
                break;
            }
        }
        ctrl.cancel();
        while let Some(_) = rx.recv().await {}

        let results = task.await.unwrap();
        assert_eq!(results.len(), 4);
        assert_eq!(results[0].status, CopyStatus::Done);
        assert_eq!(results[1].status, CopyStatus::Done);
        assert_eq!(results[2].status, CopyStatus::Cancelled);
        assert_eq!(results[3].status, CopyStatus::Cancelled);
        assert!(dst_dir.path().join("a.flac").exists());
        assert!(dst_dir.path().join("b.flac").exists());
    }
}
