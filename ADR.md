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
- **Status:** Superseded by ADR-007

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
- **Status:** Accepted (Zustand store implemented with selection + space check + copy state + verify toggle)

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

---

## ADR-007: Atomic Copy with Optional Verification

- **Date:** 2026-07-02
- **Status:** Accepted
- **Supersedes:** ADR-004 (atomic writes and post-copy verification portions)

### Context

ADR-004 specified deferred atomic writes and post-copy verification. After
implementing the copy engine, tests showed that direct-to-destination writes
left partial files on interrupt. Since the target is USB mass-storage (DACs,
portable devices), interrupted copies are a real risk (user unplugs mid-copy).
Additionally, users may want to verify that copied audio files are bit-perfect.

### Decision

The copy engine (`CopyEngine::execute()`) now implements:

1. **Atomic writes via `.tmp` + rename:** each file is first written to a
   `.musicsync.tmp` sibling path, then atomically renamed to the final path
   via `tokio::fs::rename`. On failure at any stage, the temp file is deleted.
   If the process crashes during the write, orphaned `.tmp` files are cleaned
   up at the next copy run via `cleanup_tmp_files()`.

2. **Optional BLAKE3 verification:** each `CopyItem` carries a `verify: bool`
   field (frontend toggle "Verify with checksum (BLAKE3)"). When true, the
   source file is hashed during the streaming read (incremental BLAKE3), then
   the temp file is re-hashed after all chunks are written. On hash mismatch,
   the temp file is deleted and the item is marked `Failed`.

3. **Sequential (not parallel) copy retained:** files are still copied one at
   a time toward the same destination. The DAC/USB write bottleneck makes
   parallelism counterproductive for this use case.

### Consequences

+ Partial files no longer appear on the destination after interrupted copies
  (the temp file is removed on abort or cleaned up on next run).
+ Users can enable BLAKE3 verification per copy run, at the cost of re-reading
  each copied file (roughly 2x I/O).
+ `blake3` crate added as a dependency (lightweight, no C dependencies).
+ Copy engine tests expanded from 17 to 70 to cover atomic path, verification,
  orphan cleanup, pause/resume/cancel, pre-flight space check, and
  mount/unmounted detection.
+ Verification is opt-in — no overhead for users who don't need it.

---

## ADR-008: Frontend Styling — Tailwind CSS v4 with Design Tokens

- **Date:** 2026-07-02
- **Status:** Accepted

### Context

The frontend components were initially styled with inline styles and ad-hoc
class strings. As the UI grew (header, dark mode, status-colored elements),
a consistent styling system was needed to:
- Enforce a cohesive visual language across all components.
- Support light/dark themes without duplicating style logic.
- Keep the bundle small (no unused CSS) with utility-first approach.

### Alternatives considered

| Option | Pros | Cons |
|--------|------|------|
| CSS Modules | Scoped styles, no build tooling | No design tokens, dark mode requires manual media queries |
| Styled Components / Emotion | Runtime CSS-in-JS, dynamic styles | Runtime overhead, SSR complexity overkill for a desktop app |
| Tailwind CSS v4 | Zero-runtime, atomic CSS, `@theme` for tokens, Vite plugin | Utility classes can be verbose, learning curve for token system |
| Vanilla CSS with custom properties | Simple, no deps | No atomic utilities, harder to enforce consistency |

### Decision

**Tailwind CSS v4** with the `@tailwindcss/vite` plugin (no PostCSS config
needed). Design tokens defined in `src/index.css` using Tailwind's `@theme`
directive:

- **Semantic color tokens:** `surface-0..3`, `border`, `border-subtle`,
  `text-primary`, `text-secondary`, `text-muted`, `accent`, `accent-hover`,
  `danger`, `danger-soft`, `warning`, `warning-soft`, `info`, `info-soft`.
- **Light/dark variants:** light values in `@theme`, dark overrides in
  `.dark { ... }` block. Dark mode toggled via `.dark` class on the root
  element, persisted in `localStorage.theme`.
- **Custom dark variant:** `@custom-variant dark (&:is(.dark *))` — class-based
  (not media-query), giving the user explicit control.
- **Fonts:** `--font-sans` (Inter) and `--font-mono` (JetBrains Mono) defined
  in `@theme`.

All components use Tailwind utility classes referencing these tokens
(e.g., `bg-surface-0`, `text-text-primary`, `border-border`). Status-specific
colors (emerald for New, amber for Orphan, red for Different) use Tailwind's
built-in palette with `dark:` variants.

### Consequences

+ Single source of truth for colors in `src/index.css` — changing a token
  propagates everywhere automatically.
+ Dark mode is a class toggle, not a media query — user-controlled, no
  system-preference detection (intentional for a desktop app).
+ Tailwind v4's Vite plugin eliminates PostCSS config — one import in
  `vite.config.ts`.
+ Zero runtime CSS overhead — all styling is static atomic classes.
- Verbose class strings in complex components (mitigated by consistent
  token naming).
- `CopyPlanView` still uses raw Tailwind colors (`zinc-*`, `emerald-*`)
  instead of design tokens — should be migrated in a follow-up.
