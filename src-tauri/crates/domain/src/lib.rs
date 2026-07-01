use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::SystemTime;

pub type Blake3Hash = [u8; 32];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MusicFile {
    pub relative_path: PathBuf,
    pub absolute_path: PathBuf,
    pub size_bytes: u64,
    pub modified_at: SystemTime,
    pub extension: String,
    pub content_hash: Option<Blake3Hash>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DiffStatus {
    New,
    Orphan,
    Identical,
    Different,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ComparisonLevel {
    Fast,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComparisonStats {
    pub total_new: u64,
    pub total_orphan: u64,
    pub total_identical: u64,
    pub total_different: u64,
    pub total_size_new: u64,
    pub total_size_different: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComparisonEntry {
    pub relative_path: PathBuf,
    pub status: DiffStatus,
    pub source: Option<MusicFile>,
    pub destination: Option<MusicFile>,
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComparisonResult {
    pub entries: Vec<ComparisonEntry>,
    pub scanned_at: SystemTime,
    pub source_root: PathBuf,
    pub destination_root: PathBuf,
    pub comparison_level: ComparisonLevel,
    pub stats: ComparisonStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopyTask {
    pub entry: ComparisonEntry,
    pub status: CopyStatus,
    pub bytes_copied: u64,
    pub retries: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncProfile {
    pub id: String,
    pub name: String,
    pub source_root: PathBuf,
    pub destination_root: PathBuf,
    pub default_comparison_level: ComparisonLevel,
    pub last_synced_at: Option<SystemTime>,
}
