CREATE TABLE IF NOT EXISTS sync_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_root TEXT NOT NULL,
    destination_root TEXT NOT NULL,
    default_comparison_level TEXT NOT NULL DEFAULT 'Metadata',
    last_synced_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_history (
    id TEXT PRIMARY KEY,
    profile_id TEXT REFERENCES sync_profiles(id) ON DELETE SET NULL,
    source_root TEXT NOT NULL,
    destination_root TEXT NOT NULL,
    comparison_level TEXT NOT NULL,
    files_new INTEGER NOT NULL DEFAULT 0,
    files_updated INTEGER NOT NULL DEFAULT 0,
    files_skipped INTEGER NOT NULL DEFAULT 0,
    files_failed INTEGER NOT NULL DEFAULT 0,
    bytes_copied INTEGER NOT NULL DEFAULT 0,
    total_bytes INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL DEFAULT 'InProgress',
    error_message TEXT
);
