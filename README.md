# MusicSync Desktop

Desktop application for comparing and syncing audio libraries between a local
source folder and a portable device (DAC/USB storage).

**Stack:** Tauri v2 + Rust (core) + React 18 / TypeScript / Vite (UI) / Tailwind CSS v4

## Architecture

Full architecture spec: [spec-music-sync-app.md](./spec-music-sync-app.md)

```
src-tauri/
├── crates/
│   ├── domain/          # Domain types (MusicFile, ComparisonEntry, SyncProfile...)   ✅
│   ├── scanner/         # Filesystem scanner — tokio async I/O, progress, validation  ✅
│   ├── comparator/      # Diff logic (ADR-002: 3-level) — L1+L2 ✅, L3 pending        🚧
│   ├── copy_engine/     # Copy queue + progress — streaming copy, chunked I/O, error types ✅
│   └── history/         # SQLite sync history — migrations + CRUD (insert, list, paginate) ✅
├── migrations/          # SQL migration files (001_sync_tables.sql)
├── capabilities/        # Tauri v2: core + dialog + core:event:default permissions
├── gen/schemas/         # Auto-generated Tauri capability schemas (gitignored)
├── src/                 # Tauri entry (main.rs + lib.rs) — commands: scan_and_compare ✅, calculate_size_and_space ✅, copy_files ✅, pause_copy ✅, resume_copy ✅, cancel_copy ✅, save_history_entry ✅, list_history ✅
├── Cargo.toml           # Rust workspace root
└── tauri.conf.json      # Tauri v2 configuration (identifier: com.dahch.musicsync)

src/                     # Frontend (Feature-Sliced Design)
├── app/                 # App entry (main.tsx → App.tsx → HomePage)
├── pages/               # home: FolderSelection + ComparisonView + CopyPlanView + CopyProgressView + HistoryView  ✅
├── features/            # folder-selection ✅, comparison-view ✅, copy-plan ✅, copy-progress ✅, history-view ✅, rest stubs  🚧
├── entities/            # TS types: MusicFile, DiffStatus, CopyStatus, SyncProfile, SyncHistoryEntry…   ✅
└── shared/              # api (scanAndCompare, calculateSizeAndSpace, saveHistoryEntry, listHistory, copyFiles, onCopyProgress, pauseCopy, resumeCopy, cancelCopy ✅), store (selection + space check + copy state + pause/resume/cancel), format-size (shared utility), lib stubs  🚧

Legend: ✅ Implemented · 🚧 Partial · 🔧 Scaffold (structure, no logic yet)
```

## Development

### Prerequisites

- **Rust** toolchain (install via [rustup](https://rustup.rs))
- **pnpm** (install via `npm i -g pnpm` or `corepack enable`)
- **Node.js** >= 22

#### Platform-specific

**macOS:**

```bash
xcode-select --install
```

**Windows:**

- [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/) with "Desktop development with C++"
- [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (pre-installed on Windows 10+, but may need the Evergreen runtime)

**Linux:**

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

### Setup

```bash
pnpm install
```

### Environment Variables

| Variable         | Type     | Default | Purpose                                                                                                                                                               |
| ---------------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TAURI_DEV_HOST` | `string` | unset   | Set to network interface (e.g., `0.0.0.0`) to expose Vite dev server to other devices (e.g., testing on a real device). When set, enables WebSocket HMR on port 1421. |

### Run (dev mode)

```bash
pnpm tauri dev
```

This starts the Vite dev server and opens the Tauri window with hot-reload.

### Build

```bash
pnpm tauri build
```

### Rust-only build

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

### Run tests

```bash
# Rust (domain, scanner, comparator, history)
cargo test --manifest-path src-tauri/Cargo.toml --workspace

# Frontend (React components)
pnpm test
```

### Scanner CLI debug binary

The scanner crate has a CLI binary for testing filesystem walk without the UI:

```bash
cargo run -p music-sync-scanner --bin scanner-cli [path]
```

Scans the given path (defaults to current directory) and prints file count and elapsed time. Path validation and progress reporting work the same as the library API.

## CI

### Build (`.github/workflows/build.yml`)

Runs on every push/PR to `main` with **path filters** — skips builds for docs-only changes. Triggers only when source code, config, or lockfiles change (`src/**`, `src-tauri/**`, `package.json`, `pnpm-lock.yaml`, `vite.config.ts`, `tsconfig.json`, `index.html`, `Cargo.lock`).

| Platform              | Target                     | Runner           |
| --------------------- | -------------------------- | ---------------- |
| macOS (Apple Silicon) | `aarch64-apple-darwin`     | `macos-latest`   |
| Windows               | `x86_64-pc-windows-msvc`   | `windows-latest` |
| Linux                 | `x86_64-unknown-linux-gnu` | `ubuntu-latest`  |

Steps: install Rust, pnpm, Node.js 22, system deps (Linux only: webkit2gtk, GTK3, AppIndicator, librsvg, patchelf), `pnpm install`, `pnpm build`, `cargo build --target ${{ matrix.target }}`.

### Release (`.github/workflows/release.yml`)

Triggered by version tags (`v*`). Builds distributable packages on all three platforms, then creates a draft GitHub Release with installer files only (`.dmg`, `.msi`, `.exe`, `.deb`, `.rpm`, `.AppImage`). Non-installer bundle artifacts are cleaned before upload.

## License

MIT
