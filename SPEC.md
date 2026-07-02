# SPEC — MusicSync (Current Implementation)

> Functional specification describing what the system **does** today, not what
> it plans to do. For the forward-looking architecture spec, see
> [spec-music-sync-app.md](./spec-music-sync-app.md).

## Domain Model

All domain types live in `src-tauri/crates/domain/` (Rust) with mirrored
TypeScript types in `src/entities/`.

### Core Types

| Type | Fields | Status |
|------|--------|--------|
| `MusicFile` | `relative_path`, `absolute_path`, `size_bytes`, `modified_at`, `extension`, `content_hash` | ✅ Implemented + serde + tests |
| `DiffStatus` | `New`, `Orphan`, `Identical`, `Different` | ✅ Implemented + serde + tests |
| `ComparisonLevel` | `Fast`, `Metadata`, `Strict` (default: `Metadata`) | ✅ Implemented + serde + tests |
| `CopyStatus` | `Pending`, `InProgress`, `Verifying`, `Done`, `Failed(String)`, `Skipped` | ✅ Implemented + serde + tests |
| `ComparisonStats` | Counts and sizes by status | ✅ Implemented + serde + tests |
| `ComparisonEntry` | `relative_path`, `status`, `source`, `destination`, `selected` | ✅ Implemented + serde + tests |
| `ComparisonResult` | `entries`, `scanned_at`, `source_root`, `destination_root`, `comparison_level`, `stats` | ✅ Implemented + serde + tests |
| `CopyTask` | `entry`, `status`, `bytes_copied`, `retries` | ✅ Implemented + serde + tests |
| `SyncProfile` | `id`, `name`, `source_root`, `destination_root`, `default_comparison_level`, `last_synced_at` | ✅ Implemented + serde + tests |

### Key Business Rules (implemented)

- `DiffStatus::needs_copy()` returns `true` only for `New` and `Different`.
- `CopyStatus::is_terminal()` returns `true` for `Done`, `Failed(_)`, `Skipped`.
- `ComparisonResult::new()` auto-computes stats from entries.
- `SyncProfile` defaults to `ComparisonLevel::Metadata`.

## Implemented Features

### 1. Filesystem Scanner (`src-tauri/crates/scanner/`)

**Status: ✅ Implemented**

- Async recursive directory walk via `tokio::fs`.
- Extension-based file filtering (configurable list; empty = all files).
- Case-insensitive extension matching.
- Progress reporting via `UnboundedSender<ScanProgress>`.
- Validation: checks path exists, is a directory, is readable.
- Error types: `NotFound`, `NotADirectory`, `PermissionDenied`, `IoError`.
- `scan_pair()` runs source and destination scans concurrently via
  `tokio::try_join!`.
- Relative paths preserved (paths stripped of scan root).
- CLI binary (`scanner-cli`) for headless testing with file count + timing.

**Test coverage:** 15 tests including empty directories, nested directories,
case-insensitive extensions, 20k-file benchmark, concurrency (`scan_pair`).

### 2. Schema Migration System + CRUD (`src-tauri/crates/history/`)

**Status: ✅ Implemented (migrations + CRUD)**

- Versioned SQLite migrations via `rusqlite` (bundled).
- Tracks applied migrations in `_schema_version` table.
- Current migration (`001_sync_tables.sql`) creates:
  - `sync_profiles` — saved source/destination pairs with comparison level.
  - `sync_history` — sync run records with file counts, bytes, status.
- Idempotent: re-running migrations skips already-applied versions.
- Linear version sequence (no branching).
- Full CRUD:
  - `HistoryDb::open_or_create()` — at app startup, resolves app data dir and
    opens/creates the SQLite database.
  - `insert_entry()` / `list_history(page, page_size)` — insert and paginate
    sync history entries.
  - `update_entry_status()` — update sync status after completion/failure.
  - `insert_profile()` — persist a `SyncProfile`.
- Exposed via Tauri commands `save_history_entry` and `list_history`.
- Frontend `HistoryView` component renders table with pagination.

**Test coverage:** 22 tests covering inserts, pagination (first/last/empty pages),
status updates, profile linkage, error cases, idempotency, u64 boundary values.

### 3. Diff/Comparator (`src-tauri/crates/comparator/`)

**Status: 🚧 Partial (L1+L2 done, L3 pending)**

- `Comparator` struct with configurable mtime tolerance (default 2s).
- Level 1 (Fast): path-only — matching keys are `Identical` regardless of size/mtime.
- Level 2 (Metadata): size + mtime comparison with configurable tolerance.
- Level 3 (Strict): currently delegates to Metadata; BLAKE3 hash comparison not yet implemented.
- Duplicate `relative_path` values deduplicated silently (last wins via `HashMap`).

**Test coverage:** 30 tests including new/orphan/identical/different, mtime tolerance boundaries,
Level 1 fast-path, Strict delegation, root path preservation, duplicate edge cases.

### 4. Copy Engine (`src-tauri/crates/copy_engine/`)

**Status: ✅ Implemented**

- `CopyEngine` struct with configurable chunk size (default 1 MiB) for
  streaming copy.
- `execute(source_root, destination_root, items, progress_tx)` — processes
  a list of `CopyItem`s sequentially toward the same destination. Async via
  `tokio::fs`.
- **Atomic writes:** each file is first written to a `.musicsync.tmp` sibling
  path, then atomically renamed to the final path via `tokio::fs::rename`.
  Intermediate directories on the destination are auto-created.
- **Optional BLAKE3 verification:** when `CopyItem.verify` is true, the engine
  hashes the source file during the streaming read, then re-hashes the temp
  file after write and compares. On mismatch, the temp file is deleted and the
  item is marked `Failed`.
- Chunked I/O: reads source in configurable-size chunks (default 1 MiB),
  writes each chunk to the temp file, emits `CopyProgress` after each chunk
  and at file completion.
- Error taxonomy: `CopyError` enum with `SourceNotFound`, `PermissionDenied`,
  `IoError`, `VerificationFailed`, `RenameFailed` variants — each maps to a
  distinct user-facing message.
- `is_safe_relative(path)` guard: rejects paths containing `..` components
  before any I/O, preventing directory traversal.
- Failure of one item does not stop the queue — failed items are marked
  `Failed(reason)` and the engine continues.
- `cleanup_tmp_files(root)` — recursively removes orphaned `.musicsync.tmp`
  files under a root directory. Called at Tauri command startup to clean
  leftovers from interrupted copies.
- `CopyProgress { currentFile, bytesCopied, totalFileSize, filesCompleted, totalFiles }`
  — emitted per chunk and at completion of each file.
- **Not implemented:** batch-level progress — per-file events are emitted;
  batch-level summary is left to the caller.
- Tauri command `copy_files(source_root, destination_root, items)` wraps the
  engine and relays `copy:progress` / `copy:done` events to the frontend. The
  command has a testable inner function `copy_files_inner()` extracted for
  unit tests without a Tauri runtime.

**Test coverage:** 37 tests covering normal file copy, atomic `.tmp` + rename
(no temp file left on success or failure), optional BLAKE3 verification,
subfolder structure preservation, permission-denied on source and destination,
missing source, empty queues, empty files, unsafe path rejection, chunk-level
progress events, exact chunk multiples, odd remainder sizes, mixed verify/non-
verify files, dropped receiver resilience, error display formatting,
serialization roundtrip, `is_safe_relative` edge cases, and `cleanup_tmp_files`
orphan cleanup.

### 5. Frontend (`src/`)

**Status: 🚧 Partial — scan→compare→copy→history pipeline works, no scanner/comparator/copy-engine/history feature stubs yet**

- React 18 + TypeScript + Vite dev server (port 1420, HMR on 1421).
- Feature-Sliced Design directory structure: `app/`, `pages/`, `features/`,
  `entities/`, `shared/`.
- **Page:** `HomePage` orchestrates the full pipeline: folder selection → scan with
  progress display → comparison results → copy with progress → history save. Also
  toggles `HistoryView` panel showing past sync runs.
- **Features:**
  - `folder-selection` — source/dest folder picker (via `tauri-plugin-dialog`
    native dialogs) with comparison level selector (`Fast`, `Metadata`, `Strict`). 12 tests.
  - `comparison-view` — summary stat cards + table of entries with color-coded
    status (New/Orphan/Identical/Different) + selection panel with space
    check. 57 tests.
  - `copy-progress` — `CopyProgressView` component with progress bar, file list, error
    display, and "Back to comparison" button. 31 tests.
  - `history-view` — `HistoryView` component with paginated sync history table
    (source/dest paths, file count, size, status, failed count). 21 tests.
  - `scanner`, `comparator`, `copy-engine`, `history` — still empty barrel stubs.
- **Entities:** TypeScript interfaces mirroring all Rust domain types
  (`MusicFile`, `DiffStatus`, `ComparisonLevel`, `CopyStatus`, `ComparisonStats`,
  `ComparisonEntry`, `ComparisonResult`, `CopyTask`, `SyncProfile`,
  `SyncHistoryEntry`, `HistoryPage`).
- **API layer:** `src/shared/api/index.ts` provides:
  - `scanAndCompare(sourcePath, destPath, level)` — invokes Tauri `scan_and_compare`.
  - `onScanProgress(callback)` — subscribes to `scan:progress` events.
  - `calculateSizeAndSpace(destinationRoot, selectedPaths)` — invokes Tauri `calculate_size_and_space`.
  - `saveHistoryEntry(entry)` — invokes Tauri `save_history_entry`.
  - `listHistory(page, pageSize)` — invokes Tauri `list_history`.
  - `copyFiles(sourceRoot, destinationRoot, items)` — `items` is `CopyFileItem[]`
    (with `relativePath: string` and `verify?: boolean`). Invokes Tauri `copy_files`.
  - `onCopyProgress(callback)` — subscribes to `copy:progress` events.
  - Exports `ScanProgress`, `SpaceInfo`, `SyncHistoryEntry`, `HistoryPage`,
    `CopyProgress`, `CopyItemResult`, and `CopyFileItem` TS interfaces.
- **Store:** Zustand store with selected paths, space check state (`fetchSpaceInfo` via `calculate_size_and_space`), copy state (`copyProgress`, `copyResults`, `copyRunning`, `copyDone`, `copyError`, `startCopy`, `onCopyProgress`, `resetCopy`), verification toggle (`verifyCopy`, `setVerifyCopy`), and actions (`toggleSelect`, `selectOnly`, `deselectAll`). No counter.
- **Test setup:** Vitest with jsdom, `@testing-library/react`, `@testing-library/jest-dom`.

### 6. Tauri Integration (`src-tauri/src/`)

**Status: 🚧 Partial — scan→compare→copy→history wired end-to-end, no scanner/comparator/copy-engine/history feature stubs yet**

- Tauri v2 app with dialog plugin registered.
- SQLite database initialized at app startup in the platform app data directory
  (`HistoryDb::open_or_create`), managed via `app.manage(db)` for state injection.
- Five real commands:
  - `scan_and_compare(source_path, dest_path, level)`:
    - Validates both paths, spawns concurrent source/dest scan via
      `tokio::try_join!`, streams `scan:progress` events to the frontend
      (then emits `scan:done`), then runs the comparator and returns `ComparisonResult`.
    - Helper `parse_comparison_level()` tested directly (8 unit tests).
  - `calculate_size_and_space(destination_root, selected_paths)`:
    - Computes total size of selected files and queries free space on
      destination via `fs2::available_space`.
    - Returns `SpaceInfo { total_selected_size, free_space_on_destination }`.
    - Tested directly (6 unit tests).
  - `copy_files(source_root, destination_root, items)`:
    - Cleans up orphaned `.musicsync.tmp` files from prior interrupted copies
      on the destination, then relays `copy:progress` / `copy:done` events
      while delegating to `CopyEngine::execute()` for atomic streaming copy
      with optional BLAKE3 verification.
    - Extracts core logic into `copy_files_inner()` for direct unit testing
      (3 tests: empty items, single file, multiple files, missing source).
  - `save_history_entry(entry)`:
    - Inserts a sync history record into SQLite.
    - Uses `State<HistoryDb>` injected at app setup.
  - `list_history(page, page_size)`:
    - Returns a paginated `HistoryPage` of sync history entries.
    - Orders by `started_at DESC`.
- Single window (1200×800, resizable), title "MusicSync".
- Capabilities: `core:default`, `dialog:default`, `core:event:default`.
- Bundle targets: all (macOS .dmg, Windows .msi, Linux .AppImage).

## Non-Functional Characteristics (current)

| Aspect | Current State |
|--------|--------------|
| Rust test suite | 35 (domain) + 15 (scanner) + 30 (comparator) + 22 (history) + 37 (copy_engine) + 17 (commands: 8 parse + 6 space + 3 copy) = passes |
| Frontend tests | 12 (FolderSelection) + 57 (ComparisonView) + 39 (CopyProgressView) + 22 (HistoryView) + 24 (store) — Vitest + jsdom |
| Frontend build | TypeScript compiles, Vite bundles |
| CI | Builds on 3 targets (macOS ARM, Windows, Linux) |
| Binary size | Not measured yet (dev build) |
| Memory | Not profiled yet |
