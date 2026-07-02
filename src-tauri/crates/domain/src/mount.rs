use std::path::Path;

/// Returns `true` if `path` is still accessible on a mounted filesystem.
///
/// # Platform notes
/// - macOS: a removed `/Volumes/NAME` entry returns `NotFound` → `false`
/// - Windows: a disconnected drive may return `NotFound` or a device error → `false`
/// - Linux: an unmounted `/media/user/DEVICE` returns `NotFound` → `false`
///
/// The only "accessible" error we tolerate is `PermissionDenied` — the path
/// exists but we can't read its metadata, which is not the same as unmounted.
pub fn is_path_mounted(path: &Path) -> bool {
    match std::fs::metadata(path) {
        Ok(_) => true,
        Err(e) => e.kind() == std::io::ErrorKind::PermissionDenied,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn existing_temp_dir_is_mounted() {
        let dir = TempDir::new().unwrap();
        assert!(is_path_mounted(dir.path()));
    }

    #[test]
    fn nonexistent_path_is_not_mounted() {
        assert!(!is_path_mounted(Path::new(
            "/nonexistent/path/that/will/never/exist/12345"
        )));
    }

    #[test]
    fn deleted_dir_is_not_mounted() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().to_path_buf();
        drop(dir);
        assert!(!is_path_mounted(&path));
    }

    #[test]
    fn regular_file_is_mounted() {
        let dir = TempDir::new().unwrap();
        let file_path = dir.path().join("test.txt");
        std::fs::write(&file_path, b"hello").unwrap();
        assert!(is_path_mounted(&file_path));
    }

    #[test]
    fn empty_path_is_not_mounted() {
        assert!(!is_path_mounted(Path::new("")));
    }
}
