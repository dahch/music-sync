# DESIGN — MusicSync Technical Architecture

> How the system is built. Reflects the current codebase, not future plans.

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│                    Frontend (React/TS)                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  app/     entry (main.tsx → App.tsx → HomePage)          │  │
│  │  pages/   home: FolderSelection + ComparisonView          │  │
│  │  entities/ MusicFile, DiffStatus, CopyStatus, SyncProfile │  │
│  │  features/ folder-selection ✅, comparison-view ✅,      │  │
│  │           scanner/comparator/copy-engine/history — stubs  │  │
│  │  shared/  api (scanAndCompare), store (counter),          │  │
│  │           lib/ui — empty stubs                            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Package: music-sync (pnpm)  ·  Vite dev on :1420               │
│  State: Zustand (counter)  ·  Tests: Vitest + jsdom + RTL      │
└─────────────────────────────┬──────────────────────────────────┘
                              │ Tauri IPC (invoke / events)
┌─────────────────────────────┴──────────────────────────────────┐
│                    Tauri Rust Backend                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  src-tauri/                                              │  │
│  │  ├── src/lib.rs      Tauri builder + scan_and_compare    │  │
│  │  ├── src/commands/   compare.rs (scan_and_compare cmd)   │  │
│  │  ├── src/main.rs     Platform entry point                │  │
│  │  ├── capabilities/   core + dialog + core:event:default  │  │
│  │  ├── migrations/     001_sync_tables.sql                 │  │
│  │  ├── tauri.conf.json App configuration                   │  │
│  │  └── crates/         Workspace members (5 crates)        │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────┬──────────────────────────────────┘
                              │
┌─────────────────────────────┴──────────────────────────────────┐
│                    Rust Crates (workspace)                      │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐    │
│  │  domain  │  │ scanner  │  │comparator│  │ copy_engine│    │
│  │ (base)   │  │ (tokio)  │  │(L1+L2)   │  │ (scaffold) │    │
│  │ 9 types  │  │ 15 tests │  │ 30 tests │  │            │    │
│  │ serde    │  │ CLI bin  │  │          │  │            │    │
│  └────┬─────┘  └──────────┘  └──────────┘  └────────────┘    │
│       │                                                       │
│       └─────────────────┬───────────────────────────────────  │
│                    ┌──────────┐       ┌─────────────────┐    │
│                    │ history  │       │ Tauri commands  │    │
│                    │ (rusqlite│       │ (compare.rs)    │    │
│                    │  bundled)│       │ scan_and_compare│    │
│                    │ 12 tests │       │ 7 tests         │    │
│                    └──────────┘       └─────────────────┘    │
└───────────────────────────────────────────────────────────────┘
```

## Layer Breakdown

### 1. Domain Crate (`music-sync-domain`)

**Purpose:** Shared type definitions used by all other crates and the Tauri
IPC layer. No runtime dependencies beyond `serde`.

**Key design choices:**
- All types derive `Serialize`/`Deserialize` with `rename_all = "camelCase"`
  for seamless JS interop via Tauri IPC.
- `SyncProfile.id` is `String` (not `Uuid`) to avoid an extra dependency;
  UUID validation is deferred to the persistence layer.
- `Blake3Hash` is `[u8; 32]` — the raw 256-bit output length.
- Helper methods (`needs_copy`, `is_terminal`, `toggle`, `mark_synced`),
  constructors (`new`, `with_hash`), and aggregate logic (`compute_stats`)
  are implemented on the types themselves rather than in service layers
  (YAGNI until services exist).

### 2. Scanner Crate (`music-sync-scanner`)

**Purpose:** Recursive filesystem walk with extension filtering and progress
streaming.

**Design patterns used:**
- **Struct-of-functions:** `Scanner` holds configuration (root path,
  extensions); the `scan()` method is async and consumes `self`.
- **Backpressure via channels:** Progress emitted through an unbounded
  tokio `mpsc` channel. The channel is unbounded by design — the scanner
  doesn't block on progress delivery, and the receiver can drop events if
  it falls behind.
- **Concurrent pair scan:** `scan_pair()` spawns two `scan()` tasks via
  `tokio::try_join!` so source and destination are scanned in parallel.
- **Error taxonomy:** `ScanError` uses distinct variants (`NotFound`,
  `PermissionDenied`, etc.) that map directly to user-facing messages.
  The `Display` impl produces copy describing each variant.

**Key decisions (ponytail markers):**
- 20k-file benchmark uses local SSD — may be slow on network/CI filesystems.
- Extension matching is case-insensitive by lowercasing; no Unicode
  normalization.

### 3. History Crate (`music-sync-history`)

**Purpose:** SQLite schema management and (future) CRUD for sync history.

**Design patterns used:**
- **Embedded migration system:** Linear version sequence stored in
  `_schema_version` table. Migrations are Rust string constants compiled
  via `include_str!()` from `.sql` files in `src-tauri/migrations/`.
- **Idempotent runs:** `MAX(version)` check before each migration —
  re-running is safe.
- **Bundled SQLite:** `rusqlite` with `bundled` feature so no system
  SQLite is required.

**Schema (current migration `001_sync_tables.sql`):**
- `sync_profiles` — saved source/destination pairs.
- `sync_history` — individual sync run records.
- `_schema_version` — migration tracking (internal).

**Not implemented:** CRUD operations, query layer, app data directory
resolution.

### 4. Comparator Crate (`music-sync-comparator`)

**Status:** 🚧 Partial (Level 1+2 implemented, Level 3 pending).

**Design patterns used:**
- **Configurable struct:** `Comparator` holds `tolerance_mtime` (default 2s) and
  exposes `with_mtime_tolerance()` for custom values.
- **HashMap index:** source and destination `Vec<MusicFile>` are indexed by
  `relative_path` into separate `HashMap`s before diffing.
- **Cascading levels:**
  - **Level 1 (Fast)** — path-only: matching keys are `Identical` regardless of
    size/mtime. Sets the structural baseline.
  - **Level 2 (Metadata, default)** — size + mtime comparison with configurable
    tolerance to absorb FAT32/exFAT timestamp precision loss.
  - **Level 3 (Strict)** — currently delegates to Metadata; BLAKE3 hash
    comparison deferred to future work (ponytail marker `F3-01`).
- **Orphan detection:** destination entries missing from source are emitted as
  `Orphan` in a second pass over the destination map.
- **Duplicate paths:** duplicate `relative_path` values within source or
  destination are silently deduplicated (last wins via `HashMap`).

**Test coverage:** 30 tests covering all four `DiffStatus` classifications,
mtime tolerance boundaries, zero/large tolerance edge cases, Level 1 fast-path
correctness, Strict delegation, duplicate/malformed input, and root path
preservation.

### 5. Copy Engine Crate (`music-sync-copy-engine`)

**Status:** Scaffold. No copy logic yet.

### 6. Tauri App Crate (`music-sync`)

**Purpose:** Glue between Rust crates and the frontend.

**Current state:**
- Registers `tauri-plugin-dialog` for native file dialogs.
- Exposes one command (`scan_and_compare`) in a `commands` module:
  - Accepts `source_path`, `dest_path`, `level` string.
  - Validates both paths, runs concurrent `scan_pair()` with progress events
    (`scan:progress`), then compares and returns `ComparisonResult`.
  - `parse_comparison_level()` helper tested separately (7 tests).
- Window title set at runtime: "MusicSync".
- Capability `default.json` grants `core:default`, `dialog:default`,
  `core:event:default` (needed for frontend progress event subscription).

### 7. Frontend (`src/`)

**Purpose:** React UI following Feature-Sliced Design.

**Current state:**
- **Entities layer:** TypeScript interfaces mirror all domain types.
  Notable: `CopyStatus` uses a tagged union (`{ Failed: string } | "Pending" | ...`
  to match Rust's `enum` with data in serde JSON.
- **API layer:** `src/shared/api/index.ts` provides:
  - `scanAndCompare(sourcePath, destPath, level)` — wraps `invoke("scan_and_compare", ...)`.
  - `onScanProgress(callback)` — subscribes to `scan:progress` Tauri events.
- **Features:** `folder-selection` (native folder picker + comparison level selector,
  12 tests) and `comparison-view` (summary stat cards + entry table, 30 tests)
  are implemented. Other features (`scanner`, `comparator`, `copy-engine`,
  `history`) are empty barrels.
- **Page:** `HomePage` orchestrates the scan→compare flow: idle → scanning (progress display) → done (comparison view) → error.
- **Store:** Zustand `useAppStore` with a counter — proof of concept.
- **Aliasing:** `@/` resolves to `src/` via Vite resolve alias.
- **Test setup:** Vitest with jsdom environment, `@testing-library/react`,
  `@testing-library/jest-dom`.

## Data Flows

### Integrated Scan+Compare Flow (implemented — Tauri command `scan_and_compare`)

```
Frontend: scanAndCompare(sourcePath, destPath, level)
    ↓ Tauri invoke
commands::scan_and_compare()
    ↓
parse_comparison_level(level)       ← validates "Fast"|"Metadata"|"Strict"
    ↓
Scanner::validate() (both paths)    ← checks paths exist + are readable dirs
    ↓
scan_pair(source, dest)             ← tokio::try_join! two async walks
    ↓ (for each file, from both scans)
progress_tx.send(ScanProgress)
    ↓ (relayed by background task)
app.emit("scan:progress") → frontend listen("scan:progress")
    ↓
(Vec<MusicFile> source, Vec<MusicFile> dest) ← collected from both sides
    ↓
Comparator::compare()               ← HashMap index + cascading L1→L2
    ↓
ComparisonResult (entries + auto-computed stats)
    ↓ Tauri return
Frontend receives ComparisonResult → ComparisonView renders
```

### Scan Flow (library-level)

```
Scanner::validate()    ← checks path exists + is readable dir
    ↓
Scanner::scan()        ← async recursive walk with tokio::fs
    ↓ (for each file)
progress_tx.send(ScanProgress)
    ↓
Vec<MusicFile>         ← collected results
```

### Comparison Flow (library-level: L1+L2, L3 pending)

```
Vec<MusicFile>(source) + Vec<MusicFile>(destination)
    ↓
Index by relative_path (HashMap)
    ↓
Cascading diff per ADR-002 (L1 → L2)
    ↓ (L3 delegates to L2 until BLAKE3 hash is implemented)
Vec<ComparisonEntry> + ComparisonStats (auto-computed by ComparisonResult::new)
```

## External Dependencies

| Dependency | Version | Purpose | Why this one |
|---|---|---|---|
| `tauri` | 2 | App framework | ADR-001 |
| `tauri-plugin-dialog` | 2 | Native file dialogs (Rust + npm) | OS-native picker |
| `serde` / `serde_json` | 1 | Serialization | Tauri IPC requires serde |
| `tokio` | 1 | Async runtime | Scanner I/O concurrency |
| `rusqlite` | 0.31 | SQLite | Embedded DB (bundled) |
| `react` / `react-dom` | ^18.3 | UI framework | ADR-001 |
| `zustand` | ^5 | State management | ADR-005 |
| `@tauri-apps/api` | ^2 | Tauri IPC bindings | Required by Tauri |
| `@tauri-apps/plugin-dialog` | ^2 (npm) | Frontend folder picker | Pair with Rust `tauri-plugin-dialog` |
| `tempfile` | 3 (dev) | Temp dirs in Rust tests | Rust standard for FS test fixtures |
| `vite` | ^6 | Dev server + bundler | Fast HMR, TS-native |
| `vitest` | ^4 | Frontend test runner | Vite-native, same config as build |
| `@testing-library/react` | ^16 | React component tests | Standard for RTL |
| `jsdom` | ^29 | DOM environment for tests | Vitest requires a DOM impl |
| `typescript` | ~5.6 | Type checking | Project standard |

## Test Strategy (current)

| Layer | Tool | Tests |
|-------|------|-------|
| Domain logic | `cargo test` | 9 modules / 35 tests — serde roundtrip + business logic |
| Scanner | `cargo test` (tokio) | 15 tests, real temp dirs |
| Comparator | `cargo test` | 30 tests, HashMap index + mtime tolerance + Level 1 fast-path |
| History | `cargo test` | 12 tests, in-memory SQLite |
| Tauri commands | `cargo test` | 7 tests — `parse_comparison_level` validation |
| Copy Engine | — | None yet |
| Frontend | `pnpm test` (Vitest) | 12 (FolderSelection) + 30 (ComparisonView) |
