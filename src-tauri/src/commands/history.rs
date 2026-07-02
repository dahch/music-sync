use music_sync_history::{HistoryDb, HistoryPage, SyncHistoryEntry};
use tauri::State;

#[tauri::command]
pub async fn save_history_entry(
    db: State<'_, HistoryDb>,
    entry: SyncHistoryEntry,
) -> Result<(), String> {
    db.insert_entry(&entry).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_history(
    db: State<'_, HistoryDb>,
    page: u64,
    page_size: u64,
) -> Result<HistoryPage, String> {
    db.list_history(page, page_size).map_err(|e| e.to_string())
}
