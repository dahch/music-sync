use music_sync_domain::{
    ComparisonEntry, ComparisonLevel, ComparisonResult, DiffStatus, MusicFile,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

const DEFAULT_MTIME_TOLERANCE: Duration = Duration::from_secs(2);

pub struct Comparator {
    tolerance_mtime: Duration,
}

impl Comparator {
    pub fn new() -> Self {
        Self {
            tolerance_mtime: DEFAULT_MTIME_TOLERANCE,
        }
    }

    pub fn with_mtime_tolerance(tolerance: Duration) -> Self {
        Self {
            tolerance_mtime: tolerance,
        }
    }

/// Compares two sets of music files and produces a `ComparisonResult`.
///
/// Level 1 (Fast): path-only — matching keys are `Identical` regardless of size/mtime.
/// Level 2 (Metadata): size + mtime within tolerance (default 2s).
/// Level 3 (Strict): currently delegates to Metadata; BLAKE3 hash comparison in F3-01.
///
/// Duplicate `relative_path` values within source or destination are silently
/// deduplicated (last wins via HashMap). The scanner contract guarantees unique
/// paths, so this only matters if input is malformed.
pub fn compare(
        &self,
        source: Vec<MusicFile>,
        destination: Vec<MusicFile>,
        source_root: PathBuf,
        destination_root: PathBuf,
        level: ComparisonLevel,
    ) -> ComparisonResult {
        let source_map: HashMap<PathBuf, MusicFile> =
            source.into_iter().map(|f| (f.relative_path.clone(), f)).collect();
        let dest_map: HashMap<PathBuf, MusicFile> =
            destination.into_iter().map(|f| (f.relative_path.clone(), f)).collect();

        let mut entries: Vec<ComparisonEntry> = Vec::with_capacity(
            source_map.len() + dest_map.len(),
        );

        for (path, src_file) in &source_map {
            let entry = match dest_map.get(path) {
                None => ComparisonEntry::new(
                    path.clone(),
                    DiffStatus::New,
                    Some(src_file.clone()),
                    None,
                ),
                Some(dst_file) => {
                    let status = match level {
                        ComparisonLevel::Fast => DiffStatus::Identical,
                        ComparisonLevel::Metadata | ComparisonLevel::Strict => {
                            compare_level2(src_file, dst_file, self.tolerance_mtime)
                        }
                        // ponytail: Strict should use BLAKE3 hash comparison — F3-01
                    };
                    ComparisonEntry::new(
                        path.clone(),
                        status,
                        Some(src_file.clone()),
                        Some(dst_file.clone()),
                    )
                }
            };
            entries.push(entry);
        }

        for (path, dst_file) in &dest_map {
            if source_map.contains_key(path) {
                continue;
            }
            entries.push(ComparisonEntry::new(
                path.clone(),
                DiffStatus::Orphan,
                None,
                Some(dst_file.clone()),
            ));
        }

        ComparisonResult::new(entries, source_root, destination_root, level)
    }
}

impl Default for Comparator {
    fn default() -> Self {
        Self::new()
    }
}

fn compare_level2(source: &MusicFile, destination: &MusicFile, tolerance: Duration) -> DiffStatus {
    if source.size_bytes != destination.size_bytes {
        return DiffStatus::Different;
    }
    if !mtimes_within_tolerance(source.modified_at, destination.modified_at, tolerance) {
        return DiffStatus::Different;
    }
    DiffStatus::Identical
}

fn mtimes_within_tolerance(a: SystemTime, b: SystemTime, tolerance: Duration) -> bool {
    // `a > b` ensures duration_since is called with the later time first,
    // so the Err branch below is only reachable on platform clock anomalies.
    let diff = if a > b {
        a.duration_since(b)
    } else {
        b.duration_since(a)
    };
    match diff {
        Ok(d) => d <= tolerance,
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use music_sync_domain::MusicFile;
    use std::path::PathBuf;
    use std::time::{Duration, SystemTime};

    fn file(path: &str, size: u64, modified: SystemTime) -> MusicFile {
        MusicFile::new(
            PathBuf::from(path),
            PathBuf::from(path),
            size,
            modified,
            "flac".into(),
        )
    }

    fn epoch() -> SystemTime {
        SystemTime::UNIX_EPOCH
    }

    fn secs(s: u64) -> Duration {
        Duration::from_secs(s)
    }

    fn cmp(source: Vec<MusicFile>, dest: Vec<MusicFile>) -> ComparisonResult {
        Comparator::new().compare(
            source, dest,
            PathBuf::new(), PathBuf::new(),
            ComparisonLevel::Metadata,
        )
    }

    fn find_entry<'a>(result: &'a ComparisonResult, path: &str) -> Option<&'a ComparisonEntry> {
        result.entries.iter().find(|e| e.relative_path == PathBuf::from(path))
    }

    // ----- Level 2 (Metadata) tests -----

    #[test]
    fn new_file_becomes_new() {
        let result = cmp(
            vec![file("song.flac", 100, epoch())],
            vec![],
        );
        assert_eq!(result.stats.total_new, 1);
        assert_eq!(result.stats.total_orphan, 0);
        let e = find_entry(&result, "song.flac").unwrap();
        assert_eq!(e.status, DiffStatus::New);
        assert!(e.source.is_some());
        assert!(e.destination.is_none());
    }

    #[test]
    fn orphan_file_becomes_orphan() {
        let result = cmp(
            vec![],
            vec![file("orphan.flac", 100, epoch())],
        );
        assert_eq!(result.stats.total_orphan, 1);
        assert_eq!(result.stats.total_new, 0);
        let e = find_entry(&result, "orphan.flac").unwrap();
        assert_eq!(e.status, DiffStatus::Orphan);
        assert!(e.source.is_none());
        assert!(e.destination.is_some());
    }

    #[test]
    fn identical_files_marked_identical() {
        let t = epoch();
        let result = cmp(
            vec![file("same.flac", 500, t)],
            vec![file("same.flac", 500, t)],
        );
        assert_eq!(result.stats.total_identical, 1);
        let e = find_entry(&result, "same.flac").unwrap();
        assert_eq!(e.status, DiffStatus::Identical);
    }

    #[test]
    fn different_size_marked_different() {
        let t = epoch();
        let result = cmp(
            vec![file("f.flac", 1000, t)],
            vec![file("f.flac", 500, t)],
        );
        assert_eq!(result.stats.total_different, 1);
        let e = find_entry(&result, "f.flac").unwrap();
        assert_eq!(e.status, DiffStatus::Different);
    }

    #[test]
    fn mtime_outside_tolerance_marked_different() {
        let result = cmp(
            vec![file("f.flac", 100, epoch())],
            vec![file("f.flac", 100, epoch() + secs(3))],
        );
        assert_eq!(result.stats.total_different, 1);
    }

    #[test]
    fn mtime_inside_tolerance_marked_identical() {
        let result = cmp(
            vec![file("f.flac", 100, epoch())],
            vec![file("f.flac", 100, epoch() + secs(1))],
        );
        assert_eq!(result.stats.total_identical, 1);
    }

    #[test]
    fn mtime_exactly_at_tolerance_marked_identical() {
        let result = cmp(
            vec![file("f.flac", 100, epoch())],
            vec![file("f.flac", 100, epoch() + secs(2))],
        );
        assert_eq!(result.stats.total_identical, 1);
    }

    #[test]
    fn mtime_earlier_on_destination_marked_identical() {
        let result = cmp(
            vec![file("f.flac", 100, epoch() + secs(1))],
            vec![file("f.flac", 100, epoch())],
        );
        assert_eq!(result.stats.total_identical, 1);
    }

    #[test]
    fn mixed_statuses_all_counted() {
        let t = epoch();
        let src = vec![
            file("new.flac", 10, t),
            file("same.flac", 20, t),
            file("diff.flac", 30, t + secs(5)),
        ];
        let dst = vec![
            file("same.flac", 20, t),
            file("diff.flac", 30, t),
            file("orphan.flac", 40, t),
        ];
        let result = cmp(src, dst);
        assert_eq!(result.stats.total_new, 1);
        assert_eq!(result.stats.total_identical, 1);
        assert_eq!(result.stats.total_different, 1);
        assert_eq!(result.stats.total_orphan, 1);
        assert_eq!(result.entries.len(), 4);
    }

    #[test]
    fn stats_accumulate_sizes() {
        let t = epoch();
        let src = vec![
            file("new1.flac", 100, t),
            file("new2.flac", 200, t),
            file("diff.flac", 300, t),
        ];
        let dst = vec![file("diff.flac", 250, t)];
        let result = cmp(src, dst);
        assert_eq!(result.stats.total_new, 2);
        assert_eq!(result.stats.total_size_new, 300);
        assert_eq!(result.stats.total_different, 1);
        assert_eq!(result.stats.total_size_different, 300);
    }

    #[test]
    fn empty_both_returns_empty() {
        let result = cmp(vec![], vec![]);
        assert_eq!(result.entries.len(), 0);
        assert_eq!(result.stats.total_new, 0);
    }

    #[test]
    fn many_files_only_in_source() {
        let src: Vec<_> = (0..100)
            .map(|i| file(&format!("f{}.flac", i), i, epoch()))
            .collect();
        let result = cmp(src, vec![]);
        assert_eq!(result.stats.total_new, 100);
        assert_eq!(result.stats.total_orphan, 0);
    }

    #[test]
    fn many_files_only_in_destination() {
        let dst: Vec<_> = (0..100)
            .map(|i| file(&format!("f{}.flac", i), i, epoch()))
            .collect();
        let result = cmp(vec![], dst);
        assert_eq!(result.stats.total_orphan, 100);
        assert_eq!(result.stats.total_new, 0);
    }

    #[test]
    fn default_tolerance_is_two_seconds() {
        let c = Comparator::new();
        let a = file("f.flac", 100, epoch());
        let b = file("f.flac", 100, epoch() + secs(3));
        let result = c.compare(
            vec![a], vec![b],
            PathBuf::new(), PathBuf::new(),
            ComparisonLevel::Metadata,
        );
        assert_eq!(result.stats.total_different, 1);
    }

    #[test]
    fn custom_tolerance_is_respected() {
        let c = Comparator::with_mtime_tolerance(secs(5));
        let a = file("f.flac", 100, epoch());
        let b = file("f.flac", 100, epoch() + secs(3));
        let result = c.compare(
            vec![a], vec![b],
            PathBuf::new(), PathBuf::new(),
            ComparisonLevel::Metadata,
        );
        assert_eq!(result.stats.total_identical, 1);
    }

    #[test]
    fn mtime_before_unix_epoch_is_safe() {
        let early = SystemTime::UNIX_EPOCH - secs(10);
        let result = cmp(
            vec![file("f.flac", 100, early)],
            vec![file("f.flac", 100, epoch())],
        );
        assert_eq!(result.stats.total_different, 1);
    }

    #[test]
    fn new_entry_has_selected_false() {
        let result = cmp(
            vec![file("f.flac", 100, epoch())],
            vec![],
        );
        let e = find_entry(&result, "f.flac").unwrap();
        assert!(!e.selected);
    }

    // ----- Level 1 (Fast) tests -----

    #[test]
    fn fast_level_marks_matching_files_identical_regardless_of_size() {
        let t = epoch();
        let result = Comparator::new().compare(
            vec![file("f.flac", 100, t)],
            vec![file("f.flac", 999, t)],
            PathBuf::new(), PathBuf::new(),
            ComparisonLevel::Fast,
        );
        assert_eq!(result.stats.total_identical, 1);
    }

    #[test]
    fn fast_level_marks_matching_files_identical_regardless_of_mtime() {
        let result = Comparator::new().compare(
            vec![file("f.flac", 100, epoch())],
            vec![file("f.flac", 100, epoch() + secs(99))],
            PathBuf::new(), PathBuf::new(),
            ComparisonLevel::Fast,
        );
        assert_eq!(result.stats.total_identical, 1);
    }

    #[test]
    fn fast_level_still_detects_new_and_orphan() {
        let t = epoch();
        let result = Comparator::new().compare(
            vec![file("a.flac", 1, t)],
            vec![file("b.flac", 2, t)],
            PathBuf::new(), PathBuf::new(),
            ComparisonLevel::Fast,
        );
        assert_eq!(result.stats.total_new, 1);
        assert_eq!(result.stats.total_orphan, 1);
        assert_eq!(result.stats.total_identical, 0);
    }

    // ----- Root paths -----

    #[test]
    fn compare_preserves_source_root() {
        let result = Comparator::new().compare(
            vec![file("f.flac", 0, epoch())],
            vec![],
            PathBuf::from("/src"), PathBuf::new(),
            ComparisonLevel::Fast,
        );
        assert_eq!(result.source_root, PathBuf::from("/src"));
    }

    #[test]
    fn compare_preserves_destination_root() {
        let result = Comparator::new().compare(
            vec![],
            vec![file("f.flac", 0, epoch())],
            PathBuf::new(), PathBuf::from("/dst"),
            ComparisonLevel::Fast,
        );
        assert_eq!(result.destination_root, PathBuf::from("/dst"));
    }

    #[test]
    fn compare_preserves_level_in_result() {
        let result = Comparator::new().compare(
            vec![], vec![],
            PathBuf::new(), PathBuf::new(),
            ComparisonLevel::Strict,
        );
        assert_eq!(result.comparison_level, ComparisonLevel::Strict);
    }

    // ----- Strict (delegates to Metadata until F3-01) -----

    #[test]
    fn strict_level_delegates_to_metadata() {
        let t = epoch();
        let result = Comparator::new().compare(
            vec![file("f.flac", 100, t)],
            vec![file("f.flac", 200, t)],
            PathBuf::new(), PathBuf::new(),
            ComparisonLevel::Strict,
        );
        // size mismatch → Different even in Strict (no hash yet)
        assert_eq!(result.stats.total_different, 1);
    }

    // ----- Default trait -----

    #[test]
    fn default_trait_uses_two_second_tolerance() {
        let c: Comparator = Default::default();
        let a = file("f.flac", 100, epoch());
        let b = file("f.flac", 100, epoch() + secs(3));
        let result = c.compare(
            vec![a], vec![b],
            PathBuf::new(), PathBuf::new(),
            ComparisonLevel::Metadata,
        );
        assert_eq!(result.stats.total_different, 1);
    }

    // ----- Boundary tolerances -----

    #[test]
    fn zero_tolerance_requires_exact_mtime_match() {
        let c = Comparator::with_mtime_tolerance(secs(0));
        let t = epoch();
        let result = c.compare(
            vec![file("a.flac", 100, t)],
            vec![file("a.flac", 100, t)],
            PathBuf::new(), PathBuf::new(),
            ComparisonLevel::Metadata,
        );
        assert_eq!(result.stats.total_identical, 1);

        // one nanosecond off → different
        let result = c.compare(
            vec![file("b.flac", 100, t)],
            vec![file("b.flac", 100, t + Duration::from_nanos(1))],
            PathBuf::new(), PathBuf::new(),
            ComparisonLevel::Metadata,
        );
        assert_eq!(result.stats.total_different, 1);
    }

    #[test]
    fn large_tolerance_absorbs_large_mtime_diff() {
        let c = Comparator::with_mtime_tolerance(Duration::from_secs(86_400 * 365 * 10)); // 10 years
        let result = c.compare(
            vec![file("f.flac", 100, epoch())],
            vec![file("f.flac", 100, epoch() + secs(86_400 * 365))], // 1 year later
            PathBuf::new(), PathBuf::new(),
            ComparisonLevel::Metadata,
        );
        assert_eq!(result.stats.total_identical, 1);
    }

    // ----- Duplicate path edge cases -----

    #[test]
    fn duplicate_source_path_last_wins() {
        let t = epoch();
        // Two source entries with the same relative path but different sizes.
        // HashMap overwrites: the last one's properties determine the comparison.
        let result = cmp(
            vec![
                file("dup.flac", 100, t),
                file("dup.flac", 200, t),
            ],
            vec![file("dup.flac", 150, t)],
        );
        // The second source entry (size=200) is compared against dest (size=150) → Different
        assert_eq!(result.stats.total_different, 1);
        let e = find_entry(&result, "dup.flac").unwrap();
        assert_eq!(e.status, DiffStatus::Different);
    }

    #[test]
    fn duplicate_destination_path_no_duplicate_orphan() {
        let t = epoch();
        // Two dest entries with the same relative path.
        // HashMap overwrites: only one orphan entry emitted.
        let result = cmp(
            vec![],
            vec![
                file("dup.flac", 100, t),
                file("dup.flac", 200, t),
            ],
        );
        assert_eq!(result.stats.total_orphan, 1);
        assert_eq!(result.entries.len(), 1);
    }

    #[test]
    fn duplicate_source_paths_unique_entries_all_new() {
        let t = epoch();
        // All files in source with unique paths → each is New
        let result = cmp(
            vec![
                file("a.flac", 100, t),
                file("a.flac", 200, t),
                file("b.flac", 300, t),
            ],
            vec![file("b.flac", 300, t)],
        );
        // a.flac appears once (overwritten by last), b.flac is identical
        assert_eq!(result.stats.total_new, 1);
        assert_eq!(result.stats.total_identical, 1);
        assert_eq!(result.entries.len(), 2);
    }
}
