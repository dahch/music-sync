# Architecture Decision Records

> Records of significant architectural decisions made for MusicSync. Each ADR
> documents the context, decision, and consequences of a change to the system's
> architecture. New ADRs are appended; past decisions are never edited.

---

## ADR-001: Stack — Tauri v2 + Rust Core + React/TypeScript UI

- **Date:** 2026-07-01
- **Status:** Accepted

### Context

A desktop audio sync tool needs a modern UI, real multiplatform support, low
memory footprint, and fast startup. The primary platform is macOS (Apple
Silicon) but Windows and Linux must not be second-class. The developer already
dominates React/TypeScript.

### Alternatives considered

| Option | Pros | Cons |
|--------|------|------|
| Electron + React | Mature ecosystem | ~150-200 MB bundle, high RAM, Chromium on macOS instead of native WebKit |
| Tauri v2 + Rust + React | Native WebView (~5-15 MB bundle), sub-second startup, Rust for I/O-heavy work | Rust learning curve for core |
| Native per platform (Swift, Kotlin, GTK) | Best perf per platform | 3x maintenance cost |
| Flutter Desktop | Single language (Dart) | Outside developer's stack, less mature FS/IO |

### Decision

**Tauri v2** with:
- **Rust core** — filesystem scanning, hashing, diffing, copy queue; async I/O
  via `tokio`, CPU parallelism via `rayon` (planned).
- **React 18 + TypeScript + Vite** — UI communicates with core via Tauri IPC
  (`invoke`/`emit`-`listen`).

### Consequences

- Requires Rust toolchain in CI on all platforms.
- Core logic written in Rust (new language for the developer, but scoped to
  I/O + hashing + diffing — no UI in Rust).
- Tauri's WKWebView on macOS gives good power/CPU characteristics on Apple
  Silicon.

---

## ADR-002: Comparison Strategy — Cascading 3-Level Diff

- **Date:** 2026-07-01
- **Status:** Accepted (domain types exist; comparator L1+L2 implemented, L3 pending)

### Context

Audio file comparison can use: (a) path+name, (b) size+mtime, (c) content
hash. Each has trade-offs between speed and certainty.

### Decision

3-level cascading comparison:

1. **Level 1 — Structural (always on, O(n)):** key = relative path
   normalized (case-insensitive on macOS/Windows, configurable on Linux). If
   key missing on dest → **New**. Missing on source → **Orphan**.
2. **Level 2 — Metadata (default, O(n)):** compare `size_bytes` + `modified_at`
   with configurable mtime tolerance (default 2s, to absorb FAT32/exFAT
   precision loss). Equal → **Identical**. Different → **Different**.
3. **Level 3 — Hash (opt-in "Strict", O(n) but I/O-bound):** BLAKE3 content
   hash. Only when user doesn't trust mtime.

### Consequences

- Must expose the active comparison level in the UI so the user understands
  why files are marked "Identical" without byte-level verification.
- L1+L2 covers >95% of real-world cases without hashing every file.

---

## ADR-003: Scanning and Hashing Concurrency

- **Date:** 2026-07-01
- **Status:** Accepted (async scanning implemented; hashing not yet)

### Decision

- Directory scanning via `tokio::fs` (async, non-blocking).
- Source and destination scanned concurrently (`tokio::try_join!` on two async
  tasks).
- Hashing (Level 3) to be parallelized with `rayon` on a `num_cpus - 1` thread
  pool.
- Results streamed via `UnboundedSender<ScanProgress>` to avoid loading entire
  tree in memory before showing progress.

### Consequences

- Needs backpressure/bounded memory for libraries with 50k+ files.
- `scan_pair()` function in the scanner crate already runs both sides
  concurrently.

---

## ADR-004: Copy Strategy — Sequential Streaming Copy

- **Date:** 2026-07-01
- **Status:** Accepted (partially implemented — streaming copy done, atomic
  writes and post-copy verification deferred)

### Decision

- **Sequential streaming copy** (v1 implementation): chunked I/O via
  `tokio::io` (default 1 MiB chunks) with per-chunk progress events.
- One file at a time toward the same destination — matches the expected
  DAC/USB write bottleneck.
- `CopyEngine` owns the copy loop; the Tauri command `copy_files` relays
  `copy:progress` / `copy:done` events.
- **Post-copy verification** (BLAKE3 checksum) — deferred. Not implemented.
- **Atomic writes** (`.tmp` + rename) — deferred. Current implementation
  writes directly to the final path.
- **Space check before copy** — handled separately via `calculate_size_and_space`
  on the frontend side before invoking `copy_files`.
- **Failure isolation** — one failed file does not abort the queue.
- **Path safety** — `is_safe_relative()` rejects paths with `..` components
  at the application level before any I/O.

### Consequences

- Direct write (no `.tmp` + rename) means partial files can remain after an
  interrupt, but the next scan+compare run will detect them.
- No background temp cleanup needed (no `.musicsync.tmp` files to track).
- Sequential copy matches DAC/USB bottleneck; fast-media users incur no
  penalty because USB write speed dominates.
- Atomic writes and verification can be added as internal implementation
  changes to `CopyEngine` without API changes.

---

## ADR-005: Frontend State Management

- **Date:** 2026-07-01
- **Status:** Accepted (Zustand store implemented with selection + space check)

### Decision

**Zustand** (not Redux) for UI state:
- The heavy state (comparison tree, results) lives in the Rust core and is
  queried/paginated via Tauri IPC — not duplicated in JS.
- Zustand store holds: current user selection (checkboxes), space check state,
  view filters (planned), active task progress (planned).
- Virtualized list rendering (`@tanstack/react-virtual` planned) for 50k+
  entries.

### Consequences

- Minimal JS memory footprint even with large scan results.
- Keeps the store simple — no middleware, minimal boilerplate.
- Store actions (`toggleSelect`, `selectOnly`, `deselectAll`, `fetchSpaceInfo`)
  directly map to user interactions and Tauri IPC calls.

---

## ADR-006: MTP Device Limitation

- **Date:** 2026-07-01
- **Status:** Accepted (documented limitation)

### Context

Some DACs/renderers expose storage as MTP (Media Transfer Protocol) instead of
mounting as a standard filesystem volume. MTP is common on Android-based
devices but not real audio hardware like FiiO, iBasso, Astell&Kern, or Sony
Walkman (those use USB-MSC).

### Decision

**v1 only supports filesystem-mountable destinations** (USB Mass Storage /
mounted volumes). MTP support is explicitly out of scope for v1. If the
selected path is not a valid mount point, the app shows an educational message
suggesting the user switch their device to USB-MSC mode.

### Consequences

- MTP-only devices (mostly Android phones/tablets) won't work with v1.
- Possible future extension via `libmtp` (Linux/Windows only; macOS has no
  mature MTP support).
