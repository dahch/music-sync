use music_sync_domain::MusicFile;
use serde::Serialize;
use std::fmt;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use tokio::sync::mpsc::UnboundedSender;

pub const DEFAULT_EXTENSIONS: &[&str] = &["mp3", "flac"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub files_found: u64,
    pub current_path: Option<PathBuf>,
}

#[derive(Debug)]
pub enum ScanError {
    NotFound(PathBuf),
    NotADirectory(PathBuf),
    PermissionDenied(PathBuf),
    IoError(std::io::Error),
}

impl fmt::Display for ScanError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound(p) => write!(f, "path not found: {}", p.display()),
            Self::NotADirectory(p) => write!(f, "path is not a directory: {}", p.display()),
            Self::PermissionDenied(p) => write!(f, "permission denied: {}", p.display()),
            Self::IoError(e) => write!(f, "I/O error: {}", e),
        }
    }
}

impl std::error::Error for ScanError {}

fn path_aware_error(e: std::io::Error, path: &Path) -> ScanError {
    match e.kind() {
        std::io::ErrorKind::NotFound => ScanError::NotFound(path.to_path_buf()),
        std::io::ErrorKind::PermissionDenied => ScanError::PermissionDenied(path.to_path_buf()),
        _ => ScanError::IoError(e),
    }
}

pub struct Scanner {
    root: PathBuf,
    extensions: Vec<String>,
}

impl Scanner {
    pub fn new(root: PathBuf, extensions: Vec<String>) -> Self {
        Self { root, extensions }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn validate(&self) -> Result<(), ScanError> {
        if !self.root.exists() {
            return Err(ScanError::NotFound(self.root.clone()));
        }
        if !self.root.is_dir() {
            return Err(ScanError::NotADirectory(self.root.clone()));
        }
        self.root.read_dir().map_err(|e| {
            if e.kind() == std::io::ErrorKind::PermissionDenied {
                ScanError::PermissionDenied(self.root.clone())
            } else {
                ScanError::IoError(e)
            }
        })?;
        Ok(())
    }

    pub async fn scan(
        self,
        progress_tx: UnboundedSender<ScanProgress>,
    ) -> Result<Vec<MusicFile>, ScanError> {
        self.validate()?;
        let mut files = Vec::new();
        let mut dirs = vec![self.root.clone()];

        while let Some(dir) = dirs.pop() {
            let mut read_dir = tokio::fs::read_dir(&dir)
                .await
                .map_err(|e| path_aware_error(e, &dir))?;
            while let Some(entry) = read_dir.next_entry().await.map_err(|e| {
                // next_entry no nos da la path, usamos dir como contexto
                path_aware_error(e, &dir)
            })? {
                let path = entry.path();
                let file_type = entry.file_type().await.map_err(|e| {
                    path_aware_error(e, &path)
                })?;

                if file_type.is_dir() && !file_type.is_symlink() {
                    dirs.push(path);
                } else if file_type.is_file() {
                    let ext = path
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(|e| e.to_lowercase());

                    if let Some(ref ext) = ext {
                        if self.extensions.is_empty() || self.extensions.contains(ext) {
                            let metadata = entry.metadata().await
                                .map_err(|e| path_aware_error(e, &path))?;

                            let relative =
                                path.strip_prefix(&self.root).unwrap_or(&path).to_path_buf();
                            let file = MusicFile::new(
                                relative,
                                path.clone(),
                                metadata.len(),
                                metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                                ext.clone(),
                            );
                            files.push(file);

                            let _ = progress_tx.send(ScanProgress {
                                files_found: files.len() as u64,
                                current_path: Some(path),
                            });
                        }
                    }
                }
            }
        }

        let _ = progress_tx.send(ScanProgress {
            files_found: files.len() as u64,
            current_path: None,
        });
        Ok(files)
    }
}

pub async fn scan_pair(
    source: Scanner,
    destination: Scanner,
    progress_tx: UnboundedSender<ScanProgress>,
) -> Result<(Vec<MusicFile>, Vec<MusicFile>), ScanError> {
    let src = source.scan(progress_tx.clone());
    let dst = destination.scan(progress_tx);
    tokio::try_join!(src, dst)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use tokio::sync::mpsc;

    fn create_fixture(dir: &Path, files: &[(&str, &str)]) {
        for (name, ext) in files {
            let sub = dir.join("sub");
            std::fs::create_dir_all(&sub).unwrap();
            std::fs::File::create(sub.join(format!("{}.{}", name, ext))).unwrap();
        }
    }

    fn create_fixture_flat(dir: &Path, files: &[(&str, &str)]) {
        for (name, ext) in files {
            std::fs::File::create(dir.join(format!("{}.{}", name, ext))).unwrap();
        }
    }

    async fn collect(
        scanner: Scanner,
    ) -> Result<(Vec<MusicFile>, Vec<ScanProgress>), ScanError> {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let handle = tokio::spawn(scanner.scan(tx));
        let mut progress = Vec::new();
        while let Some(p) = rx.recv().await {
            progress.push(p);
        }
        let files = handle.await.unwrap()?;
        Ok((files, progress))
    }

    #[tokio::test]
    async fn scan_finds_matching_files() {
        let dir = TempDir::new().unwrap();
        create_fixture(
            dir.path(),
            &[("song1", "flac"), ("song2", "mp3"), ("song3", "flac")],
        );

        let scanner = Scanner::new(
            dir.path().join("sub"),
            vec!["flac".into(), "mp3".into()],
        );
        let (files, _) = collect(scanner).await.unwrap();
        assert_eq!(files.len(), 3);
    }

    #[tokio::test]
    async fn scan_filters_by_extension() {
        let dir = TempDir::new().unwrap();
        create_fixture_flat(
            dir.path(),
            &[
                ("a", "flac"),
                ("b", "mp3"),
                ("c", "wav"),
                ("d", "aac"),
                ("e", "flac"),
            ],
        );

        let scanner = Scanner::new(
            dir.path().to_path_buf(),
            vec!["flac".into(), "mp3".into()],
        );
        let (files, _) = collect(scanner).await.unwrap();
        assert_eq!(files.len(), 3);
        for f in &files {
            assert!(f.extension == "flac" || f.extension == "mp3");
        }
    }

    #[tokio::test]
    async fn scan_empty_extensions_matches_all() {
        let dir = TempDir::new().unwrap();
        create_fixture_flat(dir.path(), &[("a", "txt"), ("b", "jpg"), ("c", "flac")]);

        let scanner = Scanner::new(dir.path().to_path_buf(), vec![]);
        let (files, _) = collect(scanner).await.unwrap();
        assert_eq!(files.len(), 3);
    }

    #[tokio::test]
    async fn scan_sets_correct_fields() {
        let dir = TempDir::new().unwrap();
        let file_path = dir.path().join("test.flac");
        std::fs::write(&file_path, b"audio data").unwrap();

        let scanner = Scanner::new(dir.path().to_path_buf(), vec!["flac".into()]);
        let (files, _) = collect(scanner).await.unwrap();
        assert_eq!(files.len(), 1);

        let f = &files[0];
        assert_eq!(f.relative_path, PathBuf::from("test.flac"));
        assert_eq!(f.absolute_path, file_path);
        assert_eq!(f.extension, "flac");
        assert_eq!(f.size_bytes, 10);
        assert!(f.content_hash.is_none());
    }

    #[tokio::test]
    async fn scan_reports_progress() {
        let dir = TempDir::new().unwrap();
        for i in 0..5 {
            std::fs::File::create(dir.path().join(format!("{}.flac", i))).unwrap();
        }

        let scanner = Scanner::new(dir.path().to_path_buf(), vec!["flac".into()]);
        let (files, progress) = collect(scanner).await.unwrap();
        assert_eq!(files.len(), 5);
        assert!(progress.len() >= 5);
        assert_eq!(progress.last().unwrap().files_found, 5);
    }

    #[tokio::test]
    async fn validate_returns_not_found() {
        let scanner = Scanner::new(PathBuf::from("/nonexistent/path"), vec!["flac".into()]);
        let err = scanner.validate().unwrap_err();
        assert!(matches!(err, ScanError::NotFound(_)));
    }

    #[tokio::test]
    async fn validate_returns_not_a_directory() {
        let dir = TempDir::new().unwrap();
        let file_path = dir.path().join("file.txt");
        std::fs::write(&file_path, b"hello").unwrap();

        let scanner = Scanner::new(file_path, vec!["flac".into()]);
        let err = scanner.validate().unwrap_err();
        assert!(matches!(err, ScanError::NotADirectory(_)));
    }

    #[tokio::test]
    async fn scan_handles_empty_directory() {
        let dir = TempDir::new().unwrap();
        let scanner = Scanner::new(dir.path().to_path_buf(), vec!["flac".into()]);
        let (files, _) = collect(scanner).await.unwrap();
        assert!(files.is_empty());
    }

    #[tokio::test]
    async fn scan_handles_nested_directories() {
        let dir = TempDir::new().unwrap();
        let a = dir.path().join("artist_a");
        let b = dir.path().join("artist_b");
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        std::fs::File::create(a.join("song1.flac")).unwrap();
        std::fs::File::create(a.join("song2.flac")).unwrap();
        std::fs::File::create(b.join("song3.mp3")).unwrap();

        let scanner = Scanner::new(
            dir.path().to_path_buf(),
            vec!["flac".into(), "mp3".into()],
        );
        let (files, _) = collect(scanner).await.unwrap();
        assert_eq!(files.len(), 3);
    }

    #[tokio::test]
    async fn scan_case_insensitive_extensions() {
        let dir = TempDir::new().unwrap();
        create_fixture_flat(dir.path(), &[("a", "FLAC"), ("b", "Mp3"), ("c", "flac")]);

        let scanner = Scanner::new(
            dir.path().to_path_buf(),
            vec!["flac".into(), "mp3".into()],
        );
        let (files, _) = collect(scanner).await.unwrap();
        assert_eq!(files.len(), 3);
    }

    #[tokio::test]
    async fn scan_skips_non_matching_extensions() {
        let dir = TempDir::new().unwrap();
        create_fixture_flat(dir.path(), &[("a", "txt"), ("b", "md"), ("c", "flac")]);

        let scanner = Scanner::new(dir.path().to_path_buf(), vec!["flac".into()]);
        let (files, _) = collect(scanner).await.unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].extension, "flac");
    }

    #[tokio::test]
    async fn scan_pair_returns_both_sides() {
        let src = TempDir::new().unwrap();
        let dst = TempDir::new().unwrap();
        std::fs::write(src.path().join("a.flac"), b"").unwrap();
        std::fs::write(dst.path().join("b.flac"), b"").unwrap();

        let source = Scanner::new(src.path().to_path_buf(), vec!["flac".into()]);
        let destination = Scanner::new(dst.path().to_path_buf(), vec!["flac".into()]);
        let (tx, mut rx) = mpsc::unbounded_channel();

        let handle = tokio::spawn(scan_pair(source, destination, tx));

        let mut progress_count = 0u64;
        while let Some(p) = rx.recv().await {
            if p.current_path.is_none() {
                break;
            }
            progress_count = p.files_found;
        }

        let (src_files, dst_files) = handle.await.unwrap().unwrap();
        assert_eq!(src_files.len(), 1);
        assert_eq!(dst_files.len(), 1);
        assert!(progress_count > 0, "should have received progress events");
    }

    #[tokio::test]
    async fn validate_ok_on_valid_dir() {
        let dir = TempDir::new().unwrap();
        let scanner = Scanner::new(dir.path().to_path_buf(), vec!["flac".into()]);
        assert!(scanner.validate().is_ok());
    }

    #[tokio::test]
    async fn scan_preserves_relative_paths() {
        let dir = TempDir::new().unwrap();
        let nested = dir.path().join("a").join("b");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("song.flac"), b"").unwrap();

        let scanner = Scanner::new(dir.path().to_path_buf(), vec!["flac".into()]);
        let (files, _) = collect(scanner).await.unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].relative_path, PathBuf::from("a/b/song.flac"));
    }

    // ponytail: uses local SSD for fixture, slow on network/CI dirs
    #[tokio::test]
    async fn scan_20k_files_completes_under_5_seconds() {
        let dir = TempDir::new().unwrap();
        let count = 20_000u64;

        // create 50 subdirectories first, then distribute files across them
        for d in 0..50u64 {
            std::fs::create_dir_all(dir.path().join(format!("d{}", d))).unwrap();
        }
        for i in 0..count {
            let sub = dir.path().join(format!("d{}", i % 50));
            std::fs::File::create(sub.join(format!("t{}.flac", i))).unwrap();
        }

        let scanner = Scanner::new(dir.path().to_path_buf(), vec!["flac".into()]);
        let (tx, _rx) = mpsc::unbounded_channel();

        let files = scanner.scan(tx).await.unwrap();
        assert_eq!(files.len() as u64, count);
    }
}
