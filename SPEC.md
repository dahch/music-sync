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

**Status: 🔧 Scaffold only**

- Placeholder function returning a string.
- No comparison logic implemented yet.

### 4. Copy Engine (`src-tauri/crates/copy_engine/`)

**Status: 🔧 Scaffold only**

- Placeholder function returning a string.
- No copy logic implemented yet.

### 5. Frontend (`src/`)

**Status: 🔧 Scaffold**

- React 18 + TypeScript + Vite dev server (port 1420, HMR on 1421).
- Feature-Sliced Design directory structure: `app/`, `pages/`, `features/`,
  `entities/`, `shared/`.
- **Entities:** TypeScript interfaces mirroring all Rust domain types
  (`MusicFile`, `DiffStatus`, `ComparisonLevel`, `CopyStatus`, `ComparisonStats`,
  `ComparisonEntry`, `ComparisonResult`, `CopyTask`, `SyncProfile`).
- **Store:** Zustand store with counter example (`count`, `increment`).
- **UI:** Home page with counter display and button.
- `shared/api/`, `shared/lib/`, `shared/ui/`, `app/providers/` — all empty stubs.

### 6. Tauri Integration (`src-tauri/src/`)

**Status: 🔧 Scaffold**

- Tauri v2 app with dialog plugin registered.
- One command (`greet`) returning a scaffold message.
- Single window (1200×800, resizable), title "MusicSync — scaffolding OK".
- Capabilities: `core:default`, `dialog:default`.
- Bundle targets: all (macOS .dmg, Windows .msi, Linux .AppImage).

## Non-Functional Characteristics (current)

| Aspect | Current State |
|--------|--------------|
| Rust test suite | 15 (scanner) + 12 (history) + domain tests = passes |
| Frontend build | TypeScript compiles, Vite bundles |
| CI | Builds on 4 targets (macOS ARM/Intel, Windows, Linux) |
| Binary size | Not measured yet (dev build) |
| Memory | Not profiled yet |
