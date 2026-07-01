# MusicSync Desktop

Desktop application for comparing and syncing audio libraries between a local
source folder and a portable device (DAC/USB storage).

**Stack:** Tauri v2 + Rust (core) + React 18 / TypeScript / Vite (UI)

## Architecture

Full architecture spec: [spec-music-sync-app.md](./spec-music-sync-app.md)

```
src-tauri/
├── crates/
│   ├── domain/          # Domain types (MusicFile, ComparisonEntry, SyncProfile...)   ✅
│   ├── scanner/         # Filesystem scanner (tokio async I/O) — scaffold             🔧
│   ├── comparator/      # Diff logic (ADR-002: 3-level comparison) — scaffold         🔧
│   ├── copy_engine/     # Copy queue + progress (ADR-004: atomic writes) — scaffold   🔧
│   └── history/         # SQLite sync history — migrations done, no CRUD yet          🚧
├── migrations/          # SQL migration files (001_sync_tables.sql)
├── capabilities/        # Tauri v2 capability definitions (dialog plugin + core)
├── gen/schemas/         # Auto-generated Tauri capability schemas (gitignored)
├── src/                 # Tauri entry point (main.rs + lib.rs) — greet command only   🔧
├── Cargo.toml           # Rust workspace root
└── tauri.conf.json      # Tauri v2 configuration (identifier: com.dahch.musicsync)

src/                     # Frontend (Feature-Sliced Design)
├── app/                 # App entry (main.tsx + App.tsx), providers (empty)
├── pages/               # home (counter scaffold)                                     🔧
├── features/            # scanner, comparator, copy-engine, history — all empty stubs  🔧
├── entities/            # TS types: music-file, sync-profile                          ✅
└── shared/              # Zustand store (counter), api/lib/ui — all empty stubs        🔧

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

| Variable | Type | Default | Purpose |
|---|---|---|---|
| `TAURI_DEV_HOST` | `string` | unset | Set to network interface (e.g., `0.0.0.0`) to expose Vite dev server to other devices (e.g., testing on a real device). When set, enables WebSocket HMR on port 1421. |

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

The scanner crate has a CLI binary for testing filesystem walk without the UI:

```bash
cargo run -p music-sync-scanner --bin scanner-cli
```

Currently prints a placeholder string — real scan logic pending.

## CI

Multi-platform build workflow (`.github/workflows/build.yml`) runs on every push/PR to `main`:

| Platform | Target | Runner |
|---|---|---|
| macOS (Apple Silicon) | `aarch64-apple-darwin` | `macos-latest` |
| macOS (Intel) | `x86_64-apple-darwin` | `macos-13` |
| Windows | `x86_64-pc-windows-msvc` | `windows-latest` |
| Linux | `x86_64-unknown-linux-gnu` | `ubuntu-latest` |

Steps: install Rust, pnpm, Node.js 22, system deps (Linux only: webkit2gtk, GTK3, AppIndicator, librsvg, patchelf), `pnpm install`, `pnpm build`, `cargo build --target ${{ matrix.target }}`.

## License

MIT
