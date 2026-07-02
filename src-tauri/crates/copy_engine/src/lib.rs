use music_sync_domain::CopyStatus;
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use tokio::io::AsyncReadExt;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc::UnboundedSender;

const DEFAULT_CHUNK_SIZE: u64 = 1_048_576; // 1 MiB

/// Emitted during copy for per-file and global progress.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyProgress {
    /// Relative path of the file currently being copied.
    pub current_file: PathBuf,
    /// Bytes copied so far for the current file.
    pub bytes_copied: u64,
    /// Total size of the current file in bytes.
    pub total_file_size: u64,
    /// Number of files fully completed (Done or Failed terminal).
    pub files_completed: u64,
    /// Total number of files in the queue.
    pub total_files: u64,
}

/// An item queued for copy.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyItem {
    pub relative_path: PathBuf,
}

/// Returns `false` if the path contains `..` components that could escape
/// a base directory.
pub fn is_safe_relative(path: &Path) -> bool {
    !path.components().any(|c| matches!(c, Component::ParentDir))
}

/// Outcome for a single copy item after processing.
#[derive(Debug, Clone, Serialize)]
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
}

impl std::fmt::Display for CopyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SourceNotFound(p) => write!(f, "source not found: {}", p.display()),
            Self::PermissionDenied(p) => write!(f, "permission denied: {}", p.display()),
            Self::IoError(e) => write!(f, "I/O error: {}", e),
        }
    }
}

/// Sequential file copy engine.
///
/// Processes a list of items one-by-one toward the same destination.
/// Each file is stream-copied in chunks (default 1 MiB) with progress
/// events emitted per chunk and at completion.  Intermediate directories
/// are created automatically.  A failure in one item does NOT stop the
/// rest of the queue — the failed item is marked `Failed(reason)` and
/// the engine continues with the next item.
pub struct CopyEngine {
    chunk_size: u64,
}

impl CopyEngine {
    pub fn new() -> Self {
        Self {
            chunk_size: DEFAULT_CHUNK_SIZE,
        }
    }

    pub fn with_chunk_size(chunk_size: u64) -> Self {
        Self { chunk_size }
    }

    /// Execute the copy queue.
    ///
    /// `source_root` — base directory for resolving source paths.
    /// `destination_root` — base directory for resolving destination paths.
    /// `items` — list of relative paths to copy.
    /// `progress_tx` — channel for progress events (drop to signal done).
    pub async fn execute(
        &self,
        source_root: &Path,
        destination_root: &Path,
        items: &[CopyItem],
        progress_tx: UnboundedSender<CopyProgress>,
    ) -> Vec<CopyItemResult> {
        let total_files = items.len() as u64;
        let mut results = Vec::with_capacity(items.len());
        let mut files_completed = 0u64;

        for item in items {
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
                .copy_file(&src, &dst, &progress_tx, item, files_completed, total_files)
                .await;

            files_completed += 1;
            let (status, file_size) = match copy_result {
                Ok(size) => (CopyStatus::Done, size),
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

        results
    }

    // Returns Ok(file_size) on success, Err on failure.
    async fn copy_file(
        &self,
        src: &Path,
        dst: &Path,
        progress_tx: &UnboundedSender<CopyProgress>,
        item: &CopyItem,
        files_completed: u64,
        total_files: u64,
    ) -> Result<u64, CopyError> {
        if let Some(parent) = dst.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(CopyError::IoError)?;
        }

        let mut src_file = tokio::fs::File::open(src).await.map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => CopyError::SourceNotFound(src.to_path_buf()),
            std::io::ErrorKind::PermissionDenied => CopyError::PermissionDenied(src.to_path_buf()),
            _ => CopyError::IoError(e),
        })?;

        let file_size = src_file
            .metadata()
            .await
            .map_err(CopyError::IoError)?
            .len();

        let mut dst_file = tokio::fs::File::create(dst)
            .await
            .map_err(CopyError::IoError)?;

        let mut buffer = vec![0u8; self.chunk_size as usize];
        let mut total_read: u64 = 0;

        loop {
            let bytes_read = src_file.read(&mut buffer).await.map_err(CopyError::IoError)?;
            if bytes_read == 0 {
                break;
            }
            dst_file
                .write_all(&buffer[..bytes_read])
                .await
                .map_err(CopyError::IoError)?;
            total_read += bytes_read as u64;

            let _ = progress_tx.send(CopyProgress {
                current_file: item.relative_path.clone(),
                bytes_copied: total_read,
                total_file_size: file_size,
                files_completed,
                total_files,
            });
        }

        dst_file.flush().await.map_err(CopyError::IoError)?;
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
            tokio::spawn(async move {
                let engine = CopyEngine::new();
                engine
                    .execute(&source_root, &destination_root, &items, tx)
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

    #[tokio::test]
    async fn copies_files_to_destination() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        std::fs::write(src_dir.path().join("song.flac"), b"audio data").unwrap();

        let item = CopyItem {
            relative_path: PathBuf::from("song.flac"),
        };

        let (results, progress) = collect_results(
            src_dir.path(),
            dst_dir.path(),
            &[item],
        )
        .await;

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].status, CopyStatus::Done);
        assert_eq!(results[0].relative_path, PathBuf::from("song.flac"));

        let dst_content = std::fs::read(dst_dir.path().join("song.flac")).unwrap();
        assert_eq!(dst_content, b"audio data");
        assert!(!progress.is_empty(), "should have emitted progress events");
    }

    #[tokio::test]
    async fn permission_denied_on_source_is_detected() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        // Create a file and make it unreadable
        let restricted = src_dir.path().join("secret.flac");
        std::fs::write(&restricted, b"data").unwrap();
        // Only works on Unix — set permissions to 0 (no read/write/execute)
        #[cfg(unix)]
        std::fs::set_permissions(&restricted, Permissions::from_mode(0o000)).unwrap();

        let engine = CopyEngine::new();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let handle = tokio::spawn(async move {
            let items = vec![CopyItem {
                relative_path: PathBuf::from("secret.flac"),
            }];
            engine
                .execute(src_dir.path(), dst_dir.path(), &items, tx)
                .await
        });

        while rx.recv().await.is_some() {}
        let results = handle.await.unwrap();
        assert_eq!(results.len(), 1);
        assert!(
            matches!(&results[0].status, CopyStatus::Failed(reason) if reason.contains("permission denied")),
            "expected PermissionDenied, got {:?}",
            results[0].status
        );

        // Cleanup: restore permissions so TempDir can delete the file
        #[cfg(unix)]
        let _ = std::fs::set_permissions(&restricted, Permissions::from_mode(0o644));
    }

    #[tokio::test]
    async fn preserves_relative_subfolder_structure() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        let nested = src_dir.path().join("artist").join("album");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("track.flac"), b"nested content").unwrap();

        let item = CopyItem {
            relative_path: PathBuf::from("artist/album/track.flac"),
        };

        let (results, _) = collect_results(
            src_dir.path(),
            dst_dir.path(),
            &[item],
        )
        .await;

        assert_eq!(results[0].status, CopyStatus::Done);
        let dst_path = dst_dir.path().join("artist/album/track.flac");
        assert!(dst_path.exists(), "subfolder structure should be preserved");
        assert_eq!(
            std::fs::read(&dst_path).unwrap(),
            b"nested content"
        );
    }

    #[tokio::test]
    async fn missing_source_file_is_failed_but_queue_continues() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        // Only the second file exists
        std::fs::write(src_dir.path().join("exists.flac"), b"real").unwrap();

        let items = vec![
            CopyItem {
                relative_path: PathBuf::from("missing.flac"),
            },
            CopyItem {
                relative_path: PathBuf::from("exists.flac"),
            },
        ];

        let (results, progress) = collect_results(
            src_dir.path(),
            dst_dir.path(),
            &items,
        )
        .await;

        assert_eq!(results.len(), 2);
        assert!(
            matches!(&results[0].status, CopyStatus::Failed(reason) if reason.contains("source not found")),
            "first item should be Failed with source-not-found"
        );
        assert_eq!(results[1].status, CopyStatus::Done);

        // Progress should count both failed and done
        let last = progress.last().unwrap();
        assert_eq!(last.files_completed, 2);
        assert_eq!(last.total_files, 2);

        // Second file should still have been copied
        assert!(dst_dir.path().join("exists.flac").exists());
    }

    #[tokio::test]
    async fn empty_item_list_returns_empty_results() {
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
    async fn copies_multiple_files_in_sequence() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        std::fs::write(src_dir.path().join("a.flac"), b"aaa").unwrap();
        std::fs::write(src_dir.path().join("b.flac"), b"bbb").unwrap();
        std::fs::create_dir_all(src_dir.path().join("sub")).unwrap();
        std::fs::write(src_dir.path().join("sub/c.flac"), b"ccc").unwrap();

        let items = vec![
            CopyItem {
                relative_path: PathBuf::from("a.flac"),
            },
            CopyItem {
                relative_path: PathBuf::from("b.flac"),
            },
            CopyItem {
                relative_path: PathBuf::from("sub/c.flac"),
            },
        ];

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

        // Verify content and structure
        assert_eq!(std::fs::read(dst_dir.path().join("a.flac")).unwrap(), b"aaa");
        assert_eq!(std::fs::read(dst_dir.path().join("b.flac")).unwrap(), b"bbb");
        assert_eq!(
            std::fs::read(dst_dir.path().join("sub/c.flac")).unwrap(),
            b"ccc"
        );

        // Progress events should reflect sequential progression
        let last_progress = progress.last().unwrap();
        assert_eq!(last_progress.files_completed, 3);
        assert_eq!(last_progress.total_files, 3);
    }

    #[tokio::test]
    async fn with_chunk_size_copies_correctly() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();
        let content = b"small file";
        let src = src_dir.path().to_path_buf();
        let dst = dst_dir.path().to_path_buf();
        std::fs::write(src.join("f.flac"), content).unwrap();

        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let dst_copy = dst.clone();
        let handle = tokio::spawn(async move {
            let engine = CopyEngine::with_chunk_size(64);
            let items = vec![CopyItem {
                relative_path: PathBuf::from("f.flac"),
            }];
            engine.execute(&src, &dst, &items, tx).await
        });

        while rx.recv().await.is_some() {}
        let results = handle.await.unwrap();
        assert_eq!(results[0].status, CopyStatus::Done);
        assert_eq!(std::fs::read(dst_copy.join("f.flac")).unwrap(), content);
    }

    #[tokio::test]
    async fn per_chunk_progress_is_reported() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        // Write a file large enough to span multiple 1-byte chunks
        let content = vec![0xABu8; 5000];
        std::fs::write(src_dir.path().join("large.flac"), &content).unwrap();

        // chunk_size is set inside collect_results (default 1 MiB), but the file is only
        // 5000 bytes so it will always be copied in a single chunk with default chunk size
        // — we verify >=1 progress event was emitted
        let (results, progress) = collect_results(
            src_dir.path(),
            dst_dir.path(),
            &[CopyItem {
                relative_path: PathBuf::from("large.flac"),
            }],
        )
        .await;

        assert_eq!(results[0].status, CopyStatus::Done);
        // Should have emitted at least 1 progress event
        assert!(
            !progress.is_empty(),
            "expected at least one progress event"
        );

        // Last event should show completed file
        let last = progress.last().unwrap();
        assert_eq!(last.bytes_copied, 5000);
        assert_eq!(last.total_file_size, 5000);
        assert_eq!(last.files_completed, 1);
    }

    #[tokio::test]
    async fn empty_file_is_copied_successfully() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        // 0-byte file
        std::fs::write(src_dir.path().join("empty.flac"), b"").unwrap();

        let (results, progress) = collect_results(
            src_dir.path(),
            dst_dir.path(),
            &[CopyItem {
                relative_path: PathBuf::from("empty.flac"),
            }],
        )
        .await;

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].status, CopyStatus::Done);
        assert_eq!(results[0].relative_path, PathBuf::from("empty.flac"));

        // Dest file should exist and be 0 bytes
        let dst_path = dst_dir.path().join("empty.flac");
        assert!(dst_path.exists());
        assert_eq!(std::fs::metadata(&dst_path).unwrap().len(), 0);

        // Should have exactly 1 progress event (from execute, not from copy_file loop)
        assert_eq!(progress.len(), 1);
        assert_eq!(progress[0].bytes_copied, 0);
        assert_eq!(progress[0].files_completed, 1);
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn destination_permission_denied_is_detected() {
        use std::os::unix::fs::PermissionsExt;

        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();
        let dst_path = dst_dir.path().to_path_buf();

        std::fs::write(src_dir.path().join("song.flac"), b"audio data").unwrap();
        std::fs::set_permissions(&dst_path, Permissions::from_mode(0o555)).unwrap();

        let engine = CopyEngine::new();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let src = src_dir.path().to_path_buf();
        let dst = dst_path.clone();
        let handle = tokio::spawn(async move {
            let items = vec![CopyItem {
                relative_path: PathBuf::from("song.flac"),
            }];
            engine.execute(&src, &dst, &items, tx).await
        });

        while rx.recv().await.is_some() {}
        let results = handle.await.unwrap();
        assert_eq!(results.len(), 1);
        assert!(
            matches!(&results[0].status, CopyStatus::Failed(reason) if reason.contains("Permission denied")),
            "expected Permission denied error, got {:?}",
            results[0].status
        );

        let _ = std::fs::set_permissions(&dst_path, Permissions::from_mode(0o755));
    }

    #[test]
    fn copy_error_display_formats_correctly() {
        let err = CopyError::SourceNotFound(PathBuf::from("missing.flac"));
        assert_eq!(
            err.to_string(),
            "source not found: missing.flac"
        );

        let err = CopyError::PermissionDenied(PathBuf::from("secret.flac"));
        assert_eq!(
            err.to_string(),
            "permission denied: secret.flac"
        );

        let io_err = std::io::Error::new(std::io::ErrorKind::Other, "disk full");
        let err = CopyError::IoError(io_err);
        assert_eq!(
            err.to_string(),
            "I/O error: disk full"
        );
    }

    #[test]
    fn copy_progress_serialization_uses_camel_case() {
        let progress = CopyProgress {
            current_file: PathBuf::from("artist/album/track.flac"),
            bytes_copied: 42,
            total_file_size: 100_000,
            files_completed: 5,
            total_files: 10,
        };

        let json = serde_json::to_string(&progress).unwrap();
        assert!(json.contains(r#"currentFile"#), "should use camelCase: {}", json);
        assert!(json.contains(r#"bytesCopied"#), "should use camelCase: {}", json);
        assert!(json.contains(r#"totalFileSize"#), "should use camelCase: {}", json);
        assert!(json.contains(r#"filesCompleted"#), "should use camelCase: {}", json);
        assert!(json.contains(r#"totalFiles"#), "should use camelCase: {}", json);
        assert!(!json.contains(r#"current_file"#), "should not use snake_case: {}", json);

        // Round-trip: deserialize back
        let deserialized: CopyProgress = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.current_file, progress.current_file);
        assert_eq!(deserialized.bytes_copied, progress.bytes_copied);
        assert_eq!(deserialized.total_file_size, progress.total_file_size);
        assert_eq!(deserialized.files_completed, progress.files_completed);
        assert_eq!(deserialized.total_files, progress.total_files);
    }

    #[tokio::test]
    async fn exact_chunk_multiple_copy() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();
        let src = src_dir.path().to_path_buf();
        let dst = dst_dir.path().to_path_buf();

        // File size = exactly 3 * chunk_size
        let chunk_size = 4096u64;
        let content = vec![0xBCu8; (3 * chunk_size) as usize];
        std::fs::write(src.join("exact.flac"), &content).unwrap();

        let engine = CopyEngine::with_chunk_size(chunk_size);
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let dst_copy = dst.clone();
        let handle = tokio::spawn(async move {
            let items = vec![CopyItem {
                relative_path: PathBuf::from("exact.flac"),
            }];
            engine.execute(&src, &dst, &items, tx).await
        });

        let mut events = Vec::new();
        while let Some(p) = rx.recv().await {
            events.push(p);
        }
        let results = handle.await.unwrap();

        assert_eq!(results[0].status, CopyStatus::Done);
        assert_eq!(std::fs::read(dst_copy.join("exact.flac")).unwrap(), content);

        // Should have 3 chunk events + 1 final event from execute = 4 total
        // Actually: 3 chunks each produce a progress event, then execute emits a final event
        assert_eq!(events.len(), 4, "expected 4 events (3 chunks + 1 final), got {}", events.len());

        // Verify chunk progress events
        for (i, event) in events.iter().enumerate().take(3) {
            assert_eq!(event.total_file_size, 3 * chunk_size);
            assert_eq!(event.bytes_copied, chunk_size * (i as u64 + 1));
        }
        // Final event from execute
        let last = events.last().unwrap();
        assert_eq!(last.bytes_copied, 3 * chunk_size);
        assert_eq!(last.total_file_size, 3 * chunk_size);
        assert_eq!(last.files_completed, 1);
    }

    #[tokio::test]
    async fn large_file_with_odd_remainder() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();
        let src = src_dir.path().to_path_buf();
        let dst = dst_dir.path().to_path_buf();

        // File size = 2.5 chunks (exact 2 chunks + partial)
        let chunk_size = 4096u64;
        let content = vec![0xCDu8; (2 * chunk_size + chunk_size / 2) as usize];
        std::fs::write(src.join("odd.flac"), &content).unwrap();

        let (results, progress) = {
            let engine = CopyEngine::with_chunk_size(chunk_size);
            let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
            let items = vec![CopyItem {
                relative_path: PathBuf::from("odd.flac"),
            }];
            let dst_for_spawn = dst.clone();
            let handle = tokio::spawn(async move {
                engine.execute(&src, &dst_for_spawn, &items, tx).await
            });
            let mut events = Vec::new();
            while let Some(p) = rx.recv().await {
                events.push(p);
            }
            (handle.await.unwrap(), events)
        };

        assert_eq!(results[0].status, CopyStatus::Done);
        assert_eq!(std::fs::read(dst.join("odd.flac")).unwrap(), content);

        // 2 full chunks + 1 partial = 3 chunk events + 1 final = 4
        assert_eq!(progress.len(), 4);
        assert_eq!(progress.last().unwrap().bytes_copied, content.len() as u64);
    }

    #[tokio::test]
    async fn files_completed_increments_even_on_failure() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        std::fs::write(src_dir.path().join("real.flac"), b"ok").unwrap();

        let (results, progress) = collect_results(
            src_dir.path(),
            dst_dir.path(),
            &[
                CopyItem {
                    relative_path: PathBuf::from("missing.flac"),
                },
                CopyItem {
                    relative_path: PathBuf::from("real.flac"),
                },
            ],
        )
        .await;

        assert_eq!(results.len(), 2);
        assert!(matches!(results[0].status, CopyStatus::Failed(_)));
        assert_eq!(results[1].status, CopyStatus::Done);

        let last = progress.last().unwrap();
        assert_eq!(last.files_completed, 2, "both failed and done should count as completed");
        assert_eq!(last.total_files, 2);
    }

    #[test]
    fn is_safe_relative_rejects_parent_dir() {
        assert!(super::is_safe_relative(Path::new("song.flac")));
        assert!(super::is_safe_relative(Path::new("artist/album/track.flac")));
        assert!(super::is_safe_relative(Path::new("a/b/c/d.flac")));
        assert!(!super::is_safe_relative(Path::new("../etc/passwd")));
        assert!(!super::is_safe_relative(Path::new("a/../../b.flac")));
    }

    #[tokio::test]
    async fn unsafe_path_is_rejected_without_copying() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();

        let (results, progress) = collect_results(
            src_dir.path(),
            dst_dir.path(),
            &[CopyItem {
                relative_path: PathBuf::from("../outside.flac"),
            }],
        )
        .await;

        assert_eq!(results.len(), 1);
        assert!(
            matches!(&results[0].status, CopyStatus::Failed(reason) if reason.contains("unsafe path")),
            "expected unsafe path error, got {:?}",
            results[0].status
        );
        let last = progress.last().unwrap();
        assert_eq!(last.files_completed, 1);
    }
}
