use tauri::Manager;

// ponytail: scaffolding command, remove once real commands exist
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! MusicSync core is running.", name)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![greet])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.set_title("MusicSync — scaffolding OK").ok();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
