mod commands;

use music_sync_history::HistoryDb;
use std::path::PathBuf;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::compare::scan_and_compare,
            commands::space::calculate_size_and_space,
            commands::copy::copy_files,
            commands::history::save_history_entry,
            commands::history::list_history,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.set_title("MusicSync").ok();
            }

            // Initialize SQLite database
            let app_dir: PathBuf = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data directory");
            std::fs::create_dir_all(&app_dir).expect("failed to create app data directory");

            let db_path = app_dir.join("musicsync.db");
            let db = HistoryDb::open_or_create(&db_path)
                .expect("failed to open or create history database");
            app.manage(db);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
