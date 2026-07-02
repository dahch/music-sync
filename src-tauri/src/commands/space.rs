use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceInfo {
    pub total_selected_size: u64,
    pub free_space_on_destination: u64,
}

pub fn calculate_size_and_space_inner(
    destination_root: &str,
    selected_paths: &[String],
) -> Result<SpaceInfo, String> {
    let mut total_selected_size: u64 = 0;
    for p in selected_paths {
        let size = std::fs::metadata(p)
            .map_err(|e| format!("Cannot read file {}: {}", p, e))?
            .len();
        total_selected_size = total_selected_size.checked_add(size).unwrap_or(u64::MAX);
    }

    let free_space = fs2::available_space(destination_root)
        .map_err(|e| format!("Cannot query free space on destination: {}", e))?;

    Ok(SpaceInfo {
        total_selected_size,
        free_space_on_destination: free_space,
    })
}

#[tauri::command]
pub async fn calculate_size_and_space(
    destination_root: String,
    selected_paths: Vec<String>,
) -> Result<SpaceInfo, String> {
    calculate_size_and_space_inner(&destination_root, &selected_paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calculates_total_size_correctly() {
        let dir = tempfile::tempdir().unwrap();
        let f1 = dir.path().join("a.flac");
        let f2 = dir.path().join("b.flac");
        std::fs::write(&f1, vec![0u8; 100]).unwrap();
        std::fs::write(&f2, vec![0u8; 200]).unwrap();

        let paths = vec![
            f1.to_string_lossy().to_string(),
            f2.to_string_lossy().to_string(),
        ];
        let info =
            calculate_size_and_space_inner(&dir.path().to_string_lossy(), &paths).unwrap();

        assert_eq!(info.total_selected_size, 300);
        assert!(info.free_space_on_destination > 0);
    }

    #[test]
    fn empty_paths_returns_zero_size() {
        let dir = tempfile::tempdir().unwrap();
        let info =
            calculate_size_and_space_inner(&dir.path().to_string_lossy(), &[]).unwrap();
        assert_eq!(info.total_selected_size, 0);
        assert!(info.free_space_on_destination > 0);
    }

    #[test]
    fn missing_file_returns_error() {
        let dir = tempfile::tempdir().unwrap();
        let result = calculate_size_and_space_inner(
            &dir.path().to_string_lossy(),
            &["/nonexistent/file.flac".to_string()],
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Cannot read file"));
    }

    #[test]
    fn nonexistent_destination_returns_error() {
        let result =
            calculate_size_and_space_inner("/nonexistent/path/that/does/not/exist", &[]);
        assert!(result.is_err());
    }

    #[test]
    fn handles_single_file_zero_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("empty.flac");
        std::fs::write(&f, []).unwrap();

        let paths = vec![f.to_string_lossy().to_string()];
        let info =
            calculate_size_and_space_inner(&dir.path().to_string_lossy(), &paths).unwrap();
        assert_eq!(info.total_selected_size, 0);
    }

    #[test]
    fn sums_many_files() {
        let dir = tempfile::tempdir().unwrap();
        let mut paths = Vec::new();
        let mut expected = 0u64;
        for i in 0..100 {
            let f = dir.path().join(format!("f{}.flac", i));
            let size = ((i + 1) * 100) as u64;
            std::fs::write(&f, vec![0u8; size as usize]).unwrap();
            paths.push(f.to_string_lossy().to_string());
            expected += size;
        }
        let info =
            calculate_size_and_space_inner(&dir.path().to_string_lossy(), &paths).unwrap();
        assert_eq!(info.total_selected_size, expected);
    }
}
