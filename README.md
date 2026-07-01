# MusicSync Desktop

Desktop application for comparing and syncing audio libraries between a local
source folder and a portable device (DAC/USB storage).

**Stack:** Tauri v2 + Rust (core) + React 18 / TypeScript / Vite (UI)

## Architecture

Full architecture spec: [docs/spec-music-sync-app.md](spec-music-sync-app.md)

```
src-tauri/
├── crates/
│   ├── domain/          # Domain types (MusicFile, ComparisonEntry, SyncProfile...)
│   ├── scanner/         # Filesystem scanner (tokio async I/O)
│   ├── comparator/      # Diff logic (ADR-002: 3-level comparison)
│   ├── copy_engine/     # Copy queue + progress (ADR-004: atomic writes)
│   └── history/         # SQLite-backed sync history (rusqlite)
├── migrations/          # SQL migration files
├── capabilities/        # Tauri v2 capability definitions
├── src/                 # Tauri entry point (main.rs + lib.rs)
├── Cargo.toml           # Rust workspace root
└── tauri.conf.json      # Tauri v2 configuration

src/                     # Frontend (Feature-Sliced Design)
├── app/                 # App entry, providers, routing
├── pages/               # Full page compositions (home, diff, history...)
├── features/            # Business features (scanner, comparator, copy-engine, history)
├── entities/            # Domain entity TS types (music-file, sync-profile)
└── shared/              # Reusable: UI components, lib, API wrappers, Zustand stores
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
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

### Setup

```bash
pnpm install
```

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
cargo test --manifest-path src-tauri/Cargo.toml --workspace
```

### Scanner CLI debug binary

```bash
cargo run -p music-sync-scanner --bin scanner-cli
```

## License

MIT
