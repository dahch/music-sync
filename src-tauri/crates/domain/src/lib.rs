use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::SystemTime;

pub type Blake3Hash = [u8; 32];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicFile {
    pub relative_path: PathBuf,
    pub absolute_path: PathBuf,
    pub size_bytes: u64,
    pub modified_at: SystemTime,
    pub extension: String,
    pub content_hash: Option<Blake3Hash>,
}

impl MusicFile {
    pub fn new(
        relative_path: PathBuf,
        absolute_path: PathBuf,
        size_bytes: u64,
        modified_at: SystemTime,
        extension: String,
    ) -> Self {
        Self {
            relative_path,
            absolute_path,
            size_bytes,
            modified_at,
            extension,
            content_hash: None,
        }
    }

    pub fn with_hash(mut self, hash: Blake3Hash) -> Self {
        self.content_hash = Some(hash);
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DiffStatus {
    New,
    Orphan,
    Identical,
    Different,
}

impl DiffStatus {
    pub fn needs_copy(&self) -> bool {
        matches!(self, Self::New | Self::Different)
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ComparisonLevel {
    Fast,
    #[default]
    Metadata,
    Strict,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CopyStatus {
    Pending,
    InProgress,
    Verifying,
    Done,
    Failed(String),
    Skipped,
}

impl CopyStatus {
    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Done | Self::Failed(_) | Self::Skipped)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonStats {
    pub total_new: u64,
    pub total_orphan: u64,
    pub total_identical: u64,
    pub total_different: u64,
    pub total_size_new: u64,
    pub total_size_different: u64,
}

impl ComparisonStats {
    pub fn new() -> Self {
        Self {
            total_new: 0,
            total_orphan: 0,
            total_identical: 0,
            total_different: 0,
            total_size_new: 0,
            total_size_different: 0,
        }
    }

    pub fn add_entry(&mut self, status: DiffStatus, size: u64) {
        match status {
            DiffStatus::New => {
                self.total_new += 1;
                self.total_size_new += size;
            }
            DiffStatus::Different => {
                self.total_different += 1;
                self.total_size_different += size;
            }
            DiffStatus::Identical => self.total_identical += 1,
            DiffStatus::Orphan => self.total_orphan += 1,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonEntry {
    pub relative_path: PathBuf,
    pub status: DiffStatus,
    pub source: Option<MusicFile>,
    pub destination: Option<MusicFile>,
    pub selected: bool,
}

impl ComparisonEntry {
    pub fn new(
        relative_path: PathBuf,
        status: DiffStatus,
        source: Option<MusicFile>,
        destination: Option<MusicFile>,
    ) -> Self {
        Self {
            relative_path,
            status,
            source,
            destination,
            selected: false,
        }
    }

    pub fn toggle(&mut self) {
        self.selected = !self.selected;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonResult {
    pub entries: Vec<ComparisonEntry>,
    pub scanned_at: SystemTime,
    pub source_root: PathBuf,
    pub destination_root: PathBuf,
    pub comparison_level: ComparisonLevel,
    pub stats: ComparisonStats,
}

impl ComparisonResult {
    pub fn new(
        entries: Vec<ComparisonEntry>,
        source_root: PathBuf,
        destination_root: PathBuf,
        comparison_level: ComparisonLevel,
    ) -> Self {
        let stats = Self::compute_stats(&entries);
        Self {
            entries,
            scanned_at: SystemTime::now(),
            source_root,
            destination_root,
            comparison_level,
            stats,
        }
    }

    pub fn compute_stats(entries: &[ComparisonEntry]) -> ComparisonStats {
        let mut stats = ComparisonStats::new();
        for entry in entries {
            let size = entry
                .source
                .as_ref()
                .map(|f| f.size_bytes)
                .unwrap_or(0);
            stats.add_entry(entry.status, size);
        }
        stats
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyTask {
    pub entry: ComparisonEntry,
    pub status: CopyStatus,
    pub bytes_copied: u64,
    pub retries: u8,
}

impl CopyTask {
    pub fn new(entry: ComparisonEntry) -> Self {
        Self {
            entry,
            status: CopyStatus::Pending,
            bytes_copied: 0,
            retries: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProfile {
    pub id: String,
    pub name: String,
    pub source_root: PathBuf,
    pub destination_root: PathBuf,
    pub default_comparison_level: ComparisonLevel,
    pub last_synced_at: Option<SystemTime>,
}

impl SyncProfile {
    pub fn new(
        id: String,
        name: String,
        source_root: PathBuf,
        destination_root: PathBuf,
    ) -> Self {
        Self {
            id,
            name,
            source_root,
            destination_root,
            default_comparison_level: ComparisonLevel::default(),
            last_synced_at: None,
        }
    }

    pub fn mark_synced(&mut self) {
        self.last_synced_at = Some(SystemTime::now());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_music_file(relative: &str, size: u64) -> MusicFile {
        MusicFile::new(
            PathBuf::from(relative),
            PathBuf::from("/test").join(relative),
            size,
            SystemTime::UNIX_EPOCH,
            "flac".to_string(),
        )
    }

    mod music_file {
        use super::*;

        #[test]
        fn new_sets_defaults() {
            let f = sample_music_file("song.flac", 1024);
            assert_eq!(f.relative_path, PathBuf::from("song.flac"));
            assert_eq!(f.absolute_path, PathBuf::from("/test/song.flac"));
            assert_eq!(f.size_bytes, 1024);
            assert_eq!(f.extension, "flac");
            assert_eq!(f.content_hash, None);
        }

        #[test]
        fn with_hash_sets_hash() {
            let hash = [42u8; 32];
            let f = sample_music_file("a.flac", 100).with_hash(hash);
            assert_eq!(f.content_hash, Some(hash));
        }

        #[test]
        fn new_with_empty_extension() {
            let f = MusicFile::new(
                PathBuf::from("no_ext"),
                PathBuf::from("/test/no_ext"),
                0,
                SystemTime::UNIX_EPOCH,
                String::new(),
            );
            assert_eq!(f.extension, "");
            assert_eq!(f.size_bytes, 0);
        }

        #[test]
        fn serde_roundtrip() {
            let f = sample_music_file("sub/file.mp3", 2048).with_hash([1u8; 32]);
            let json = serde_json::to_string(&f).unwrap();
            let back: MusicFile = serde_json::from_str(&json).unwrap();
            assert_eq!(f, back);
        }
    }

    mod diff_status {
        use super::*;

        #[test]
        fn needs_copy_is_true_for_new_and_different() {
            assert!(DiffStatus::New.needs_copy());
            assert!(DiffStatus::Different.needs_copy());
        }

        #[test]
        fn needs_copy_is_false_for_orphan_and_identical() {
            assert!(!DiffStatus::Orphan.needs_copy());
            assert!(!DiffStatus::Identical.needs_copy());
        }

        #[test]
        fn serde_roundtrip() {
            for variant in &[DiffStatus::New, DiffStatus::Orphan, DiffStatus::Identical, DiffStatus::Different] {
                let json = serde_json::to_string(variant).unwrap();
                let back: DiffStatus = serde_json::from_str(&json).unwrap();
                assert_eq!(*variant, back);
            }
        }
    }

    mod comparison_level {
        use super::*;

        #[test]
        fn default_is_metadata() {
            assert_eq!(ComparisonLevel::default(), ComparisonLevel::Metadata);
        }

        #[test]
        fn serde_roundtrip() {
            for variant in &[ComparisonLevel::Fast, ComparisonLevel::Metadata, ComparisonLevel::Strict] {
                let json = serde_json::to_string(variant).unwrap();
                let back: ComparisonLevel = serde_json::from_str(&json).unwrap();
                assert_eq!(*variant, back);
            }
        }
    }

    mod copy_status {
        use super::*;

        #[test]
        fn is_terminal_for_completed_statuses() {
            assert!(CopyStatus::Done.is_terminal());
            assert!(CopyStatus::Failed("err".into()).is_terminal());
            assert!(CopyStatus::Skipped.is_terminal());
        }

        #[test]
        fn is_terminal_false_for_active_statuses() {
            assert!(!CopyStatus::Pending.is_terminal());
            assert!(!CopyStatus::InProgress.is_terminal());
            assert!(!CopyStatus::Verifying.is_terminal());
        }

        #[test]
        fn serde_roundtrip_for_unit_variants() {
            for variant in &[
                CopyStatus::Pending,
                CopyStatus::InProgress,
                CopyStatus::Verifying,
                CopyStatus::Done,
                CopyStatus::Skipped,
            ] {
                let json = serde_json::to_string(variant).unwrap();
                let back: CopyStatus = serde_json::from_str(&json).unwrap();
                assert_eq!(*variant, back);
            }
        }

        #[test]
        fn serde_roundtrip_for_failed() {
            let variant = CopyStatus::Failed("disk full".into());
            let json = serde_json::to_string(&variant).unwrap();
            let back: CopyStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(back, variant);
        }

        #[test]
        fn is_terminal_all_six_variants() {
            let cases: Vec<(CopyStatus, bool)> = vec![
                (CopyStatus::Pending, false),
                (CopyStatus::InProgress, false),
                (CopyStatus::Verifying, false),
                (CopyStatus::Done, true),
                (CopyStatus::Failed("".into()), true),
                (CopyStatus::Skipped, true),
            ];
            for (status, expected) in cases {
                assert_eq!(
                    status.is_terminal(),
                    expected,
                    "CopyStatus::is_terminal() for {:?} should be {}",
                    status,
                    expected
                );
            }
        }
    }

    mod comparison_stats {
        use super::*;

        #[test]
        fn new_is_zeroed() {
            let s = ComparisonStats::new();
            assert_eq!(s.total_new, 0);
            assert_eq!(s.total_size_new, 0);
            assert_eq!(s.total_orphan, 0);
            assert_eq!(s.total_identical, 0);
            assert_eq!(s.total_different, 0);
            assert_eq!(s.total_size_different, 0);
        }

        #[test]
        fn add_entry_increments_correctly() {
            let mut s = ComparisonStats::new();
            s.add_entry(DiffStatus::New, 100);
            s.add_entry(DiffStatus::Different, 200);
            s.add_entry(DiffStatus::Identical, 0);
            s.add_entry(DiffStatus::Orphan, 0);
            assert_eq!(s.total_new, 1);
            assert_eq!(s.total_size_new, 100);
            assert_eq!(s.total_different, 1);
            assert_eq!(s.total_size_different, 200);
            assert_eq!(s.total_identical, 1);
            assert_eq!(s.total_orphan, 1);
        }

        #[test]
        fn default_is_zeroed() {
            assert_eq!(ComparisonStats::default(), ComparisonStats::new());
        }

        #[test]
        fn serde_roundtrip() {
            let mut s = ComparisonStats::new();
            s.add_entry(DiffStatus::New, 500);
            s.add_entry(DiffStatus::Different, 1000);
            let json = serde_json::to_string(&s).unwrap();
            let back: ComparisonStats = serde_json::from_str(&json).unwrap();
            assert_eq!(back.total_new, 1);
            assert_eq!(back.total_size_new, 500);
            assert_eq!(back.total_different, 1);
            assert_eq!(back.total_size_different, 1000);
        }

        #[test]
        fn add_entry_accumulates_multiple_entries_of_same_type() {
            let mut s = ComparisonStats::new();
            s.add_entry(DiffStatus::New, 100);
            s.add_entry(DiffStatus::New, 200);
            s.add_entry(DiffStatus::Different, 50);
            s.add_entry(DiffStatus::Different, 150);
            s.add_entry(DiffStatus::Identical, 0);
            s.add_entry(DiffStatus::Identical, 0);
            s.add_entry(DiffStatus::Orphan, 0);
            s.add_entry(DiffStatus::Orphan, 0);
            assert_eq!(s.total_new, 2);
            assert_eq!(s.total_size_new, 300);
            assert_eq!(s.total_different, 2);
            assert_eq!(s.total_size_different, 200);
            assert_eq!(s.total_identical, 2);
            assert_eq!(s.total_orphan, 2);
        }

        #[test]
        fn add_entry_with_zero_size_for_new_and_different() {
            let mut s = ComparisonStats::new();
            s.add_entry(DiffStatus::New, 0);
            s.add_entry(DiffStatus::Different, 0);
            assert_eq!(s.total_new, 1);
            assert_eq!(s.total_size_new, 0);
            assert_eq!(s.total_different, 1);
            assert_eq!(s.total_size_different, 0);
        }
    }

    mod comparison_entry {
        use super::*;

        #[test]
        fn new_sets_selected_false() {
            let entry = ComparisonEntry::new(
                PathBuf::from("song.flac"),
                DiffStatus::New,
                Some(sample_music_file("song.flac", 100)),
                None,
            );
            assert!(!entry.selected);
            assert_eq!(entry.status, DiffStatus::New);
        }

        #[test]
        fn toggle_flips_selected() {
            let mut entry = ComparisonEntry::new(
                PathBuf::from("song.flac"),
                DiffStatus::New,
                None,
                None,
            );
            entry.toggle();
            assert!(entry.selected);
            entry.toggle();
            assert!(!entry.selected);
        }

        #[test]
        fn serde_roundtrip() {
            let entry = ComparisonEntry::new(
                PathBuf::from("a/b/c.flac"),
                DiffStatus::Different,
                Some(sample_music_file("c.flac", 500)),
                Some(sample_music_file("c.flac", 400)),
            );
            let json = serde_json::to_string(&entry).unwrap();
            let back: ComparisonEntry = serde_json::from_str(&json).unwrap();
            assert_eq!(back.relative_path, PathBuf::from("a/b/c.flac"));
            assert_eq!(back.status, DiffStatus::Different);
            assert!(back.source.is_some());
            assert!(back.destination.is_some());
        }

        #[test]
        fn serde_roundtrip_with_nulls() {
            let entry = ComparisonEntry::new(
                PathBuf::from("orphan.txt"),
                DiffStatus::Orphan,
                None,
                Some(sample_music_file("orphan.txt", 50)),
            );
            let json = serde_json::to_string(&entry).unwrap();
            let back: ComparisonEntry = serde_json::from_str(&json).unwrap();
            assert!(back.source.is_none());
            assert!(back.destination.is_some());
        }

        #[test]
        fn serde_roundtrip_both_none() {
            let entry = ComparisonEntry::new(
                PathBuf::from("ghost.txt"),
                DiffStatus::New,
                None,
                None,
            );
            let json = serde_json::to_string(&entry).unwrap();
            let back: ComparisonEntry = serde_json::from_str(&json).unwrap();
            assert!(back.source.is_none());
            assert!(back.destination.is_none());
            assert_eq!(back.status, DiffStatus::New);
        }
    }

    mod comparison_result {
        use super::*;

        #[test]
        fn new_computes_stats() {
            let entries = vec![
                ComparisonEntry::new(
                    PathBuf::from("new.flac"),
                    DiffStatus::New,
                    Some(sample_music_file("new.flac", 1000)),
                    None,
                ),
                ComparisonEntry::new(
                    PathBuf::from("diff.flac"),
                    DiffStatus::Different,
                    Some(sample_music_file("diff.flac", 2000)),
                    Some(sample_music_file("diff.flac", 1500)),
                ),
                ComparisonEntry::new(
                    PathBuf::from("same.flac"),
                    DiffStatus::Identical,
                    Some(sample_music_file("same.flac", 500)),
                    Some(sample_music_file("same.flac", 500)),
                ),
            ];

            let result = ComparisonResult::new(
                entries,
                PathBuf::from("/source"),
                PathBuf::from("/dest"),
                ComparisonLevel::Metadata,
            );

            assert_eq!(result.stats.total_new, 1);
            assert_eq!(result.stats.total_size_new, 1000);
            assert_eq!(result.stats.total_different, 1);
            assert_eq!(result.stats.total_size_different, 2000);
            assert_eq!(result.stats.total_identical, 1);
            assert_eq!(result.stats.total_orphan, 0);
        }

        #[test]
        fn serde_roundtrip() {
            let entries = vec![ComparisonEntry::new(
                PathBuf::from("a.flac"),
                DiffStatus::New,
                Some(sample_music_file("a.flac", 100)),
                None,
            )];
            let result = ComparisonResult::new(
                entries,
                PathBuf::from("/s"),
                PathBuf::from("/d"),
                ComparisonLevel::Fast,
            );
            let json = serde_json::to_string(&result).unwrap();
            let back: ComparisonResult = serde_json::from_str(&json).unwrap();
            assert_eq!(back.source_root, PathBuf::from("/s"));
            assert_eq!(back.destination_root, PathBuf::from("/d"));
            assert_eq!(back.stats.total_new, 1);
        }

        #[test]
        fn new_with_empty_entries() {
            let result = ComparisonResult::new(
                vec![],
                PathBuf::from("/src"),
                PathBuf::from("/dst"),
                ComparisonLevel::Strict,
            );
            assert!(result.entries.is_empty());
            assert_eq!(result.stats.total_new, 0);
            assert_eq!(result.stats.total_orphan, 0);
            assert_eq!(result.stats.total_identical, 0);
            assert_eq!(result.stats.total_different, 0);
        }

        #[test]
        fn compute_stats_with_orphan_entry() {
            let entries = vec![
                ComparisonEntry::new(
                    PathBuf::from("orphan.txt"),
                    DiffStatus::Orphan,
                    None,
                    Some(sample_music_file("orphan.txt", 500)),
                ),
                ComparisonEntry::new(
                    PathBuf::from("new.flac"),
                    DiffStatus::New,
                    Some(sample_music_file("new.flac", 1000)),
                    None,
                ),
            ];
            let result = ComparisonResult::new(
                entries,
                PathBuf::from("/src"),
                PathBuf::from("/dst"),
                ComparisonLevel::Metadata,
            );
            assert_eq!(result.stats.total_orphan, 1);
            assert_eq!(result.stats.total_new, 1);
            assert_eq!(result.stats.total_size_new, 1000);
        }

        #[test]
        fn new_sets_scanned_at() {
            let before = SystemTime::now();
            let result = ComparisonResult::new(
                vec![],
                PathBuf::from("/src"),
                PathBuf::from("/dst"),
                ComparisonLevel::Fast,
            );
            let after = SystemTime::now();
            assert!(result.scanned_at >= before);
            assert!(result.scanned_at <= after);
        }
    }

    mod copy_task {
        use super::*;

        #[test]
        fn new_sets_pending() {
            let entry = ComparisonEntry::new(
                PathBuf::from("f.flac"),
                DiffStatus::New,
                Some(sample_music_file("f.flac", 42)),
                None,
            );
            let task = CopyTask::new(entry);
            assert_eq!(task.status, CopyStatus::Pending);
            assert_eq!(task.bytes_copied, 0);
            assert_eq!(task.retries, 0);
        }

        #[test]
        fn serde_roundtrip() {
            let entry = ComparisonEntry::new(
                PathBuf::from("f.flac"),
                DiffStatus::New,
                Some(sample_music_file("f.flac", 42)),
                None,
            );
            let task = CopyTask {
                entry,
                status: CopyStatus::Failed("timeout".into()),
                bytes_copied: 10,
                retries: 2,
            };
            let json = serde_json::to_string(&task).unwrap();
            let back: CopyTask = serde_json::from_str(&json).unwrap();
            assert_eq!(back.status, CopyStatus::Failed("timeout".into()));
            assert_eq!(back.bytes_copied, 10);
            assert_eq!(back.retries, 2);
        }
    }

    mod sync_profile {
        use super::*;

        #[test]
        fn new_sets_default_level() {
            let profile = SyncProfile::new(
                "id-1".into(),
                "Test".into(),
                PathBuf::from("/source"),
                PathBuf::from("/dest"),
            );
            assert_eq!(profile.id, "id-1");
            assert_eq!(profile.name, "Test");
            assert_eq!(profile.default_comparison_level, ComparisonLevel::Metadata);
            assert!(profile.last_synced_at.is_none());
        }

        #[test]
        fn mark_synced_sets_timestamp() {
            let mut profile = SyncProfile::new(
                "p1".into(),
                "p".into(),
                PathBuf::from("/a"),
                PathBuf::from("/b"),
            );
            assert!(profile.last_synced_at.is_none());
            profile.mark_synced();
            assert!(profile.last_synced_at.is_some());
        }

        #[test]
        fn serde_roundtrip() {
            let profile = SyncProfile::new(
                "uuid-abc".into(),
                "Librería FLAC → FiiO M11".into(),
                PathBuf::from("/music/flac"),
                PathBuf::from("/Volumes/FIIO/MUSIC"),
            );
            let json = serde_json::to_string(&profile).unwrap();
            let back: SyncProfile = serde_json::from_str(&json).unwrap();
            assert_eq!(back.id, "uuid-abc");
            assert_eq!(back.name, "Librería FLAC → FiiO M11");
            assert_eq!(back.source_root, PathBuf::from("/music/flac"));
        }
    }
}
