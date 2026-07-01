use rusqlite::Connection;

pub fn run_migrations(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../migrations/001_initial.sql"
    )))?;
    Ok(())
}

pub fn placeholder() -> &'static str {
    "history crate — scaffolding OK"
}
