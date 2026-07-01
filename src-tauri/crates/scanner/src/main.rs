use std::path::PathBuf;
use std::time::Instant;
use tokio::sync::mpsc;

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let path = args.get(1).map(|s| s.as_str()).unwrap_or(".");
    let extensions: Vec<String> = music_sync_scanner::DEFAULT_EXTENSIONS
        .iter()
        .map(|s| s.to_string())
        .collect();

    let scanner = music_sync_scanner::Scanner::new(PathBuf::from(path), extensions);

    if let Err(e) = scanner.validate() {
        eprintln!("Validation error: {}", e);
        std::process::exit(1);
    }

    let (tx, mut rx) = mpsc::unbounded_channel();

    let handle = tokio::spawn(async move {
        let start = Instant::now();
        let result = scanner.scan(tx).await;
        (result, start.elapsed())
    });

    let mut last_count = 0u64;
    while let Some(progress) = rx.recv().await {
        if progress.files_found != last_count {
            println!(
                "  {} files found{}",
                progress.files_found,
                progress
                    .current_path
                    .map(|p| format!(" — scanning {}", p.display()))
                    .unwrap_or_default()
            );
            last_count = progress.files_found;
        }
    }

    let (result, elapsed) = handle.await.unwrap();
    match result {
        Ok(files) => {
            println!(
                "Done — found {} files in {:.2}s",
                files.len(),
                elapsed.as_secs_f64()
            );
        }
        Err(e) => {
            eprintln!("Scan error: {}", e);
            std::process::exit(1);
        }
    }
}
