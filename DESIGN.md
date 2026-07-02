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
│  │  shared/  api (scanAndCompare, calculateSizeAndSpace,    │  │
│  │           store (selection + space check), lib/ui — stubs  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Package: music-sync (pnpm)  ·  Vite dev on :1420               │
│  State: Zustand (selection + space check)  ·                    │
│  Tests: Vitest + jsdom + RTL                                    │
└─────────────────────────────┬──────────────────────────────────┘
                              │ Tauri IPC (invoke / events)
┌─────────────────────────────┴──────────────────────────────────┐
│                    Tauri Rust Backend                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  src-tauri/                                              │  │
│  │  ├── src/lib.rs      Tauri builder + 5 commands          │  │
│  │  ├── src/commands/   compare.rs + space.rs + copy.rs + history.rs     │  │
│  │  ├── src/main.rs     Platform entry point                │  │
│  │  ├── capabilities/   core + dialog + core:event:default  │  │
│  │  ├── migrations/     001_sync_tables.sql                 │  │
│  │  ├── tauri.conf.json App configuration                   │  │
│  │  └── crates/         Workspace members (6 crates)        │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────┬──────────────────────────────────┘
                              │
┌─────────────────────────────┴──────────────────────────────────┐
│                    Rust Crates (workspace)                      │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐    │
│  │  domain  │  │ scanner  │  │comparator│  │ copy_engine│    │
│  │ (base)   │  │ (tokio)  │  │(L1+L2)   │  │(streaming)│    │
│  │ 9 types  │  │ 15 tests │  │ 30 tests │  │ 17 tests │    │
│  │ serde    │  │ CLI bin  │  │          │  │            │    │
│  └────┬─────┘  └──────────┘  └──────────┘  └────────────┘    │
│       │                                                       │
│       └─────────────────┬───────────────────────────────────  │
│                    ┌──────────┐       ┌──────────────────┐   │
│                    │ history  │       │ Tauri commands   │   │
│                    │ (rusqlite│       │ compare + space  │   │
│                    │  bundled)│       │ + copy + history │   │
│                    │ 22 tests │       │ 14 tests         │   │
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

**Purpose:** SQLite schema management and CRUD for sync history.

**Design patterns used:**
- **Embedded migration system:** Linear version sequence stored in
  `_schema_version` table. Migrations are Rust string constants compiled
  via `include_str!()` from `.sql` files in `src-tauri/migrations/`.
- **Idempotent runs:** `MAX(version)` check before each migration —
  re-running is safe.
- **Bundled SQLite:** `rusqlite` with `bundled` feature so no system
  SQLite is required.
- **Connection managed via Tauri state:** `HistoryDb` is wrapped in
  `Mutex<Connection>` and injected at app setup via `app.manage()`.

**Schema (current migration `001_sync_tables.sql`):**
- `sync_profiles` — saved source/destination pairs.
- `sync_history` — individual sync run records.
- `_schema_version` — migration tracking (internal).

**CRUD operations (implemented):**
- `open_or_create(path)` — resolve app data dir, open/create SQLite DB,
  run pending migrations.
- `insert_entry(entry)` — insert a new sync history record.
- `list_history(page, page_size)` — paginated list ordered by `started_at DESC`.
- `update_entry_status(id, status, completed_at, error_message)` — update
  a sync entry after completion or failure.
- `insert_profile(profile)` — persist a `SyncProfile`.
- Exposed via Tauri commands `save_history_entry` and `list_history`.
- **Not implemented:** frontend UI component for history view.

**Test coverage:** 22 tests covering inserts, pagination (first/last/empty/zero
page), status updates, profile linkage, duplicate/error path handling,
idempotency, u64 boundary values, and direct migration testing.

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

**Status:** ✅ Implemented — sequential streaming copy with per-chunk progress.

**Design patterns used:**
- **Configurable struct:** `CopyEngine` holds `chunk_size` (default 1 MiB) and
  exposes `with_chunk_size()` for custom values. `Default` impl returns the
  standard engine.
- **Sequential I/O:** files are processed one at a time toward the same
  destination — this matches the expected bottleneck (DAC/USB write speed).
  Failure of one file does not stop the queue.
- **Chunked streaming:** each file is read in configurable-size chunks and
  written immediately, avoiding loading entire files into memory.
- **Progress via channels:** `UnboundedSender<CopyProgress>` receives an event
  after each chunk and at file completion. The receiver can drop events if it
  falls behind.
- **Error taxonomy:** `CopyError` with `SourceNotFound`, `PermissionDenied`,
  `IoError` variants for precise user-facing messages.
- **Path safety:** `is_safe_relative()` rejects paths containing `..`
  components before any I/O, preventing directory traversal.
- **Auto-directory creation:** intermediate directories on the destination
  are created automatically via `tokio::fs::create_dir_all`.

**Key decisions (ponytail markers):**
- No atomic `.tmp` + rename pattern — ADR-004 specified it, but the current
  implementation writes directly to the final path. `.tmp` atomicity is
  deferrable because the engine is sequential (no partial state exposure) and
  crash recovery is a future concern.
- No post-copy verification — BLAKE3 re-hash after write is optional in
  ADR-004 but not yet implemented.
- No batch-level progress — per-file events are emitted; batch-level summary
  is left to the caller.

**Test coverage:** 17 tests covering normal file copy, subfolder structure
preservation, permission-denied on source and destination, missing source,
empty queues, empty files, unsafe path rejection, chunk-level progress events,
exact chunk multiples, odd remainder sizes, serialization roundtrip, and error
display formatting.

### 6. Tauri App Crate (`music-sync`)

**Purpose:** Glue between Rust crates and the frontend.

**Current state:**
- Registers `tauri-plugin-dialog` for native file dialogs.
- SQLite database initialized at app setup: `HistoryDb::open_or_create()` in
  the platform app data directory, injected via `app.manage(db)`.
- Exposes five commands in a `commands` module:
  - `scan_and_compare(source_path, dest_path, level)`:
    - Validates both paths, runs concurrent `scan_pair()` with progress events
      (`scan:progress` + `scan:done`), then compares and returns `ComparisonResult`.
    - `parse_comparison_level()` helper tested separately (8 tests).
  - `calculate_size_and_space(destination_root, selected_paths)`:
    - Computes total size of selected files and queries free space on
      destination via `fs2::available_space`.
    - Returns `SpaceInfo { total_selected_size, free_space_on_destination }`.
    - Tested separately (6 tests).
  - `copy_files(source_root, destination_root, items)`:
    - Spawns a progress relay task (`copy:progress` + `copy:done` events),
      then delegates to `CopyEngine::execute()` for sequential streaming copy.
    - Returns `Vec<CopyItemResult>` with per-file status.
  - `save_history_entry(entry)`:
    - Inserts a `SyncHistoryEntry` via `HistoryDb::insert_entry()`.
  - `list_history(page, page_size)`:
    - Returns a paginated `HistoryPage` via `HistoryDb::list_history()`.
- Window title set at runtime: "MusicSync".
- Capability `default.json` grants `core:default`, `dialog:default`,
  `core:event:default` (needed for frontend progress event subscription).

### 7. Frontend (`src/`)

**Purpose:** React UI following Feature-Sliced Design.

**Current state:**
- **Entities layer:** TypeScript interfaces mirror all domain types.
  Notable: `CopyStatus` uses a tagged union (`{ Failed: string } | "Pending" | ...`
  to match Rust's `enum` with data in serde JSON. History types `SyncHistoryEntry`
  and `HistoryPage` are also mirrored.
- **API layer:** `src/shared/api/index.ts` provides:
  - `scanAndCompare(sourcePath, destPath, level)` — wraps `invoke("scan_and_compare", ...)`.
  - `onScanProgress(callback)` — subscribes to `scan:progress` Tauri events.
  - `calculateSizeAndSpace(destinationRoot, selectedPaths)` — wraps `invoke("calculate_size_and_space", ...)`.
  - `saveHistoryEntry(entry)` — wraps `invoke("save_history_entry", ...)`.
  - `listHistory(page, pageSize)` — wraps `invoke("list_history", ...)`.
  - Exports `ScanProgress`, `SpaceInfo`, `SyncHistoryEntry`, and `HistoryPage` TS interfaces.
- **Features:** `folder-selection` (native folder picker + comparison level selector,
  12 tests) and `comparison-view` (summary stat cards + entry table with selection +
  space check panel, 57 tests) are implemented. Other features (`scanner`, `comparator`,
  `copy-engine`, `history`) are empty barrel stubs (history backend CRUD is complete,
  but no frontend UI component yet).
- **Page:** `HomePage` orchestrates the scan→compare flow: idle → scanning (progress display) → done (comparison view) → error.
- **Store:** Zustand `useAppStore` with real state: `selectedPaths` (string[]),
  `spaceInfo`, `toggleSelect`, `selectOnly`, `deselectAll`, and `fetchSpaceInfo`
  (calls `calculate_size_and_space`). No counter.
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

### Copy Flow (implemented — Tauri command `copy_files`)

```
Frontend: copyFiles(sourceRoot, destinationRoot, items)
    ↓ Tauri invoke
commands::copy_files()
    ↓
Spawning progress relay task → listens for CopyProgress, emits "copy:progress"
    ↓
CopyEngine::execute()                   ← sequential, per-item loop
    ├── is_safe_relative(item.path)?    ← rejects ".." without I/O
    ├── create_dir_all(dst.parent())    ← auto-create subdirectories
    ├── open source file                ← tokio::fs::File::open
    ├── create destination file         ← tokio::fs::File::create
    ├── chunked read/write loop         ← default 1 MiB chunks
    │   └── after each chunk:           ← progress_tx.send(CopyProgress { bytesCopied, ... })
    ├── on success → CopyStatus::Done
    └── on error → CopyStatus::Failed(reason)  ← continues to next item
    ↓
Vec<CopyItemResult> (per-file status)
    ↓ Tauri return
Frontend receives results
```

## External Dependencies

| Dependency | Version | Purpose | Why this one |
|---|---|---|---|
| `tauri` | 2 | App framework | ADR-001 |
| `tauri-plugin-dialog` | 2 | Native file dialogs (Rust + npm) | OS-native picker |
| `serde` / `serde_json` | 1 | Serialization | Tauri IPC requires serde |
| `tokio` | 1 | Async runtime | Scanner I/O, copy engine, Tauri commands (sync feature) |
| `rusqlite` | 0.31 | SQLite | Embedded DB (bundled) |
| `fs2` | 0.4 | Free disk space query | Cross-platform `available_space()` |
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
| History | `cargo test` | 22 tests, in-memory SQLite — insert, paginate, status update, edge cases |
| Tauri commands | `cargo test` | 14 tests — 8 (compare `parse_comparison_level`) + 6 (space `calculate_size_and_space`). Copy and history commands exercised via crate tests |
| Copy Engine | `cargo test` (tokio) | 17 tests — streaming copy, error handling, chunk edge cases, serialization |
| Frontend | `pnpm test` (Vitest) | 12 (FolderSelection) + 57 (ComparisonView) + 11 (store) |
