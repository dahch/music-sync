use music_sync_comparator::Comparator;
use music_sync_domain::{ComparisonLevel, ComparisonResult};
use music_sync_scanner::Scanner;
use std::path::PathBuf;
use tauri::Emitter;

/// Parse a comparison level from its string representation.
///
/// Returns `Err` for unrecognised values; `Ok` otherwise.
/// This is extracted from the command so it can be unit-tested directly.
pub fn parse_comparison_level(s: &str) -> Result<ComparisonLevel, String> {
    match s {
        "Fast" => Ok(ComparisonLevel::Fast),
        "Metadata" => Ok(ComparisonLevel::Metadata),
        "Strict" => Ok(ComparisonLevel::Strict),
        _ => Err("Invalid comparison level. Use Fast, Metadata, or Strict.".into()),
    }
}

#[tauri::command]
pub async fn scan_and_compare(
    app: tauri::AppHandle,
    source_path: String,
    dest_path: String,
    level: String,
) -> Result<ComparisonResult, String> {
    let level = parse_comparison_level(&level)?;

    let extensions: Vec<String> = music_sync_scanner::DEFAULT_EXTENSIONS
        .iter()
        .map(|s| s.to_string())
        .collect();

    let source_scanner = Scanner::new(PathBuf::from(&source_path), extensions.clone());
    let dest_scanner = Scanner::new(PathBuf::from(&dest_path), extensions);

    source_scanner
        .validate()
        .map_err(|e| format!("Source error: {}", e))?;
    dest_scanner
        .validate()
        .map_err(|e| format!("Destination error: {}", e))?;

    let (progress_tx, mut progress_rx) = tokio::sync::mpsc::unbounded_channel();

    let emit_app = app.clone();
    tokio::spawn(async move {
        while let Some(progress) = progress_rx.recv().await {
            let _ = emit_app.emit("scan:progress", &progress);
        }
        let _ = emit_app.emit("scan:done", ());
    });

    let (source_files, dest_files) = music_sync_scanner::scan_pair(
        source_scanner,
        dest_scanner,
        progress_tx,
    )
    .await
    .map_err(|e| format!("Scan error: {}", e))?;

    let comparator = Comparator::new();
    let result = comparator.compare(
        source_files,
        dest_files,
        PathBuf::from(source_path),
        PathBuf::from(dest_path),
        level,
    );

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    mod parse_comparison_level {
        use super::*;

        #[test]
        fn fast_level() {
            assert_eq!(parse_comparison_level("Fast"), Ok(ComparisonLevel::Fast));
        }

        #[test]
        fn metadata_level() {
            assert_eq!(
                parse_comparison_level("Metadata"),
                Ok(ComparisonLevel::Metadata)
            );
        }

        #[test]
        fn strict_level() {
            assert_eq!(
                parse_comparison_level("Strict"),
                Ok(ComparisonLevel::Strict)
            );
        }

        #[test]
        fn invalid_level_returns_error() {
            let err = parse_comparison_level("Unknown").unwrap_err();
            assert!(err.contains("Invalid comparison level"));
        }

        #[test]
        fn empty_string_is_invalid() {
            let err = parse_comparison_level("").unwrap_err();
            assert!(err.contains("Invalid comparison level"));
        }

        #[test]
        fn case_sensitive_fails() {
            let err = parse_comparison_level("fast").unwrap_err();
            assert!(err.contains("Invalid comparison level"));
        }

        #[test]
        fn whitespace_is_invalid() {
            let err = parse_comparison_level(" Fast").unwrap_err();
            assert!(err.contains("Invalid comparison level"));
        }

        #[test]
        fn all_three_levels_are_distinct() {
            let fast = parse_comparison_level("Fast").unwrap();
            let meta = parse_comparison_level("Metadata").unwrap();
            let strict = parse_comparison_level("Strict").unwrap();
            assert_ne!(fast, meta);
            assert_ne!(meta, strict);
            assert_ne!(fast, strict);
        }
    }
}
