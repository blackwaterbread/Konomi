# Konomi Developer README

The main [README.md](./README.md) is written for end users. This document is for developers and contributors, and covers local setup, architecture, workflows, and implementation notes.

## Development Environment

- Node.js 22+
- Bun 1.x

Install dependencies:

```bash
bun install
```

Run in development:

```bash
bun run dev
```

Build the app:

```bash
bun run build
```

Platform-specific packaging:

```bash
bun run build:win
bun run build:mac
bun run build:linux
```

## Common Scripts

```bash
bun run dev
bun run build
bun run lint
bun run typecheck
bun run format
```

Prisma-related scripts:

```bash
bun run db:generate
bun run db:migrate
```

The generated Prisma client is already included in the repository, and runtime migrations are also applied by the app itself. Because of that, Prisma commands are not always required for regular UI or Electron-layer work. That said, some internal script chains still use `npm run`, so it is safest to keep Node.js 22+ installed alongside Bun. For day-to-day use, treat `bun run ...` as the primary workflow.

## Project Structure

```text
src/
  main/       Electron main process, IPC, bridge, utility launcher
  preload/    contextBridge API definition
  renderer/   React UI
prisma/
  schema.prisma
```

## Runtime Topology

Konomi looks like a single desktop app from the outside, but internally it is split into several layers with distinct responsibilities.

- `renderer`
  - React UI
  - Manages search, gallery, generation, and settings screens
  - Persists UI state in `localStorage`
- `preload`
  - Exposes typed `window.*` bridge APIs
- `main`
  - Handles Electron lifecycle
  - Serves the `konomi://` local image protocol
  - Owns privileged filesystem access
  - Bridges requests to the utility process
- `utility`
  - Handles DB access
  - Runs folder scans
  - Owns watcher logic
  - Resolves duplicates
  - Performs similarity analysis
  - Runs NovelAI generation
- `worker threads`
  - Parse PNG metadata
  - Compute perceptual hashes

If there is a separate architecture memo in local development, it may be gitignored. This README should contain the core architecture information a new contributor needs.

## Request and Event Flow

### Request Flow

1. The renderer calls a preload API such as `window.image.listPage(...)`.
2. Preload forwards the request through `ipcRenderer.invoke(...)`.
3. Main either handles the request directly or forwards it to the utility process via `bridge.request(...)`.
4. The utility process executes the actual domain logic inside `handleRequest(...)`.
5. The result flows back through main and resolves in the renderer.

### Push Event Flow

1. The utility process emits events through `process.parentPort.postMessage(...)`.
2. The main bridge forwards those events to the renderer `webContents`.
3. Preload exposes subscription helpers such as `window.image.onBatch(...)`.
4. The renderer turns those events into UI updates like progress indicators, gallery refreshes, duplicate dialogs, and generation previews.

Main events currently in use:

- `image:batch`
- `image:removed`
- `image:scanProgress`
- `image:scanFolder`
- `image:hashProgress`
- `image:similarityProgress`
- `image:searchStatsProgress`
- `image:watchDuplicate`
- `nai:generatePreview`

## Key Development Areas

### 1. Gallery and Scanning

- The app is centered around PNG files.
- An initial scan runs on startup, and the watcher applies incremental updates afterward.
- Metadata parsing prioritizes WebUI/A1111 PNG metadata, then falls back to NovelAI stealth metadata.
- Search performance depends on cached tag, model, and resolution statistics.

### 2. PromptInput

- `PromptInput` is one of Konomi's core UX features.
- Instead of treating the prompt as an opaque string, it works with `TokenChip`-level units to improve editing and reuse.
- The main UI lives in [prompt-input.tsx](./src/renderer/src/components/prompt-input.tsx) and [token-chip.tsx](./src/renderer/src/components/token-chip.tsx).

### 3. Image Generation

- The NovelAI API key is stored in the database.
- Most generation parameters are stored in renderer `localStorage`.
- The generator supports metadata import from existing images, reference images, vibe transfer, and precise reference inputs.
- Preview images are streamed back to the renderer through push events.

### 4. Similarity Analysis

- Similarity is not based on pHash alone. It combines pHash with prompt-token similarity.
- Analysis is deferred until scanning is idle.
- Threshold changes may require recomputation.

## Core Workflows

### 1. App Startup

- IPC handlers and the utility bridge are initialized in `app.whenReady()`.
- Main registers the `konomi://local/...` protocol.
- Utility seeds built-in categories and schedules delayed prompt token backfill.
- Renderer loads categories and search preset stats.
- An initial full scan starts, then the watcher starts, and similarity analysis follows once the app becomes idle.

### 2. Folder Add and Duplicate Resolution

- Adding a folder is intentionally split into duplicate review and actual DB creation.
- The renderer checks for duplicate candidates with `window.folder.findDuplicates(path)` before creating a folder row.
- If duplicates exist, the duplicate resolution dialog opens first.
- Only after the user chooses whether to keep existing files, keep incoming files, or ignore the incoming files does the actual `Folder` creation and scan proceed.
- Watcher-detected duplicates reuse the same dialog flow.

### 3. Scanning and Metadata Ingestion

- Only PNG files are scanned.
- `readImageMeta(...)` checks WebUI/A1111 metadata first, then NovelAI stealth metadata.
- Unchanged files are skipped using `fileModifiedAt`.
- New files are parsed in worker threads and then batch-upserted into the database.
- Search stats and similarity cache are updated incrementally where possible.
- Scan cancellation is handled through a shared cancel token.

### 4. Watcher Behavior

- Each managed folder uses `fs.watch(..., { recursive: true })`.
- File events are debounced by 500ms.
- If filenames are omitted or path casing drifts, the watcher falls back to full-folder reconciliation.
- Exact duplicates are detected before import and held until the user resolves them.

### 5. Image Generation

- Generation requests flow from renderer to utility.
- Utility patches NovelAI SDK request payloads to preserve exact seed, negative prompt, and V4 character behavior.
- Intermediate previews are emitted through `nai:generatePreview`.
- Final images are saved to the configured output folder, registered as transiently allowed paths in main, and previewed through `konomi://local/...`.

## Data Storage

- SQLite DB: `{userData}/konomi.db`
- Window bounds: `{userData}/window-bounds.json`
- Renderer UI state: `localStorage`

The Prisma schema lives in [schema.prisma](./prisma/schema.prisma).

Main models:

- `Folder`
- `Image`
- `Category`
- `ImageCategory`
- `PromptCategory`
- `PromptGroup`
- `PromptToken`
- `NaiConfig`
- `IgnoredDuplicatePath`
- `ImageSearchStat`
- `ImageSimilarityCache`

Important derived and cached data:

- `Image.promptTokens`, `negativePromptTokens`, and `characterPromptTokens` are stored as JSON strings.
- `fileSize` is persisted to make exact duplicate checks cheaper.
- `ImageSearchStat` is maintained incrementally instead of rebuilt for every search.
- `ImageSimilarityCache` is refreshed incrementally for touched images when possible.

## Security and File Access

- Privileged file operations should live in main, not renderer.
- `konomi://` is not a general local-file protocol. It only serves files under managed roots or transiently allowed paths.
- These constraints are enforced in [path-guard.ts](./src/main/lib/path-guard.ts).
- Operations such as `image:readFile`, `image:delete`, `image:revealInExplorer`, and protocol-serving all validate paths before touching the filesystem.
- Generated files are only temporarily whitelisted.

## Useful Files

- App entry: [index.ts](./src/main/index.ts)
- IPC registration: [ipc.ts](./src/main/ipc.ts)
- Utility entry: [utility.ts](./src/main/utility.ts)
- DB init: [db.ts](./src/main/lib/db.ts)
- Image scan/search: [image.ts](./src/main/lib/image.ts)
- Watcher: [watcher.ts](./src/main/lib/watcher.ts)
- Similarity analysis: [phash.ts](./src/main/lib/phash.ts)
- NovelAI generation: [nai-gen.ts](./src/main/lib/nai-gen.ts)
- Main UI shell: [App.tsx](./src/renderer/src/App.tsx)

## Packaging Notes

- Packaging is configured in `electron-builder.yml`.
- Prisma and `better-sqlite3` are externalized.
- Build entry points are configured in `electron.vite.config.ts`.
- The utility process and worker files are included as build entries.
- Utility startup depends on the `KONOMI_USER_DATA` and `KONOMI_MIGRATIONS_PATH` environment variables.

## Implementation Notes and Gotchas

- `readImageMeta(...)` checks WebUI metadata before NovelAI stealth metadata because it is cheaper to parse.
- The utility process cannot access `electron.app` directly. Pass required values through environment variables.
- CSS image URLs are safer as `url('${src}')` because Chromium can misparse encoded `)` characters otherwise.
- Window bounds and resizable panel sizes are flushed on close, mouseup, and `beforeunload`.

## Development Notes

- Prefer keeping privileged filesystem behavior in main.
- When a feature crosses process boundaries, the usual flow is:

```text
add preload types/functions
-> register main IPC handler
-> route request in utility
-> implement domain logic
-> wire up renderer usage
```

- Any local image access through `konomi://` must respect path-guard constraints.
- Utility code should rely on environment variables instead of `electron.app`.

## Extension Guide

When adding a new IPC capability, the usual sequence is:

1. Add the preload surface in [index.ts](./src/preload/index.ts).
2. Add the type definitions in [index.d.ts](./src/preload/index.d.ts).
3. Register the IPC handler in [ipc.ts](./src/main/ipc.ts).
4. If the feature belongs in utility, add request routing in [utility.ts](./src/main/utility.ts).
5. Implement the actual logic in an appropriate `src/main/lib/*` module.

When adding a new search or filter dimension, the usual changes are:

1. Extend the query types shared across preload and utility.
2. Thread the new field through the `image:listPage` request path.
3. Update DB filtering in [image.ts](./src/main/lib/image.ts).
4. Add renderer controls in [App.tsx](./src/renderer/src/App.tsx), [header.tsx](./src/renderer/src/components/header.tsx), and/or [advanced-search-modal.tsx](./src/renderer/src/components/advanced-search-modal.tsx).
5. Extend `ImageSearchStat` maintenance if the feature depends on cached suggestions or aggregates.

## Docs

- User-facing doc: [README.md](./README.md)
