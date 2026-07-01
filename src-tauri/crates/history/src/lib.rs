use rusqlite::Connection;

const MIGRATIONS: &[(&str, &str)] = &[(
    "v1_sync_tables",
    include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../migrations/001_sync_tables.sql"
    )),
)];

pub fn run_migrations(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _schema_version (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )?;

    // ponytail: simple linear migration, per-connection locking if concurrent access needed
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
                rusqlite::params![version as i64, name],
            )?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn in_memory_db() -> rusqlite::Result<Connection> {
        let conn = Connection::open_in_memory()?;
        run_migrations(&conn)?;
        Ok(conn)
    }

    #[test]
    fn migration_creates_sync_profiles_table() {
        let conn = in_memory_db().unwrap();
        let count: usize = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='sync_profiles'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn migration_creates_sync_history_table() {
        let conn = in_memory_db().unwrap();
        let count: usize = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='sync_history'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn migration_creates_schema_version_table() {
        let conn = in_memory_db().unwrap();
        let count: usize = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='_schema_version'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn migration_records_version() {
        let conn = in_memory_db().unwrap();
        let version: usize = conn
            .query_row("SELECT version FROM _schema_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 1);
    }

    #[test]
    fn migration_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        run_migrations(&conn).unwrap();
        // second run should not fail or duplicate rows
        let count: usize = conn
            .query_row(
                "SELECT COUNT(*) FROM _schema_version",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn sync_profile_columns_exist() {
        let conn = in_memory_db().unwrap();
        let names: Vec<String> = conn
            .prepare("SELECT name, source_root, destination_root FROM sync_profiles LIMIT 0")
            .unwrap()
            .column_names()
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert!(names.contains(&"name".into()));
        assert!(names.contains(&"source_root".into()));
    }

    #[test]
    fn sync_history_columns_exist() {
        let conn = in_memory_db().unwrap();
        let names: Vec<String> = conn
            .prepare("SELECT id, profile_id, source_root, started_at, status FROM sync_history LIMIT 0")
            .unwrap()
            .column_names()
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert!(names.contains(&"profile_id".into()));
        assert!(names.contains(&"status".into()));
    }

    #[test]
    fn migration_records_name() {
        let conn = in_memory_db().unwrap();
        let name: String = conn
            .query_row(
                "SELECT name FROM _schema_version WHERE version = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!name.is_empty());
        assert_eq!(name, "v1_sync_tables");
    }

    #[test]
    fn sync_profiles_has_default_comparison_level() {
        let conn = in_memory_db().unwrap();
        conn.execute(
            "INSERT INTO sync_profiles (id, name, source_root, destination_root) VALUES ('test-id', 'test', '/src', '/dst')",
            [],
        )
        .unwrap();
        let level: String = conn
            .query_row(
                "SELECT default_comparison_level FROM sync_profiles WHERE id = 'test-id'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(level, "Metadata");
    }

    #[test]
    fn sync_profiles_default_created_at_not_null() {
        let conn = in_memory_db().unwrap();
        conn.execute(
            "INSERT INTO sync_profiles (id, name, source_root, destination_root) VALUES ('test-id', 'test', '/src', '/dst')",
            [],
        )
        .unwrap();
        let created_at: String = conn
            .query_row(
                "SELECT created_at FROM sync_profiles WHERE id = 'test-id'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!created_at.is_empty());
    }

    #[test]
    fn sync_history_default_status_in_progress() {
        let conn = in_memory_db().unwrap();
        conn.execute(
            "INSERT INTO sync_profiles (id, name, source_root, destination_root) VALUES ('p1', 'p', '/src', '/dst')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO sync_history (id, profile_id, source_root, destination_root, comparison_level, started_at) VALUES ('h1', 'p1', '/src', '/dst', 'Fast', '2024-01-01T00:00:00Z')",
            [],
        ).unwrap();
        let status: String = conn
            .query_row(
                "SELECT status FROM sync_history WHERE id = 'h1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "InProgress");
    }

    #[test]
    fn run_migrations_returns_error_on_invalid_path() {
        let result = Connection::open("/nonexistent/deep/surely/not/valid.db")
            .and_then(|c| run_migrations(&c));
        assert!(result.is_err());
    }
}
