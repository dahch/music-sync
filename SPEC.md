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

### 2. Schema Migration System (`src-tauri/crates/history/`)

**Status: 🚧 Partial (migrations done, no CRUD)**

- Versioned SQLite migrations via `rusqlite` (bundled).
- Tracks applied migrations in `_schema_version` table.
- Current migration (`001_sync_tables.sql`) creates:
  - `sync_profiles` — saved source/destination pairs with comparison level.
  - `sync_history` — sync run records with file counts, bytes, status.
- Idempotent: re-running migrations skips already-applied versions.
- Linear version sequence (no branching).

**Test coverage:** 12 tests covering table creation, column presence, defaults,
idempotency, error handling.

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

**Status: 🔧 Scaffold only**

- Placeholder function returning a string.
- No copy logic implemented yet.

### 5. Frontend (`src/`)

**Status: 🚧 Partial — scan→compare pipeline works, no copy UI yet**

- React 18 + TypeScript + Vite dev server (port 1420, HMR on 1421).
- Feature-Sliced Design directory structure: `app/`, `pages/`, `features/`,
  `entities/`, `shared/`.
- **Page:** `HomePage` orchestrates the full scan→compare flow: folder selection,
  progress display, comparison results table.
- **Features:**
  - `folder-selection` — source/dest folder picker (via `tauri-plugin-dialog`
    native dialogs) with comparison level selector (`Fast`, `Metadata`, `Strict`). 12 tests.
  - `comparison-view` — summary stat cards + table of entries with color-coded
    status (New/Orphan/Identical/Different). 30 tests.
  - `scanner`, `comparator`, `copy-engine`, `history` — still empty barrel stubs.
- **Entities:** TypeScript interfaces mirroring all Rust domain types
  (`MusicFile`, `DiffStatus`, `ComparisonLevel`, `CopyStatus`, `ComparisonStats`,
  `ComparisonEntry`, `ComparisonResult`, `CopyTask`, `SyncProfile`).
- **API layer:** `src/shared/api/index.ts` provides:
  - `scanAndCompare(sourcePath, destPath, level)` — invokes Tauri `scan_and_compare`.
  - `onScanProgress(callback)` — subscribes to `scan:progress` events.
- **Store:** Zustand store with counter example (`count`, `increment`).
- **Test setup:** Vitest with jsdom, `@testing-library/react`, `@testing-library/jest-dom`.

### 6. Tauri Integration (`src-tauri/src/`)

**Status: 🚧 Partial — scan→compare wired, no copy or history commands yet**

- Tauri v2 app with dialog plugin registered.
- One real command (`scan_and_compare`):
  - Accepts `source_path`, `dest_path`, `level` string arguments.
  - Validates both paths, spawns concurrent source/dest scan via
    `tokio::try_join!`, streams `scan:progress` events to the frontend,
    then runs the comparator and returns `ComparisonResult`.
  - Helper `parse_comparison_level()` tested directly (7 unit tests).
- Single window (1200×800, resizable), title "MusicSync".
- Capabilities: `core:default`, `dialog:default`, `core:event:default`.
- Bundle targets: all (macOS .dmg, Windows .msi, Linux .AppImage).

## Non-Functional Characteristics (current)

| Aspect | Current State |
|--------|--------------|
| Rust test suite | 15 (scanner) + 30 (comparator) + 12 (history) + 35 (domain) + 7 (commands) = passes |
| Frontend tests | 12 (FolderSelection) + 30 (ComparisonView) — Vitest + jsdom |
| Frontend build | TypeScript compiles, Vite bundles |
| CI | Builds on 4 targets (macOS ARM/Intel, Windows, Linux) |
| Binary size | Not measured yet (dev build) |
| Memory | Not profiled yet |
