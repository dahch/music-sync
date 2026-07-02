use music_sync_domain::{ComparisonLevel, SyncProfile};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Mutex, PoisonError};

const MIGRATIONS: &[(&str, &str)] = &[(
    "v1_sync_tables",
    include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../migrations/001_sync_tables.sql"
    )),
)];

pub(crate) fn run_migrations(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _schema_version (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )?;

    let current: usize = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM _schema_version",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    for (i, &(name, sql)) in MIGRATIONS.iter().enumerate() {
        let version = i + 1;
        if version > current {
            conn.execute_batch(sql)?;
            conn.execute(
                "INSERT INTO _schema_version (version, name) VALUES (?1, ?2)",
                params![version as i64, name],
            )?;
        }
    }

    Ok(())
}

fn lock_db(conn: &Mutex<Connection>) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    conn.lock().map_err(|_: PoisonError<_>| "database mutex poisoned".to_string())
}

fn comparison_level_to_sql(level: ComparisonLevel) -> &'static str {
    match level {
        ComparisonLevel::Fast => "Fast",
        ComparisonLevel::Metadata => "Metadata",
        ComparisonLevel::Strict => "Strict",
    }
}

fn comparison_level_from_sql(s: &str) -> Option<ComparisonLevel> {
    match s {
        "Fast" => Some(ComparisonLevel::Fast),
        "Metadata" => Some(ComparisonLevel::Metadata),
        "Strict" => Some(ComparisonLevel::Strict),
        _ => None,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncHistoryEntry {
    pub id: String,
    pub profile_id: Option<String>,
    pub source_root: String,
    pub destination_root: String,
    pub comparison_level: ComparisonLevel,
    pub files_new: u64,
    pub files_updated: u64,
    pub files_skipped: u64,
    pub files_failed: u64,
    pub bytes_copied: u64,
    pub total_bytes: u64,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub status: String,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub entries: Vec<SyncHistoryEntry>,
    pub page: u64,
    pub page_size: u64,
    pub total: u64,
}

pub struct HistoryDb {
    conn: Mutex<Connection>,
}

impl HistoryDb {
    pub fn open_or_create(db_path: &Path) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("cannot create database directory: {}", e))?;
        }
        let conn =
            Connection::open(db_path).map_err(|e| format!("cannot open database: {}", e))?;
        run_migrations(&conn).map_err(|e| format!("migration failed: {}", e))?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn insert_entry(&self, entry: &SyncHistoryEntry) -> Result<(), String> {
        let conn = lock_db(&self.conn)?;
        conn.execute(
            "INSERT INTO sync_history (id, profile_id, source_root, destination_root,
             comparison_level, files_new, files_updated, files_skipped, files_failed,
             bytes_copied, total_bytes, started_at, completed_at, status, error_message)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                entry.id,
                entry.profile_id,
                entry.source_root,
                entry.destination_root,
                comparison_level_to_sql(entry.comparison_level),
                entry.files_new as i64,
                entry.files_updated as i64,
                entry.files_skipped as i64,
                entry.files_failed as i64,
                entry.bytes_copied as i64,
                entry.total_bytes as i64,
                entry.started_at,
                entry.completed_at,
                entry.status,
                entry.error_message,
            ],
        )
        .map_err(|e| format!("cannot insert history entry: {}", e))?;
        Ok(())
    }

    /// Update a history entry's status after the sync run completes.
    /// Returns Ok(true) if a row was updated, Ok(false) if no matching entry found.
    pub fn update_entry_status(
        &self,
        id: &str,
        status: &str,
        completed_at: Option<&str>,
        error_message: Option<&str>,
    ) -> Result<bool, String> {
        let conn = lock_db(&self.conn)?;
        let affected = conn
            .execute(
                "UPDATE sync_history SET status = ?1, completed_at = ?2, error_message = ?3 WHERE id = ?4",
                params![status, completed_at, error_message, id],
            )
            .map_err(|e| format!("cannot update history entry: {}", e))?;
        Ok(affected > 0)
    }

    /// Insert a sync profile from the domain model.
    pub fn insert_profile(&self, profile: &SyncProfile) -> Result<(), String> {
        let conn = lock_db(&self.conn)?;
        conn.execute(
            "INSERT INTO sync_profiles (id, name, source_root, destination_root, default_comparison_level)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                profile.id,
                profile.name,
                profile.source_root.to_string_lossy(),
                profile.destination_root.to_string_lossy(),
                comparison_level_to_sql(profile.default_comparison_level),
            ],
        )
        .map_err(|e| format!("cannot insert profile: {}", e))?;
        Ok(())
    }

    /// List history entries with 1-based pagination.
    /// Page values less than 1 are treated as page 1.
    pub fn list_history(&self, page: u64, page_size: u64) -> Result<HistoryPage, String> {
        if page_size == 0 {
            return Err("page_size must be > 0".to_string());
        }

        let conn = lock_db(&self.conn)?;

        let total: u64 = conn
            .query_row("SELECT COUNT(*) FROM sync_history", [], |row| {
                row.get::<_, i64>(0).map(|v| v as u64)
            })
            .map_err(|e| format!("cannot count history entries: {}", e))?;

        let offset = (page.saturating_sub(1)).saturating_mul(page_size);
        let mut stmt = conn
            .prepare(
                "SELECT id, profile_id, source_root, destination_root, comparison_level,
                 files_new, files_updated, files_skipped, files_failed,
                 bytes_copied, total_bytes, started_at, completed_at, status, error_message
                 FROM sync_history
                 ORDER BY started_at DESC
                 LIMIT ?1 OFFSET ?2",
            )
            .map_err(|e| format!("cannot prepare query: {}", e))?;

        let entries = stmt
            .query_map(params![page_size as i64, offset as i64], |row| {
                let level_str: String = row.get(4)?;
                Ok(SyncHistoryEntry {
                    id: row.get(0)?,
                    profile_id: row.get(1)?,
                    source_root: row.get(2)?,
                    destination_root: row.get(3)?,
                    comparison_level: comparison_level_from_sql(&level_str)
                        .unwrap_or(ComparisonLevel::Metadata),
                    files_new: row.get::<_, i64>(5)? as u64,
                    files_updated: row.get::<_, i64>(6)? as u64,
                    files_skipped: row.get::<_, i64>(7)? as u64,
                    files_failed: row.get::<_, i64>(8)? as u64,
                    bytes_copied: row.get::<_, i64>(9)? as u64,
                    total_bytes: row.get::<_, i64>(10)? as u64,
                    started_at: row.get(11)?,
                    completed_at: row.get(12)?,
                    status: row.get(13)?,
                    error_message: row.get(14)?,
                })
            })
            .map_err(|e| format!("cannot query history: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("cannot read history row: {}", e))?;

        Ok(HistoryPage {
            entries,
            page,
            page_size,
            total,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use music_sync_domain::SyncProfile;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn db() -> (TempDir, HistoryDb) {
        let dir = TempDir::new().unwrap();
        let db = HistoryDb::open_or_create(&dir.path().join("test.db")).unwrap();
        (dir, db)
    }

    fn sample_entry(id: &str) -> SyncHistoryEntry {
        SyncHistoryEntry {
            id: id.to_string(),
            profile_id: None,
            source_root: "/music/source".into(),
            destination_root: "/music/dest".into(),
            comparison_level: ComparisonLevel::Metadata,
            files_new: 10,
            files_updated: 2,
            files_skipped: 0,
            files_failed: 1,
            bytes_copied: 50_000_000,
            total_bytes: 100_000_000,
            started_at: "2026-07-01T12:00:00Z".into(),
            completed_at: Some("2026-07-01T12:05:00Z".into()),
            status: "Completed".into(),
            error_message: None,
        }
    }

    fn sample_profile(id: &str) -> SyncProfile {
        SyncProfile::new(
            id.to_string(),
            format!("Profile {}", id),
            PathBuf::from("/src"),
            PathBuf::from("/dst"),
        )
    }

    #[test]
    fn inserts_and_reads_entry() {
        let (_dir, db) = db();
        let entry = sample_entry("sync-001");
        db.insert_entry(&entry).unwrap();

        let page = db.list_history(1, 10).unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.entries.len(), 1);
        assert_eq!(page.entries[0].id, "sync-001");
        assert_eq!(page.entries[0].files_new, 10);
        assert_eq!(page.entries[0].bytes_copied, 50_000_000);
        assert_eq!(page.entries[0].status, "Completed");
        assert_eq!(page.entries[0].comparison_level, ComparisonLevel::Metadata);
    }

    #[test]
    fn pagination_returns_correct_page() {
        let (_dir, db) = db();
        for i in 1..=15 {
            let mut e = sample_entry(&format!("sync-{:03}", i));
            e.started_at = format!("2026-07-01T{:02}:00:00Z", i);
            db.insert_entry(&e).unwrap();
        }

        let page1 = db.list_history(1, 5).unwrap();
        assert_eq!(page1.total, 15);
        assert_eq!(page1.entries.len(), 5);
        assert_eq!(page1.entries[0].id, "sync-015");

        let page3 = db.list_history(3, 5).unwrap();
        assert_eq!(page3.entries.len(), 5);
        assert_eq!(page3.entries[0].id, "sync-005");
    }

    #[test]
    fn last_page_has_remaining_entries() {
        let (_dir, db) = db();
        for i in 1..=7 {
            let e = sample_entry(&format!("sync-{}", i));
            db.insert_entry(&e).unwrap();
        }

        let page = db.list_history(2, 5).unwrap();
        assert_eq!(page.entries.len(), 2);
        assert_eq!(page.page, 2);
    }

    #[test]
    fn empty_database_returns_empty_page() {
        let (_dir, db) = db();
        let page = db.list_history(1, 10).unwrap();
        assert_eq!(page.total, 0);
        assert!(page.entries.is_empty());
    }

    #[test]
    fn updates_entry_status() {
        let (_dir, db) = db();
        let entry = sample_entry("sync-001");
        db.insert_entry(&entry).unwrap();

        let updated = db
            .update_entry_status(
                "sync-001",
                "Failed",
                Some("2026-07-01T12:10:00Z"),
                Some("disk full"),
            )
            .unwrap();
        assert!(updated);

        let page = db.list_history(1, 10).unwrap();
        assert_eq!(page.entries[0].status, "Failed");
        assert_eq!(page.entries[0].error_message.as_deref(), Some("disk full"));
        assert_eq!(
            page.entries[0].completed_at.as_deref(),
            Some("2026-07-01T12:10:00Z")
        );
    }

    #[test]
    fn migration_is_idempotent() {
        let dir = TempDir::new().unwrap();
        let db1 = HistoryDb::open_or_create(&dir.path().join("test.db")).unwrap();
        drop(db1);
        let db2 = HistoryDb::open_or_create(&dir.path().join("test.db")).unwrap();
        let page = db2.list_history(1, 10).unwrap();
        assert_eq!(page.total, 0);
    }

    #[test]
    fn entry_with_profile_id() {
        let (_dir, db) = db();
        let profile = sample_profile("profile-abc");
        db.insert_profile(&profile).unwrap();
        let mut entry = sample_entry("sync-p1");
        entry.profile_id = Some("profile-abc".into());
        db.insert_entry(&entry).unwrap();

        let page = db.list_history(1, 10).unwrap();
        assert_eq!(
            page.entries[0].profile_id.as_deref(),
            Some("profile-abc")
        );
    }

    #[test]
    fn entry_with_profile_id_stores_comparison_level() {
        let (_dir, db) = db();
        let mut profile = sample_profile("profile-xyz");
        profile.default_comparison_level = ComparisonLevel::Strict;
        db.insert_profile(&profile).unwrap();

        let mut entry = sample_entry("sync-p2");
        entry.profile_id = Some("profile-xyz".into());
        entry.comparison_level = ComparisonLevel::Strict;
        db.insert_entry(&entry).unwrap();

        let page = db.list_history(1, 10).unwrap();
        assert_eq!(page.entries[0].comparison_level, ComparisonLevel::Strict);
    }

    #[test]
    fn entry_with_error_message() {
        let (_dir, db) = db();
        let mut entry = sample_entry("sync-err");
        entry.status = "Failed".into();
        entry.error_message = Some("permission denied".into());
        entry.completed_at = None;
        db.insert_entry(&entry).unwrap();

        let page = db.list_history(1, 10).unwrap();
        assert_eq!(page.entries[0].status, "Failed");
        assert!(page
            .entries[0]
            .error_message
            .as_deref()
            .unwrap()
            .contains("permission"));
    }

    #[test]
    fn update_nonexistent_entry_returns_false() {
        let (_dir, db) = db();
        let updated = db.update_entry_status("no-such-id", "Done", None, None).unwrap();
        assert!(!updated);
        let page = db.list_history(1, 10).unwrap();
        assert_eq!(page.total, 0);
    }

    #[test]
    fn duplicate_profile_id_returns_error() {
        let (_dir, db) = db();
        let p1 = sample_profile("dup-id");
        db.insert_profile(&p1).unwrap();
        let p2 = sample_profile("dup-id");
        let result = db.insert_profile(&p2);
        assert!(result.is_err(), "duplicate profile id should fail");
    }

    #[test]
    fn page_size_zero_returns_error() {
        let (_dir, db) = db();
        let result = db.list_history(1, 0);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("page_size must be > 0"));
    }

    #[test]
    fn page_zero_works_as_page_one() {
        let (_dir, db) = db();
        let entry = sample_entry("test");
        db.insert_entry(&entry).unwrap();

        let page = db.list_history(0, 10).unwrap();
        assert_eq!(page.entries.len(), 1);
    }

    #[test]
    fn invalid_db_path_returns_error() {
        let result =
            HistoryDb::open_or_create(Path::new("/nonexistent/deep/path/that/cannot/be/created/.db"));
        assert!(result.is_err());
    }

    #[test]
    fn duplicate_entry_id_returns_error() {
        let (_dir, db) = db();
        let entry = sample_entry("sync-dup");
        db.insert_entry(&entry).unwrap();
        let result = db.insert_entry(&entry);
        assert!(result.is_err(), "duplicate entry id should violate PK constraint");
    }

    #[test]
    fn page_beyond_total_returns_empty_entries() {
        let (_dir, db) = db();
        let entry = sample_entry("sync-001");
        db.insert_entry(&entry).unwrap();
        let page = db.list_history(10, 5).unwrap();
        assert!(page.entries.is_empty(), "page beyond total should be empty");
        assert_eq!(page.total, 1);
    }

    #[test]
    fn update_status_with_none_params_clears_optional_fields() {
        let (_dir, db) = db();
        let entry = sample_entry("sync-001");
        db.insert_entry(&entry).unwrap();
        db.update_entry_status("sync-001", "InProgress", None, None).unwrap();
        let page = db.list_history(1, 10).unwrap();
        assert_eq!(page.entries[0].status, "InProgress");
        assert!(page.entries[0].completed_at.is_none());
        assert!(page.entries[0].error_message.is_none());
    }

    #[test]
    fn entry_with_zero_numeric_values() {
        let (_dir, db) = db();
        let entry = SyncHistoryEntry {
            id: "sync-zero".into(),
            profile_id: None,
            source_root: "/src".into(),
            destination_root: "/dst".into(),
            comparison_level: ComparisonLevel::Fast,
            files_new: 0,
            files_updated: 0,
            files_skipped: 0,
            files_failed: 0,
            bytes_copied: 0,
            total_bytes: 0,
            started_at: "2026-07-01T12:00:00Z".into(),
            completed_at: None,
            status: "Completed".into(),
            error_message: None,
        };
        db.insert_entry(&entry).unwrap();
        let page = db.list_history(1, 10).unwrap();
        assert_eq!(page.entries[0].files_new, 0);
        assert_eq!(page.entries[0].comparison_level, ComparisonLevel::Fast);
    }

    #[test]
    fn entry_with_max_u64_values_roundtrips() {
        let (_dir, db) = db();
        let entry = SyncHistoryEntry {
            id: "sync-max".into(),
            profile_id: None,
            source_root: "/src".into(),
            destination_root: "/dst".into(),
            comparison_level: ComparisonLevel::Strict,
            files_new: u64::MAX,
            files_updated: u64::MAX,
            files_skipped: 0,
            files_failed: 0,
            bytes_copied: u64::MAX,
            total_bytes: u64::MAX,
            started_at: "2026-07-01T12:00:00Z".into(),
            completed_at: None,
            status: "InProgress".into(),
            error_message: None,
        };
        db.insert_entry(&entry).unwrap();
        let page = db.list_history(1, 10).unwrap();
        assert_eq!(page.entries[0].files_new, u64::MAX);
        assert_eq!(page.entries[0].comparison_level, ComparisonLevel::Strict);
    }

    #[test]
    fn open_or_create_with_filename_only_no_parent_dir() {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("plain.db");
        let db = HistoryDb::open_or_create(&db_path).unwrap();
        let entry = sample_entry("test");
        db.insert_entry(&entry).unwrap();
        let page = db.list_history(1, 10).unwrap();
        assert_eq!(page.total, 1);
    }

    #[test]
    fn run_migrations_is_idempotent_directly() {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("migrate.db");
        {
            let conn = Connection::open(&db_path).unwrap();
            run_migrations(&conn).unwrap();
            let version: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(version), 0) FROM _schema_version",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(version, 1);
        }
        {
            let conn = Connection::open(&db_path).unwrap();
            run_migrations(&conn).unwrap();
            let version: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(version), 0) FROM _schema_version",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(version, 1);
        }
    }

    #[test]
    fn run_migrations_on_fresh_in_memory_db() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        let version: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM _schema_version",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(version > 0);
        let count: i64 =
            conn.query_row("SELECT COUNT(*) FROM sync_history", [], |row| row.get(0))
                .unwrap();
        assert_eq!(count, 0);
    }
}
