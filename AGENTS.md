# AGENTS.md

Guidance for coding agents working in this repository.

## Package Manager
- Use **bun** (not npm or yarn)

## Commands
```bash
bun run dev          # Start dev server (Electron + Vite HMR)
bun run build        # Typecheck + build for production
bun run build:win    # Build Windows installer
bun run typecheck    # Run both node + web typechecks
bun run lint         # ESLint
bun run db:migrate   # Run Prisma migrations (app must be closed first — SQLite locks)
bun run db:generate  # Regenerate Prisma client after schema changes
bun run db:init      # Delete the dev user-data directory (konomi-dev; --dry-run to preview)
bun run test:backend   # Vitest backend suite (run under Electron's Node)
bun run test:frontend  # Vitest frontend suite
bun run test:server    # Vitest server suite
bun run dev:server   # Web server with --watch (bun)
bun run dev:web      # Vite dev server for the web frontend
bun run dev:web:all  # dev:server + dev:web together
bun run build:web    # Build the web frontend (out/web; Docker copies it to src/web/dist)
bun run db:generate:server  # Regenerate the MariaDB Prisma client
bun run db:migrate:server   # Prisma migrate dev against MariaDB
bun run db:push:server      # Prisma db push against MariaDB
bun run prebuild:native     # Build the native addons (konomi-image, webp-alpha)
bun run format       # Prettier
```

## Project
- Electron-vite + React + TypeScript + Prisma (SQLite via better-sqlite3)
- Image gallery app: supports NovelAI, Stable Diffusion WebUI, ComfyUI and Midjourney PNG metadata (NovelAI also from WebP), search, favorites, folder filtering

## Architecture

### Process Model
- **Core library** (`src/core/`, `@konomi/core`) — Platform-agnostic business logic, shared between Desktop (Electron) and Web (Fastify) backend
- **Desktop app** (`src/app/`) — Electron main/preload/renderer
  - **Main process** (`src/app/main/`) — Window management, IPC registration, protocol handler, file dialogs
  - **Utility process** (`src/app/main/utility.ts`) — All DB/scanning/hashing work runs here via `utilityProcess.fork()`
  - **Preload** (`src/app/preload/`) — contextBridge IPC bridge between renderer and main
  - **Renderer** (`src/app/renderer/`) — Electron entry only (`index.html`, `src/main.tsx`, `src/api-impl.ts` wraps the preload `window.*` API as `KonomiApi`); the React UI it mounts is `src/web/`
- **Web frontend** (`src/web/`, alias `@/`) — React UI shared by the Electron renderer and the browser build (`src/web/main.tsx` + `browser-api.ts`, which talks to the web server over HTTP + WebSocket)
- **Web server** (`src/server/`) — Fastify + WebSocket backend for self-hosted (NAS/home server) deployments; see [web server section](#web-server-srcserver) below

### Core Library (`src/core/`)
- **DI pattern**: factory functions (`createService(deps)`) with closure-based dependency injection — no DI framework
- **Prisma directly**: services depend on concrete Prisma repo types (`ImageRepo`, `FolderRepo`, etc.) from `src/core/lib/repositories/` — no abstract interfaces
- **Adapter interfaces**: `SearchStatsAdapter`, `IgnoredDuplicateAdapter`, `SimilarityCacheAdapter` for infra-specific operations
- **`@core/*` path alias**: configured in tsconfig + Vite + vitest for clean imports
- Services: `scan-service`, `folder-service`, `category-service`, `prompt-builder-service`, `nai-gen-service`
- Pure algorithms: `similarity.ts` (hamming, Jaccard, hybrid scoring), `scanner.ts`, `token.ts`

### IPC Flow
```
Renderer → window.image.scan()
  → ipcRenderer.invoke("image:scan")
  → ipcMain.handle → bridge.request("image:scan", { detectDuplicates })
  → UtilityProcess message → handleRequest switch
  → scanService.scanAll() → sender.send("image:batch", ...)
  → bridge forwards push event → webContents.send("image:batch", ...)
  → ipcRenderer.on("image:batch") → React state update
  → scan reply → ipcMain handler sends event.sender.send("image:scanSettled", requestId)
    before returning the reply
  → preload `scan()` resolves only after both the reply and its "image:scanSettled"
```
- The renderer can receive an invoke reply **before** pushes sent earlier
  (reply and `webContents.send` are not ordered against each other; pushes are
  ordered among themselves). `image:scanSettled` travels behind the scan's own
  pushes, so `window.image.scan()` settles only after every push that scan
  emitted (`image:batch`, `image:scanSkipped`, `image:scanFolder`, ...) has been
  dispatched — the same guarantee `browser-api.scanAndWait` gets from the single
  WebSocket. Without it the boot scan's last batch can reach `onBatch` after
  `runScan` has cleared `scanningRef` (false "새 이미지" banner, extra
  `listSubdirectories` / `getSearchPresetStats`).
- `requestId` is generated in preload (per-document random scope + counter) and
  echoed only to the requesting webContents; a rejected invoke rejects `scan()`
  at once without waiting for the push.

### UtilityBridge (`src/app/main/bridge.ts`)
- `bridge.request(type, payload)` — sends request to utility process, returns Promise
- Push events (messages with `event` field) are forwarded to renderer via `webContents.send()`
- Started with `bridge.start(utilityPath)` inside `app.whenReady()`
- Passes `KONOMI_USER_DATA` + `KONOMI_MIGRATIONS_PATH` (`<appPath>/prisma/migrations/sqlite`) + `KONOMI_PREBUILDS_PATH` (native addon prebuilds: `<resourcesPath>/app.asar.unpacked/prebuilds` when packaged, `<appPath>/prebuilds` in dev) env vars to utility process
- Also passes `UV_THREADPOOL_SIZE` — the libuv pool that runs the scan's `fs.stat` / `opendir`: `"8"` unless the launching environment already has a non-empty value (an empty one counts as unset). Utility process only; the main process keeps libuv's default 4 and `src/server` is not affected. On Windows, libuv gives pool threads an 8 MB stack (libuv's `src/threadpool.c`, `init_threads`). Before libuv 1.53, `uv_thread_create_ex` passes that size to `_beginthreadex` as the commit size, so each thread above the default 4 commits another 8 MB; from 1.53 it adds `STACK_SIZE_PARAM_IS_A_RESERVATION` and the size is only reserved. Which applies depends on the bundled Electron's `process.versions.uv` (1.51.0 in Electron 39.8.0)

## Key Files

### Core (`src/core/`)
- `src/core/types/repository.ts` — Entity types (`ImageEntity`, `FolderEntity`, etc.) and data shapes (`ImageUpsertData`, `SearchStatSource`)
- `src/core/types/image-meta.ts` — `ImageMeta` type shared across metadata readers
- `src/core/types/event-sender.ts` — `EventSender` interface for push events
- `src/core/lib/repositories/` — Prisma repo implementations; each exports a concrete type (`ImageRepo`, `FolderRepo`, `CategoryRepo`, `NaiConfigRepo`, `PromptRepo`)
- `src/core/lib/db.ts` — Prisma client singleton; custom migration runner (reads `.sql` files from `KONOMI_MIGRATIONS_PATH`); uses `process.env.KONOMI_USER_DATA` (NOT `electron.app`)
- `src/core/lib/image-infra.ts` — WorkerPool-backed metadata reader, file hashing, ignored duplicate path management
- `src/core/lib/search-stats-store.ts` — Prisma (SQLite / MariaDB) implementation of search stat CRUD (ImageSearchStat table); `applyImageSearchStatsMutations` (builds deltas from before/after rows) and `applyImageSearchStatDeltas` (already-folded deltas) both apply in one transaction
- `src/core/lib/search-stats.ts` — pure search-stat logic: token-text extraction, delta building, tag-suggestion helpers, and the delta accumulator (`createStatDeltaAccumulator` / `accumulateStatMutation` / `getAccumulatedStatDeltas`; `buildStatDeltasFromMutations` is built on it). The accumulator keeps keys whose sum returns to 0 so a tag keeps the first spelling that touched it
- `src/core/lib/phash.ts` — pHash computation orchestration, similarity cache DDL/CRUD, IDF encoding
- `src/core/lib/prompts-db.ts` — bundled prompt-tag suggestion DB access (`prompts.db`)
- `src/core/lib/worker-pool.ts` — Generic `WorkerPool<T>` (lazy/eager modes, idle timeout, typed results)
- `src/core/lib/nai.worker.ts` — Worker Thread: calls `readImageMetaForScan` (`image-infra.naiPool`: lazy, 10 s idle timeout, up to `max(4, min(os.availableParallelism() - 1, 8))` workers — the same size expression as `phash.ts`'s eager `pHashPool`)
- `src/core/lib/phash.worker.ts` — Worker Thread: computes pHash per image
- `src/core/lib/konomi-image.ts` — Native addon wrapper: `computePHash`, `computeAllPairs`, `extractNaiLsb`, `resizePng`
- `src/core/lib/webp-alpha.ts` — Native addon wrapper: `decodeWebpAlpha`, `decodeWebpRgb`, `resizeWebp`
- `src/core/lib/path-key.ts` — `normalizePathKey`: the one comparison key for "is this the same file?" (trailing slash everywhere; separators and case on win32 only). String fold, not a filesystem lookup — `app/main/lib/path-guard` keeps its own `realpath`-based fold for protocol authorization
- `src/core/lib/duplicate-detect.ts` — duplicate detection primitives (size bucketing, signature bucketing, group assembly) shared by `duplicate-service` and `scan-service`'s pre-scan
- `src/core/types/adapters.ts` — `SearchStatsAdapter`, `SimilarityCacheAdapter`, `IgnoredDuplicateChecker`/`IgnoredDuplicateAdapter`; declared once here so services do not each export a drifting copy. `SearchStatsAdapter` has `applyMutations` (duplicate-service) and `applyDeltas` (scan-service). Exception: `image-service` still declares its own `applyMutations`-only `SearchStatsAdapter`; the Electron and server wiring pass one object with both methods to all three services
- `src/core/lib/similarity.ts` — pure similarity algorithms: hamming distance, Jaccard, hybrid scoring, threshold config
- `src/core/lib/scanner.ts` — PNG/WebP walker (`walkImageFiles`, `opendir` with `bufferSize` 256; `scanImageFiles`, `countImageFiles`) + `withConcurrency` with `CancelToken` support
- `src/core/lib/token.ts` — parses prompt strings into tokens
- `src/core/lib/image-meta.ts` — `readImageMeta` dispatcher (PNG: WebUI → ComfyUI → Midjourney → NAI; WebP: NAI)
- `src/core/lib/nai.ts` — NAI steganography parser (tEXt + native LSB + WebP alpha)
- `src/core/lib/webui.ts` — SD WebUI PNG tEXt chunk parser
- `src/core/lib/midjourney.ts` — Midjourney PNG text/XMP metadata parsing
- `src/core/lib/comfyui.ts` — ComfyUI PNG metadata: walks the API prompt graph in the `prompt` text chunk, falls back to `workflow` widget values
- `src/core/lib/png-meta.ts` — shared PNG chunk/text helpers used by metadata readers
- `src/core/lib/logger.ts` — logging utilities
- `src/core/services/scan-service.ts` — `createScanService`: scan coordinator (`scanAll`, `scanOne`), duplicate detection. `syncFolder` writes changed files in batches of up to `BATCH_SIZE` (100) rows, one `upsertBatch` transaction each (32-row INSERT chunks inside), and pushes one `image:batch` per batch. Search-stat before/after pairs are folded into a delta accumulator per batch (and on stale-row deletion) and applied once when the folder finishes, in one transaction — also on a cancelled scan, for the rows it wrote. The progress denominator comes from `Folder.lastScanFileCount` per target, with a counting walk only where there is no usable count (see `image:scanProgress` under Push Events), so a boot scan walks each folder once
- `src/core/services/folder-service.ts` — `createFolderService`: CRUD, subfolder paths, stats
- `src/core/services/category-service.ts` — `createCategoryService`: CRUD + `seedBuiltins`, `addImagesByPrompt`
- `src/core/services/prompt-builder-service.ts` — `createPromptBuilderService`: prompt group/token CRUD + reorder + builtin seeding
- `src/core/services/nai-gen-service.ts` — `createNaiGenService`: NAI API config, validation, streaming generation
- `src/core/services/similarity-service.ts` — `createSimilarityService`: union-find clustering, group cache, reason assembly
- `src/core/services/image-service.ts` — `createImageService`: listing, rescan metadata, `registerExternalPath` for direct (watcher-free) registration of in-app generated files
- `src/core/services/duplicate-service.ts` — `createDuplicateService`: SHA-1 based duplicate detection
- `src/core/services/prompt-tag-service.ts` — `createPromptTagService`: prompt-tag suggestions from bundled DB
- `src/core/services/maintenance-service.ts` — `createMaintenanceService`: debounced background analysis runner (`computeAllHashes` + similarity refresh) wired by both the utility process and the server; `scheduleAnalysis`, `runAnalysisNow`, cancel/resume, defers while a scan is active, pushes `image:analysisActive` / `image:hashProgress` / `image:similarityProgress`
- `src/core/services/background-tasks.ts` — `createBackgroundTasks`: cooperative cancellation for header-status work. `track(work)` hands each task a `CancelToken`; `run(work)` does the same and returns `null` if the task was cancelled; `cancel()` flips every live token (`image:cancelScan`, server `/api/images/scan/cancel`); `isCancelling()` is true while a cancelled task is still running
- `src/core/index.ts` — barrel exports for all core types, services, and functions

### Main process (`src/app/main/`)
- `src/app/main/index.ts` — app entry, registers `konomi://` protocol, window bounds persistence, syncs `prompts.db` to userData before bridge start; creates the main window right after `bridge.start()` (it does not wait for the utility or the path-guard warm-up)
- `src/app/main/bridge.ts` — UtilityBridge: request/response + push event forwarding; no request timeout by default (`KONOMI_BRIDGE_TIMEOUT_MS` sets a finite one, min 5s); auto-restarts utility process on unexpected exit
- `src/app/main/utility.ts` — Utility process entry: `handleRequest` switch, wires core services with Prisma repos, cancel token management. No DB work at module load; see [DB Migration](#db-migration) for the readiness order
- `src/app/main/ipc.ts` — IPC handler registration (dialog/shell stay in main; DB/logic → bridge); `db:runMigrations` starts the path-guard warm-up (`warmManagedRootsCache`) only after the migrations succeed
- `src/app/main/lib/path-guard.ts` — managed-root and transient-path authorization for `konomi://` protocol
- `src/app/main/lib/updater.ts` — Electron auto-updater
### Preload & Renderer
- `src/app/preload/index.ts` + `index.d.ts` — `window.image / folder / dialog / db / nai / category / promptBuilder / appInfo` API. `index.d.ts` re-exports the shared data / API types from `src/web/api/data-types.ts` and `types.ts` (renderer code imports them as `@preload/index.d`). It also `import type`s every data type its `declare global` `Window` block names, so `window.*` is checked with the real types (e.g. `readNaiMeta` → `ImageMeta | null`, whose `seed` is a `string`). A name used in that block without an import still resolves to `any` silently — `skipLibCheck` hides the TS2304 in this `.d.ts`, and only `src/web/tsconfig.json` includes it — so add the import with the name
- `src/web/bootstrap-app.tsx` — pre-shell bootstrap: reads settings, runs `db.runMigrations()` (splash shows migration progress), then loads folders and mounts `App` after the splash minimum. If the migrations fail it stays on `AppSplash` in its failed state with the error and never loads folders or mounts `App`. The boot scan starts after `App` mounts, not here
- `src/web/App.tsx` — renderer composition root; wires controller hooks into presentational components
- `src/web/hooks/useSettings.ts` — localStorage settings with `DEFAULTS` export + `resetSettings`
- `src/web/hooks/useNaiGenSettings.ts` — localStorage NAI generation settings
- `src/web/hooks/useFolderController.ts` — top-level folder controller (stored folders, selection persistence, drag order)
- `src/web/hooks/useBrowseScope.ts` — active sidebar view, category selection, random-seed, gallery query fragment
- `src/web/hooks/useGalleryController.ts` — search text, sort/view mode, pagination, bulk-action query assembly
- `src/web/hooks/useImageActions.ts` — shared image commands (favorites, category, delete, generator handoff)
- `src/web/hooks/useGalleryImages.ts` — paged gallery refresh loop
- `src/web/hooks/useScanning.ts` — scan lifecycle and cancellation
- `src/web/hooks/useImageAnalysis.ts` — analysis run state (`image:analysisActive`), manual trigger (`runAnalysisNow`), similarity thresholds; scheduling lives in core `maintenance-service`
- `src/web/hooks/useSimilarImages.ts` — detail-drawer similar-image hydration + reason mapping
- `src/web/hooks/useAppShellState.ts` — active panel, sidebar width, first-run language screen, feature-tour gating
- `src/web/hooks/useSettingsAnalysisController.ts` — settings update/reset + hash-reset orchestration
- `src/web/hooks/useSearchPresetStats.ts` — cached resolution/model aggregates + rebuild progress
- `src/web/hooks/useImageWatchBootstrap.ts` — boot scan (`runAppInitialization`), batch/removal event subscriptions (`useImageEventSubscriptions`)
- `src/web/hooks/useAppAppearance.ts` — theme + language application, `isDarkTheme` derivation
- `src/web/hooks/useFolders.ts`, `useDuplicateResolutionDialog.ts` — folder management hooks
- `src/web/components/settings-view.tsx` — settings panel with per-setting reset buttons
- `src/web/components/token-chip.tsx` — single token editor chip with popover UI
- `src/web/components/token-container.tsx` — token collection with drag-and-drop reordering
- `src/web/components/prompt-input.tsx` — raw-first prompt editor with optional Block mode, `@{...}` group autocomplete, overlay highlighting
- `src/web/components/prompt-group-panel.tsx` — prompt category/group management UI (named tag lists, draggable chips)
- `src/web/components/prompt-source-panel.tsx` — generator reference tab; exposes existing image tokens as draggable chips
- `src/web/components/advanced-search-modal.tsx` — resolution/model filter UI
- `src/web/components/app-info-dialog.tsx` — app version/environment info dialog + open source licenses dialog
- `src/web/components/wildcard-chip.tsx` — wildcard token chip (`%{opt1|opt2}` editor with option list)
- `src/web/components/onboarding-view.tsx` — empty-library first-call-to-action (add first folder)
- `src/web/components/feature-tour.tsx` — guided overlay tour; can reopen from App Info
- `src/web/components/initial-language-screen.tsx` — first-run language chooser shown before feature tour
- `src/web/components/app-splash.tsx` — bootstrap splash UI with progress/status
- `src/web/lib/advanced-filter.ts` — `AdvancedFilter` type + helpers (`filterLabel`, `filterKey`, `filtersEqual`)
- `src/web/lib/search-input-event.ts` — custom `konomi:search-input-append-tag` event for inter-component tag appending
- `src/web/lib/i18n.ts` — i18next resource registration, system-language resolution and application
- `src/web/lib/prompt-emphasis-syntax.ts` — overlay-based highlighting for weight emphasis, group references, malformed syntax

## Image Source Detection
- `readImageMeta(filePath)` in `image-meta.ts` — PNG: tries WebUI first, then ComfyUI, then Midjourney text/XMP, then NAI; WebP: NAI only
- WebUI: reads `tEXt` chunk with key `parameters`, parses plain-text format
- ComfyUI: JSON prompt graph in the `prompt` text chunk, falling back to `workflow`, via `comfyui.ts`
- Midjourney: PNG text/XMP metadata parsing via `midjourney.ts`
- NAI: PNG text chunks first, otherwise full pixel decode + LSB steganography extraction; WebP: alpha-channel LSB
- Shared PNG chunk helpers in `png-meta.ts`
- `ImageMeta.source`: `"nai" | "webui" | "midjourney" | "comfyui" | "unknown"`

## konomi:// Protocol
- URL format: `konomi://local/<encodeURIComponent(path.replace(/\\/g, "/"))>`
- Handler decodes path and streams file with `fs.createReadStream(...)` (not `net.fetch`)
- Uses `createReadStream` for special character / Korean filename compatibility

## Path Comparison

Path identity is compared in several places with deliberately different rules:
each fold answers a different question, so the split is intended and unifying
it would be wrong rather than tidier. A new comparison site should use the fold
that matches its question.

- `@core/lib/path-key.normalizePathKey` — the backend answer to "is this the
  same file?". Trailing slash everywhere; separators and case on win32 only.
- `app/main/lib/path-guard` keeps its own `realpath`-based fold. Protocol reads are
  authorization, where a string fold is not enough (symlinks, 8.3 names).
- `folder-service.normalizeFolderPath` is `realpath`-based too, for the
  "already registered?" uniqueness check — a different question.
- `normalizeFsPath` (two identical copies: `server/services.ts`, used by the
  bootstrap reconciliation, and `server/lib/data-root-watcher.ts`) —
  `path.resolve` + case on win32. It answers "is this detected
  `KONOMI_DATA_ROOT` directory already a registered folder root?" during
  reconciliation, not file identity.
- Renderer folds (`subfolderKey`, `useDuplicateResolutionDialog`) deliberately
  **do not** fold case: the renderer cannot know the backend's filesystem, and
  on a self-hosted server it is a different machine. They do not need to —
  `getSubfolderPaths` reports the on-disk spelling.
- `prisma-image-repo` subfolder prefix filters rely on SQLite/MariaDB's
  case-insensitive default collation. A known limitation; it needs revisiting
  only if the collation or the DB engine changes.

Considered and not adopted:
- A branded `PathKey` type to force `normalizePathKey` at every comparison.
  Correct in principle, but the churn is larger than the defect rate.
- Unifying `web/lib/folder-tree.ts` and `web/components/available-folders-dialog.tsx`,
  which still lower-case unconditionally. A real inconsistency, but changing it
  alters folder-tree nesting behaviour, so it needs a change of its own rather
  than riding along with an unrelated one.

## CSS url() Quoting — Critical
- Always use: `` backgroundImage: `url('${src}')` `` (with single quotes inside)
- Chromium decodes `%29` → `)` in unquoted `url()`, terminating parsing early

## DB Migration
- Run `bun run db:migrate` after schema changes (app must be closed — SQLite locks on open)
- `db.ts` uses `process.env.KONOMI_USER_DATA` for prod path; never import `electron.app` inside utility process
- Custom migration runner: reads `.sql` files from `KONOMI_MIGRATIONS_PATH/*/migration.sql`, tracks in `_prisma_migrations` table
- Electron boot order: main creates the window at once → renderer bootstrap sends `db:runMigrations` (its first utility request) → utility runs `runMigrations` with a progress callback **before** `dbReady()` and pushes `db:migrationProgress` while the (synchronous) migrations run → on success main starts the path-guard warm-up and the renderer loads folders
- The utility touches the DB only inside requests. Every request except `system:shutdown` awaits `dbReady()`, which applies pending migrations itself (without progress) if `db:runMigrations` has not run — the path after a utility crash/restart, where the renderer does not re-run its bootstrap. The first request through `dbReady()` starts the boot tasks (`seedBuiltins`, ignored-duplicate preload) exactly once
- Do not add module-load or main-process work that reaches the DB before `db:runMigrations` (e.g. a `folder:list`): it would apply migrations without progress, and a failing migration at module load crash-loops the utility
- Migration failure: `db:runMigrations` replies with the error and the process stays up; nothing else starts (no warm-up, no boot tasks), the splash shows the error. A failed run leaves `migrationsDone` false, so the next `db:runMigrations` retries. In dev a renderer reload (Ctrl+R) sends one; packaged builds block Ctrl+R / Ctrl+Shift+R (`optimizer.watchWindowShortcuts` when `app.isPackaged`), so there the recovery is restarting the app (Electron's default menu, hidden by `autoHideMenuBar`, still has View > Reload behind Alt — not blocked, not surfaced to users)
- `db:runMigrations` is sent with an explicit `0` bridge timeout: the utility acks, then runs the (synchronous) migrations, so a finite `KONOMI_BRIDGE_TIMEOUT_MS` would fail the request while the migration still runs and succeeds
- Electron can deliver the `db:runMigrations` reply before the progress it pushed; the bootstrap treats the reply as authoritative and ignores progress that arrives after it

## DB Schema (prisma/schema/sqlite.prisma; the server's mariadb.prisma has the same models)
- **Folder** — id, name, path (unique), createdAt, lastScanFileCount / lastScanFinishedAt (written after an uncancelled whole-folder scan; the count is the next scan's progress denominator, `FolderEntity.lastScanFileCount`)
- **Image** — id, path (unique), folderId, prompt, negativePrompt, characterPrompts (JSON), model, seed (string), width, height, sampler, steps, cfgScale, cfgRescale, noiseSchedule, varietyPlus, source, isFavorite, pHash, promptTokens / negativePromptTokens / characterPromptTokens (JSON), fileSize, fileModifiedAt, createdAt
- **Category** — id, name, isBuiltin, order, color (nullable)
- **ImageCategory** — composite key (imageId, categoryId); junction table
- **PromptCategory** — id, name, isBuiltin, order (top-level prompt builder category)
- **PromptGroup** — id, name, order, categoryId
- **PromptToken** — id, label, order, groupId
- **NaiConfig** — id (always 1), apiKey only
- **IgnoredDuplicatePath** — path (id), createdAt; read/written with raw SQL in `src/core/lib/image-infra.ts`
- **ImageSearchStat** — composite key (kind, key), width, height, model (all nullable), count, updatedAt; search-stat aggregates behind tag suggestions and search presets
- **ImageSimilarityCache** — composite key (imageAId, imageBId), phashDistance (nullable), textScore, updatedAt
- **ImageSimilarityCacheMeta** — id, primedAt (nullable)

## Scan Cancel
- `CancelToken = { cancelled: boolean }` (`scanner.ts`); the scan's `scanCancelToken` is module-level in `utility.ts`
- `image:cancelScan` IPC sets `scanCancelToken.cancelled = true`
- `withConcurrency` checks `signal?.cancelled` between tasks
- `scanService.scanAll()` fires folder start/end push events `image:scanFolder { folderId, folderName?, active }`
- Folder delete button disabled while `scanning` prop is true (sidebar.tsx)

## Duplicate Detection
- `image:scan` accepts `{ detectDuplicates?: boolean }` option
- `scanService.scanAll()` accepts optional `onDuplicateGroup` callback in options
- Three-phase detection: collect incoming images (PNG/WebP) → size bucketing → SHA1 hashing
- Detects cross-DB duplicates and incoming-only duplicates
- Returns `FolderDuplicateGroup[]` with preview path, existing/incoming entries
- `window.folder.findDuplicates(path)`, `window.folder.resolveDuplicates(resolutions)`
- Ignored duplicates: `window.image.listIgnoredDuplicates()`, `window.image.clearIgnoredDuplicates()`
- Only emitted during scan (no real-time watcher) — see Explicit Refresh section

## Perceptual Hashing / Similar Images
- `phash.ts` + `phash.worker.ts` — compute pHash (visual) + Jaccard similarity (prompt token overlap)
- `window.image.computeHashes()`, `window.image.resetHashes()`, `window.image.similarGroups(threshold, jaccardThreshold?)`
- `window.image.similarReasons(imageId, candidateIds, threshold, jaccardThreshold?)` — returns reason per pair (`"visual" | "prompt" | "both"`)
- Events: `window.image.onHashProgress(cb)` → `image:hashProgress`
- `isAnalyzing` state in `useImageAnalysis` (from `image:analysisActive`); disables "폴더 추가" button in sidebar while running
- Analysis is scheduled by the core `maintenance-service` (utility process / server): 3s (debounced) after each `image:batch` a scan emits (scan-service's sender is wrapped in `maintenanceAwareSender`) and after NAI `registerExternalPath`; at once (`scheduleAnalysis(0)`) after an uncancelled scan (Electron `image:scan`; server `/api/images/scan` and the startup scan; a `data-root-watcher` scan schedules with the 3s default instead), a duplicate resolution, a hash reset and a metadata rescan. In-app deletes push `image:removed` on the plain sender and schedule nothing. If a scan is active when the timer fires, it re-checks every 1s
- **Jaccard similarity**: token overlap coefficient between prompt/negative/character tokens; configurable threshold
- Similarity cache: `ImageSimilarityCache` + `ImageSimilarityCacheMeta` tables (prevents recomputation)
- Constants: `STRICT_COMMON_TOKEN_RATIO` 0.15, `LOOSE_COMMON_TOKEN_RATIO` 0.25, `HYBRID_TEXT_WEIGHT` 0.28 / `HYBRID_PHASH_WEIGHT` 0.72

## Prompt Tokens
- `src/core/services/prompt-builder-service.ts` (over `src/core/lib/repositories/prisma-prompt-repo.ts`) — prompt category/group/token CRUD + reorder; `src/core/lib/token.ts` (`parsePromptTokens`) is the prompt parser
- `window.promptBuilder` API: group CRUD + `createToken`, `deleteToken`, `reorderTokens`
- Parsed tokens stored as JSON in `Image.promptTokens`, `negativePromptTokens`, `characterPromptTokens`

## Settings (useSettings.ts)
- Stored in localStorage key `"konomi-settings"`
- `DEFAULTS` is exported — import it when you need default values
- `resetSettings(keys?)` — resets specific keys or all to DEFAULTS
- Fields: `recentDays` (7), `pageSize` (20), `similarityThreshold` (12), `similarPageSize` (10), `theme` ('dark'), `language` ('system'), `useAdvancedSimilarityThresholds` (false), `visualSimilarityThreshold` (12), `promptSimilarityThreshold` (0.6), `galleryColumns` ('auto'), `thumbnailQuality` ('normal'), `enableVirtualization` (false)

## Persisted UI State (localStorage)
- `"konomi-settings"` — useSettings managed
- `"konomi-selected-folders"` — Set of visible folder IDs
- `"konomi-sidebar-width"` — gallery sidebar width (saved in mouseup + beforeunload)
- `"konomi-gen-panel-width"` — generation view left panel width (saved in mouseup + beforeunload)
- `"konomi-nai-gen-settings"` — outputFolder, model, width, height, steps, scale, cfgRescale, varietyPlus, sampler, noiseSchedule
- `"konomi-import-checks"` — generation view import checkbox states
- `"konomi-last-gen-params"` — last submitted generation params (seedInput, etc.); restored on mount
- `"konomi-auto-gen-policy-agreed"` — user acknowledged auto-generation warning
- `"konomi-custom-sizes"` — custom generation size presets
- `"konomi-folder-order"` — folder drag order (array of folder IDs)
- `"konomi-category-order"` — category drag order (array of category IDs)
- `"konomi-right-panel-width"` — generation view right panel width
- `"konomi-tour-completed"` — feature tour completion state
- `"konomi-initial-language-selection-completed"` — first-run language screen completion state
- `"konomi-log-level"` — renderer log level
- `"konomi-info-panel-collapsed"` — image detail info panel section collapsed states
- `"konomi-folder-collapse-state"` — collapsed folder IDs in the sidebar folder tree (array)
- `"konomi-subfolder-visibility"` — per-folder hidden subfolder paths (`{ [folderId]: string[] }`)
- `"konomi-subfolder-visibility-case-repaired"` — folder IDs whose stored subfolder overrides have been through the one-shot case repair onto the on-disk spellings
- `"konomi-keybindings"` — customized keyboard shortcuts (removed on "reset all")
- `"konomi-announcement-<id>"` — `"true"` once that announcement is acknowledged
- Window bounds: `window-bounds.json` in userData (main process, saved on `close` event)

## Category Feature
- `Category` model + `ImageCategory` junction table (many-to-many with Image)
- `src/core/services/category-service.ts` — `createCategoryService`: full CRUD + `seedBuiltins`, `addImagesByPrompt`
- Builtins: "즐겨찾기" (isFavorite filter), "랜덤 픽" (`ORDER BY RANDOM()` / `RAND()` → one page of pageSize)
- "랜덤 픽" re-roll: `randomSeed` state in `useBrowseScope` (bumped by `handleRandomRefresh`) is part of the gallery query, so a new seed re-fetches
- `window.category` API: list, create, delete, rename, addImage, removeImage, addImages, removeImages, addByPrompt, imageIds, forImage, commonForImages, setColor

## Generation Mode
- `activePanel: "gallery" | "generator" | "settings" | "tagSearch" | "debug"` (`ActivePanel` in `useAppShellState.ts`)
- `src/web/components/generation-view.tsx` — resizable params panel + result, with an optional resizable right side panel (settings / prompt groups / reference)
- `src/core/services/nai-gen-service.ts` — `createNaiGenService`: NAI API via `novelai-sdk-unofficial` (`generateStream`; intermediate previews go to `onPreview`, which the caller pushes as `nai:generatePreview`) → final PNG saved to outputFolder
- Supports: i2i (image-to-image), vibe transfer (controlnet), precise references, character prompts
- DB: `NaiConfig` model — **only `id` + `apiKey`** (all other params in localStorage)
- `useNaiGenSettings` hook manages `outputFolder` in localStorage `"konomi-nai-gen-settings"`; `generation-view.tsx` persists the generation params into the same key

## NAI V4 Generation Fidelity
- `v4_prompt` structure: `{ caption: { base_caption, char_captions }, use_coords, use_order: true, legacy_uc: false }`
- `v4_negative_prompt`: same structure with `use_order: false, legacy_uc: false`
- Global mode: `use_coords: false`, centers `{ x: 0.5, y: 0.5 }` for all characters
- Positioned mode: `use_coords: true`, centers from the `colMap` / `rowMap` grid (A1–E5) in `nai-gen-service.ts`
- `colMap` columns A→E = `[0.1, 0.3, 0.5, 0.7, 0.9]`, `rowMap` rows 1→5 = same
- `useCoords` = true only when at least one `characterPositions[i]` is a valid grid key (not `"global"`)
- `characterPositions` parsed from `v4_prompt.use_coords` + `char_captions[i].centers[0]` in `nai.ts`
- Reverse map: `colRevMap` + `rowRevMap` in `nai.ts`; `centerToPosition()` converts `{x,y}` → grid key
- `"생성 모드로 보내기"` imports `characterPositions` alongside character prompts

## Generation UX
- **Duplicate generation block**: `lastParamsKeyRef` stores JSON of last submitted params; if same params re-submitted without `force`, shows `dupAlert` modal with "취소" / "그래도 생성" buttons; the key holds the prompts as sent (wildcards picked, groups expanded)
- **Recent image drag import**: `RecentThumb` is draggable via `text/x-konomi-path` dataTransfer; drop zone in generation-view handles `"path"` kind `DropItem` → reads metadata via `window.image.readNaiMeta`
- `DropItem` type has three variants: `"file"`, `"image"`, `"path"`
- **Seed control**: `seedMode: "random" | "fixed"` + `seedInput` state; seed button on result image shows copy/import dropdown
- **Auto-generation mode**: `autoGenCount` (n shots), `autoGenDelay` (seconds between), `autoGenSeedMode`, `autoGenInfinite` (∞ loop); requires policy agreement (`autoGenPolicyAgreed`) before first run; `autoGenProgress` tracks `{ current, total | null }`
- **Dimension swap button**: swaps width/height values in generation size inputs

## Explicit Refresh (no real-time watcher)
- No real-time `fs.watch` based watcher for image files — OS-level event reliability cannot be
  guaranteed on NAS / SMB / slow IO. (The server's `data-root-watcher` only watches
  `KONOMI_DATA_ROOT` for added/removed volume directories.)
- **External file changes**: surfaced only when the user clicks the
  sidebar `RefreshCw` button (sidebar folders section header → `onRescanAll`
  prop → `runScan({ refreshPage: true })`). Disabled while
  `scanning || checkingDuplicates || isAnalyzing`.
- **Per-folder / per-subfolder rescan**: each folder and subfolder row exposes
  a hover `RefreshCw` button plus a right-click context-menu entry
  (`sidebar.folders.rescan` / `sidebar.folders.rescanSubfolder`). Subfolder
  rescan passes `subPaths: [path]` to `image:scan`; `scanService.scanAll`
  expands the resolved folders into `ScanTarget[]` (one directory subtree
  each) and a `partial` target only walks/prunes rows under its own root and
  skips the folder scan fingerprint (`Folder.lastScanFileCount`: it neither
  writes it nor uses it as its progress denominator — it counts its subtree).
  Requested `subPaths` are deduplicated by
  `normalizePathKey` first, and subtrees nested inside another requested subtree
  are dropped, so nothing is walked twice.
  `folder-service.getSubfolderPaths` reports the on-disk spelling (it folds case
  only to *group* rows, never to build the result) — every consumer either walks
  the path, prefix-matches `Image.path` with it, or compares it to a scan event,
  and none of those work on a spelling the library invented.
  `duplicateService.findDuplicates` drops already-indexed files from its
  "incoming" set via `normalizePathKey`; without that a rescan reports each
  indexed file as its own duplicate, and resolving that group unlinks the real
  file (`resolve` deletes every incoming path when `keep: "existing"`).
  A subtree that no longer exists on disk becomes a `missing` target: nothing is
  walked, but the target still runs so its stale rows get pruned. A subtree that
  merely failed to read (permissions, transient IO) is skipped instead, so a bad
  readdir never wipes rows.
- `image:scanFolder` carries an optional `subPath` for subtree-scoped scans;
  the renderer keys subfolder spinners on `subfolderKey(path)`.
- `image:scanSkipped { subPaths, reason }` reports requested subtrees the scan
  did not cover. `reason: "unreadable"` covers both those rejected up front and
  those that became unreadable between target resolution and the sync loop;
  pushed rather than returned because a cancelled scan and every web client
  never read the return value. `reason: "busy"` is the server's single-flight
  rejection (`busySubPaths` in the `/api/images/scan` response), which
  `browser-api` replays onto the same listeners — the subtree is readable, it
  just lost the scan lock, and the two render as different messages.
  `reason: "outside"` is a subtree under no folder the scan resolved (its folder
  is removed while the request is in flight, or `folderIds` leaves it out).
  The web sender broadcasts, so `useScanning` drops any subPath this session did
  not itself request.
- **In-app generated files**: NAI generation calls
  `imageService.registerExternalPath(outPath)` directly after writing the
  file. That resolves the folder root, runs `readMeta` + upsert + search-stat
  mutation and returns the row; the caller (`utility.ts` / server `routes/nai.ts`)
  emits `image:batch` (the full row, `isNew: true`) so the
  gallery's new-images banner picks it up without a rescan — watcher-free.
- **Boot sync**: one full `scan` on startup is the guaranteed
  synchronization channel. There is no separate verification pass before it:
  `syncFolder` already stops at stat + mtime for
  unchanged files. Nor is there a counting walk for folders whose last
  whole-folder scan completed with a non-zero count: their stored count is the
  progress denominator, so the boot scan walks each folder once.
- **Duplicate detection**: only fires via `scan({ detectDuplicates: true })`
  (`image:watchDuplicate` event channel). No real-time duplicate
  detection.

## Header
- Status text is `absolute left-full ml-3` within a `relative` parent div
- Prevents flex layout shifts; `tabular-nums` for stable number widths
- Cancel X button is shown with the status text whenever it is active (scan, duplicate check, analysis, metadata rescan, similarity or search-stat progress); it calls `onCancelScan`, and `image:cancelScan` stops every library task
- Scan progress below the total: `scanImages` / `scanFolders` (`done/total`), progress bar, ETA. Once `done >= total` (a folder that outgrew its stored count keeps `done === total`) the header shows the processed count instead — `scanImagesCount` / `scanFoldersCount` in the wide layout, the bare number in the compact one — with no denominator, bar or ETA. It takes the phase label's slot, so rescan / hash / similarity / search-stat progress still win. Cleared by the next event below the total, when `scanning` turns false, and on utility reset

## Image Detail (image-detail.tsx)
- CSS `hidden` class to hide (not unmount) when closed — prevents DOM recreation on reopen; `animate-in fade-in-0 duration-150` on open
- `displaySrc` initially null; set after double `requestAnimationFrame` to ensure panel paints first
- InfoPanel uses `useDeferredValue(image)` to defer heavy token rendering; shows spinner while pending (never stale data)
- Similar images panel: anchor image pinned at top, others sorted by hybrid score; paginated by `similarPageSize`; page resets on image change
- Each similar thumbnail tooltip shows similarity percentage and reason (visual/prompt/both)

## Server-side Pagination
- `window.image.listPage(query: ImageListQuery)` → `ImageListResult { rows, totalCount, page, pageSize, totalPages }`
- All filtering/sorting done in DB: search, sort, folder, category, recentDays, resolution/model/seed/excludeTag filters
- `randomSeed` is sent with the query (a new seed re-fetches "랜덤 픽"); the repo does not seed with it — the random pick is `ORDER BY RANDOM()` / `RAND()` in SQL
- `useGalleryImages` holds the page (`galleryPage`) and resets it to 1 whenever the list query changes
- `ImageGallery`'s toolbar shows "초기화" button (clear search) when `searchQuery` is truthy; it calls `onSearchChange("")`

## Search Autocomplete
- `window.image.suggestTags({ prefix, limit?, exclude? })` → `{ tag, count }[]` — backed by `ImageSearchStat` (not live full-table scan)
- `window.promptBuilder.suggestTags(...)` → suggestions from bundled `prompts.db` prompt corpus (separate from image search stats)
- Backend aggregates tokens from all `promptTokens`, `negativePromptTokens`, `characterPromptTokens` fields
- Frontend in `gallery-search-section.tsx`: parses active token at cursor, debounce 140ms, request deduplication via seq counter
- Separators: `,` `|` newline and full-width variants (U+FF0C, U+FF5C)
- Keyboard: Arrow keys select suggestion, Enter (on a selected suggestion) or Tab inserts; Escape dismisses
- `konomi:search-input-append-tag` custom event: context menu on token chips appends tag to search input
- **Exact match first**: SQL `CASE WHEN normalizedKey = ? THEN 0 ELSE 1 END` ranks exact match at top; frontend does NOT filter out exact matches (don't add `item.tag !== activeToken` filters)
- **Space/underscore equivalence**: prefix normalized with `.replace(/_/g, " ")`; `normalizedKeySql` includes `REPLACE(key, '_', ' ')`; `normalizeSearchGroups` generates both space and underscore variants as OR alternatives per term
- Contains matching turns on for longer prefixes

## Token Components
- **TokenChip** — single token editor; popover positioned with fixed layout + viewport edge clamping
  - Weight range 0–3.0; expression types: numerical (`1.5::text::`) vs keyword (`{text}` / `[text]`)
  - Keyboard: Alt+Up/Down toggle expression; Ctrl+Up/Down step weight ±0.1; **Enter applies edit and focuses current chip** (does NOT advance); Escape cancel
  - `onInlineEditOpenChange` reason: `"cancel"` | `"stay"` — `"stay"` skips `focusInput("end")` in PromptInput
  - Context menu (readonly): "검색어에 태그 추가" / "생성모드에 태그 추가" via custom event
- **WildcardChip** (`wildcard-chip.tsx`) — wildcard token editor; `%{opt1|opt2}` syntax
  - `WildcardToken = { kind: "wildcard", options: string[] }` in `src/web/lib/token.ts`
  - Popover lists options as read-only rows (delete button each) plus an add-option input; the chip shows a static `Dices` icon and the options preview (`token.resolved` would replace it, but nothing sets it)
  - Sortable via dnd-kit. `resolveWildcardsInString` picks one random option per `%{...}` (split on `|` at brace depth 0, trimmed, empties dropped; the pick is resolved again; an unclosed `%{` stays literal)
  - `generation-view.tsx` `resolveGenerationPrompts` runs on every Generate click and auto-generate shot: the template's wildcards first, then `@{...}` expansion, where each group's own expansion gets a wildcard pass; the expanded text is never re-scanned, so a literal `%` before `{` stays literal. A character whose prompt resolves to blank is dropped with its negative and position (core `nai-gen-service` would drop it but index `characterPositions` by the kept ones). `konomi-last-gen-params` keeps the template
- **TokenContainer** — wraps chips with dnd-kit drag-and-drop reorder + multi-token clipboard copy
  - Copy clipboard: extracts `data-token-raw` from selection-intersecting chips, joins with `, `
- **PromptInput** — raw-first prompt editor with optional Block mode chip editing
  - Raw mode (default): textarea editing, `@{...}` group autocomplete, overlay highlighting for emphasis/groups/malformed syntax via `prompt-emphasis-syntax.ts`; `@{group-name:tag1|tag2}` inline overrides bypass stored group contents
  - Block mode (opt-in toggle): chip editing, drag reordering, prompt-group tokens, wildcards; between-chip cursor disabled behind feature flag
  - Drag-and-drop token import via `application/x-konomi-token` payload
  - Paste support: parses pasted prompts as tokens; Backspace at empty removes last token
  - **Undo**: `undoStackRef` (50 entries); `emit()` pushes on token change; Ctrl+Z in draft input: clears draft if non-empty, otherwise pops stack
  - **emit() onChange contract**: `onChange` is called immediately whenever the serialized prompt (tokens + trimmed draft) changes, draft typing included. `pendingControlledValueRef` holds the value just emitted so the sync effect does not misinterpret the parent's echo as an external change
  - **Sync effect guard**: the `[isRawMode, value, serialized]` effects skip the reset when `value === serialized` or `value === pendingControlledValueRef.current`
  - **GenerationView**: `promptGroups` memoized with `useMemo` — pass to `groups` prop instead of inline `categories.flatMap(...)`

## Advanced Search Filters
- `AdvancedFilter` type: `{ type: "resolution"; width; height }` | `{ type: "model"; value }` | `{ type: "seed"; value }` | `{ type: "excludeTag"; value }`
- `window.image.getSearchPresetStats()` → `{ availableResolutions, availableModels }` (aggregated from DB)
- `advanced-search-modal.tsx`: resolution buttons + manual input; model autocomplete with keyboard navigation; seed number input; exclude tag input
- Active filters highlighted blue; passed to `ImageListQuery` as `resolutionFilters`, `modelFilters`, `seedFilters`, and `excludeTags`

## App Info Dialog
- `window.appInfo.get()` → `AppInfo { appName, appVersion, electronVersion, chromeVersion, nodeVersion, platform, arch }`
- `window.appInfo.getDbFileSize()` → `Promise<number | null>` — returns konomi.db file size in bytes
- `window.appInfo.getLocale()` → system UI language string (used to resolve `system` i18n language)
- `window.appInfo.getPromptsDbSchemaVersion()` → prompt-tag DB schema version (displayed in settings)
- Triggered via info button in header; shows versions, links, open source licenses dialog; feature-tour relaunch entry point

## i18n
- i18next initialized and resources registered in `src/web/lib/i18n.ts`, imported by both entries (`src/app/renderer/src/main.tsx`, `src/web/main.tsx`)
- `system` language resolved through `window.appInfo.getLocale()`, `<html lang>` kept in sync
- Stored language/theme preferences applied before `App` mounts (in `bootstrap-app.tsx`)
- First-run: `InitialLanguageScreen` shown before `FeatureTour`

## Preload API Notable Details
- `window.image.scan(...)` accepts `{ detectDuplicates?, folderIds?, orderedFolderIds?, subPaths? }` — `orderedFolderIds` honors renderer drag order
- `window.image.listMatchingIds(...)` — returns the ids of the full filtered match set for bulk-selection workflows (not page-limited)
- `window.image.listByIds(...)` — rehydrates arbitrary image sets (e.g. similarity drawers)
- `window.image.readMetaFromBuffer(...)` — metadata import from dropped file buffers without saving first
- `window.nai.onGeneratePreview(...)` — streams intermediate preview data URLs during generation
- `window.nai.validateApiKey(...)` — checks API key against NovelAI subscription endpoint before saving
- `window.promptBuilder.suggestTags(...)` — suggestions + bucketed usage stats from bundled prompt corpus

## Push Events (active)
- `image:batch` — rows written by a scan, a metadata rescan or NAI `registerExternalPath`. Typed `ImageBatchRow[]` (`{ id, path, folderId, isNew? }`, `src/web/api/data-types.ts`). A scan (`scan-service` `flushBatch`) sends exactly `{ id, path, folderId, isNew }` — `upsertBatch` returns only `{ id, path, folderId }`; the rescan (`isNew: false`) and NAI (`isNew: true`) emitters send whole rows, which still fit. `KonomiEventMap` / `ImageBatchEvent` in `event-sender.ts` do not describe it (re-exported from the `src/core/index.ts` barrel, but nothing uses them to type `image:batch`)
- `image:removed` — ids of rows removed by an in-app delete or a duplicate resolution (a scan's stale-row prune does not emit it)
- `image:scanProgress` — overall scan progress `{ done, total }`, one running count per `scanAll`. `total` is composed before the sync, per target: a whole-folder target takes `Folder.lastScanFileCount` (written only after an uncancelled whole-folder walk — `syncFolder` Phase 4); a partial target, or a folder whose stored count is null or 0, is walked once to count (`countImageFiles`); `detectDuplicates` reuses its pre-scan count. The stored count can be stale, so during the sync `total = max(total, done)`, a root skipped as unreadable gives back its share, and on success the last event has `done === total` (`scanAll` and `scanOne`). It never passes 100% or goes back. While `done >= total` `header.tsx` drops the denominator, bar and ETA and shows the processed count (see Header), so a folder that outgrew its stored count still shows a number for the remainder
- `image:scanFolder` — per-folder scan activity (`{ folderId, folderName?, subPath?, active }`)
- `image:scanSkipped` — requested subtrees the scan did not cover (`{ subPaths, reason: "unreadable" | "busy" | "outside" }`)
- `image:hashProgress` — pHash computation progress
- `image:similarityProgress` — similarity analysis progress
- `image:searchStatsProgress` — search stat rebuild progress
- `image:watchDuplicate` — duplicate detected by `scan({ detectDuplicates: true })` (emitted only during that scan; despite the name, nothing watches the filesystem)
- `nai:generatePreview` — intermediate generation preview data URL
- `image:scanSettled` — Electron only. Sent by **main** (`ipc.ts`, not the utility) to the requesting webContents after `image:scan` returns, payload = the preload's `requestId`. Consumed inside preload `scan()` only; not exposed on `window.image` and unrelated to the server's `image:scanComplete` / `image:scanActive`
- `image:analysisActive` — `{ active, cancelled }` when a `maintenance-service` run starts/ends (utility and server; the server's WebSocket hello frame also sends `{ active }`)
- `image:scanPhase` — `{ phase: "loadingLibrary" | "scanningFiles" | "checkingDuplicates" | "syncing" }` from `scanAll`'s `onPhase` (utility and server `image:scan` handlers)
- `image:dupCheckProgress` — `{ done, total }` duplicate pre-scan hashing progress (utility and server)
- `image:rescanMetadataProgress` — `{ done, total }` metadata rescan progress, `{ done: 0, total: 0 }` when it ends (utility and server)
- `db:migrationProgress` — `{ done, total, migrationName }` — Electron utility only, during `db:runMigrations`
- `utility:reset` — no payload — Electron main (`bridge.ts`) when the utility process exits
- `app:updateAvailable` (`{ version, releaseUrl? }`), `app:updateProgress` (`{ percent, bytesPerSecond }`), `app:updateDownloaded` (`{ version }`) — Electron main (`lib/updater.ts`)
- `image:scanActive` — `{ active }` — server only, from `setScanActive` (every scan path) and the hello frame; `{ active: false }` is the signal `browser-api` resolves a scan on
- `image:scanComplete` — `{ cancelled, error? }` — server only, after a `/api/images/scan` scan or a `data-root-watcher` scan
- `image:rescanMetadataComplete` — `{ count }` — server only, when the fire-and-forget metadata rescan ends
- `folder:listChanged` — `{ added, removed }` — server only, from `data-root-watcher` after it registers/removes folders

## Patterns
- `image:batch` consumer: `useImageEventSubscriptions` (`useImageWatchBootstrap.ts`) reads only `id`, `folderId`, `isNew`. It drops batches while `scanningRef` / `rescanningRef` is set (the scan's own completion refreshes the page); otherwise it passes `isNew === true` ids in visible folders to `addPendingNewIds` (the "새 이미지" banner), schedules a search-stat refresh (180 ms) and a 1 s debounced subfolder refresh. Rows are never merged into gallery state
- `selectedImage` sync: `useImageActions` derives it with `useMemo([images, selectedImageSnapshot])` from the current page's row, keeping the detail view current
- **localStorage persistence for draggable widths**: save in `mouseup` handler (synchronous) + `beforeunload` fallback; do NOT rely on `useEffect` (fires async after paint, may miss app close)
- **Window bounds**: always hook `mainWindow.on("close")` to flush debounced save immediately
- CSP: `src/app/renderer/index.html` img-src must include `konomi:`
- Deferred image src: double RAF pattern ensures panel paints before image fetch starts
- `electron.app` is undefined in utility process — use `process.env.KONOMI_USER_DATA` and `process.env.NODE_ENV` instead

## Web Server (`src/server`)

### Overview
- Fastify + WebSocket server for self-hosted deployments (NAS, home server)
- Reuses `@konomi/core` services directly — same business logic as Electron utility process
- DB: MariaDB/MySQL via `@prisma/adapter-mariadb` (not SQLite)
- Push events delivered via WebSocket (`{ event, data }` JSON frames) instead of Electron IPC
- Serves the web SPA from `src/web/dist` with an `index.html` fallback (`src/server/index.ts`). `bun run build:web` writes `out/web`; the Docker image copies it to `src/web/dist`. Outside Docker, use `bun run dev:web` (Vite on port 5174, proxying `/api` and `/ws` to port 3000) or copy `out/web` to `src/web/dist`

### Key Files
- `src/server/index.ts` — server entry, Fastify setup, WebSocket hub, route registration
- `src/server/db.ts` — MariaDB PrismaClient singleton (`DATABASE_URL` env var, default `mysql://root:mariadb@127.0.0.1:3306/konomi`)
- `src/server/sender.ts` — `createWebSocketSender`: broadcasts push events to all connected WebSocket clients
- `src/server/services.ts` — wires core services with Prisma repos + adapters; `bootstrap()` seeds builtins, loads ignored duplicate paths and reconciles folders with the directories under `KONOMI_DATA_ROOT` (removes vanished ones, auto-registers new ones); `runInitialScan()` runs the startup scan
- `src/server/lib/data-root.ts` — `KONOMI_DATA_ROOT` scanning + path validation
- `src/server/lib/data-root-watcher.ts` — watches `KONOMI_DATA_ROOT` itself (`fs.watch` + 60s poll) for added/removed volume directories, reruns that reconciliation and scans newly registered folders; it does not watch image files

### Routes
- `src/server/routes/folder.ts` — folder CRUD, available directories, duplicate detection/resolution
- `src/server/routes/image.ts` — image listing/pagination, scan, favorites, delete, hashing/similarity, metadata rescan
- `src/server/routes/image-file.ts` — image file serving + metadata reading (replaces `konomi://` protocol)
- `src/server/routes/category.ts` — category CRUD, image-category association
- `src/server/routes/prompt.ts` — prompt builder category/group/token CRUD, tag suggestions
- `src/server/routes/nai.ts` — NAI API key validation, config, image generation

### Docker Volume–Based Folder Management
- `KONOMI_DATA_ROOT` (default `/images`) — the single directory where image folders must live
- Docker users mount volumes into this path: `-v /mnt/nas/photos:/images/photos`
- `GET /api/folders/available` — lists 1-depth subdirectories under `KONOMI_DATA_ROOT` (hidden dirs excluded)
- `POST /api/folders` — validates that the path is under `KONOMI_DATA_ROOT` before creating
- Web UI: sidebar "+" button opens `AvailableFoldersDialog`, a read-only list of the detected directories — registered ones with a checkmark, the rest pending until the next reconcile auto-registers them
- No filesystem browser or arbitrary path input needed — Docker isolation handles security

### Environment Variables
| Variable | Default | Description |
|---|---|---|
| `KONOMI_PORT` | `3000` | Server listen port |
| `KONOMI_HOST` | `0.0.0.0` | Server listen host |
| `DATABASE_URL` | `mysql://root:mariadb@127.0.0.1:3306/konomi` | MariaDB connection string |
| `KONOMI_USER_DATA` | `<repoRoot>/database` | Data directory (used by core modules) |
| `KONOMI_MIGRATIONS_PATH` | `<repoRoot>/prisma/migrations/mariadb` | SQL migration files directory |
| `KONOMI_PREBUILDS_PATH` | `<repoRoot>/prebuilds` | Native addon prebuilds directory (`konomi-image`, `webp-alpha`) |
| `KONOMI_LOG_LEVEL` | `debug` when `NODE_ENV=development`, else `info` | Minimum log level (`debug` / `info` / `warn` / `error`) for core's logger; also read by the Electron main and utility processes |
| `KONOMI_PROMPTS_DB_PATH` | `<KONOMI_USER_DATA>/prompts.db` | Prompt-tag suggestion DB. In Electron the utility process honors it too (it inherits the env); main's bundled-DB sync and schema-version read always use `<userData>/prompts.db` |
| `KONOMI_DATA_ROOT` | `/images` | Root directory for image folders (Docker volume mount point) |

### Web vs Electron Differences
| Concern | Electron (`src/app`) | Web (`src/server`) |
|---|---|---|
| DB | SQLite (better-sqlite3) | MariaDB/MySQL |
| Push events | IPC (`webContents.send`) | WebSocket broadcast |
| Image serving | `konomi://` protocol | `GET /api/files/image?path=` |
| Folder selection | `dialog.showOpenDialog()` | auto-registered from `KONOMI_DATA_ROOT` (`AvailableFoldersDialog` lists them) |
| Path security | DB folder roots + transient paths | `KONOMI_DATA_ROOT` + Docker volume isolation |
