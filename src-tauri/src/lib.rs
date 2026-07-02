mod commands;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::compare::scan_and_compare,
            commands::space::calculate_size_and_space,
            commands::copy::copy_files,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.set_title("MusicSync").ok();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
