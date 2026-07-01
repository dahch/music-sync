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
- **Status:** Accepted (domain types exist; comparison logic not yet implemented)

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

## ADR-004: Atomic Copy Strategy

- **Date:** 2026-07-01
- **Status:** Accepted (not yet implemented — copy-engine is scaffold)

### Decision

- Streaming copy in configurable chunks (default 1 MB), with a wrapper around
  `tokio::fs::copy` for per-file and per-batch progress.
- Sequential copy per destination disk to avoid saturating slow USB/DAC write
  speeds.
- Post-copy verification (BLAKE3 checksum) optional, off by default.
- **Atomic writes:** copy to `<dest>/<path>.musicsync.tmp` first, then atomic
  `rename` to final name only on success (and optional verification pass). This
  prevents visible partial/corrupt files if the device is disconnected mid-copy.
- Space check before starting: total plan size vs free space on destination.

### Consequences

- `.musicsync.tmp` cleanup on startup handles crash recovery.
- Sequential copy is slower for multiple fast disks but matches the expected
  bottleneck (DAC USB write speed).

---

## ADR-005: Frontend State Management

- **Date:** 2026-07-01
- **Status:** Accepted (Zustand store scaffolded with counter example)

### Decision

**Zustand** (not Redux) for UI state:
- The heavy state (comparison tree, results) lives in the Rust core and is
  queried/paginated via Tauri IPC — not duplicated in JS.
- Zustand store only holds: current user selection (checkboxes), view filters,
  active task progress.
- Virtualized list rendering (`@tanstack/react-virtual` planned) for 50k+
  entries.

### Consequences

- Minimal JS memory footprint even with large scan results.
- Keeps the store simple — no middleware, minimal boilerplate.

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
