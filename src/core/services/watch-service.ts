import fs from "fs";
import path from "path";
import { parsePromptTokens } from "../lib/token";
import { createLogger } from "../lib/logger";
import type {
  ImageUpsertData,
  SearchStatSource,
} from "../types/repository";
import type { ImageRepo } from "../lib/repositories/prisma-image-repo";
import type { FolderRepo } from "../lib/repositories/prisma-folder-repo";
import type { EventSender } from "../types/event-sender";
import type { ImageMeta } from "../types/image-meta";
import type { FolderDuplicateGroup } from "./duplicate-service";

const log = createLogger("watch-service");
const DEBOUNCE_MS = 500;
const QUERY_CHUNK = 2000;
const DELETE_BATCH = 400;

// ── Adapter interfaces ─────────────────────────────────────────

export interface WatchSearchStatsAdapter {
  applyMutation(
    before: SearchStatSource | null,
    after: SearchStatSource | null,
    onProgress?: (done: number, total: number) => void,
  ): Promise<void>;
  decrementForRows(
    rows: SearchStatSource[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<void>;
}

export interface WatchDuplicateDetectionAdapter {
  findDuplicateForIncomingPath(
    filePath: string,
  ): Promise<FolderDuplicateGroup | null>;
  isIgnored(filePath: string): Promise<boolean>;
  forgetIgnored(filePath: string): Promise<void>;
}

export interface WatchSimilarityCacheAdapter {
  deleteForImageIds(ids: number[]): Promise<void>;
  refreshForImageIds(ids: number[]): Promise<void>;
}

// ── Deps ───────────────────────────────────────────────────────

export type WatchServiceDeps = {
  imageRepo: ImageRepo;
  folderRepo: FolderRepo;
  sender: EventSender;
  readMeta: (filePath: string) => ImageMeta | null;
  searchStats?: WatchSearchStatsAdapter;
  duplicateDetection?: WatchDuplicateDetectionAdapter;
  similarityCache?: WatchSimilarityCacheAdapter;
};

// ── Helper ─────────────────────────────────────────────────────

function buildUpsertData(
  filePath: string,
  folderId: number,
  stat: fs.Stats,
  meta: ImageMeta | null,
): ImageUpsertData {
  return {
    path: filePath,
    folderId,
    prompt: meta?.prompt ?? "",
    negativePrompt: meta?.negativePrompt ?? "",
    characterPrompts: JSON.stringify(meta?.characterPrompts ?? []),
    promptTokens: JSON.stringify(parsePromptTokens(meta?.prompt ?? "")),
    negativePromptTokens: JSON.stringify(
      parsePromptTokens(meta?.negativePrompt ?? ""),
    ),
    characterPromptTokens: JSON.stringify(
      (meta?.characterPrompts ?? []).flatMap(parsePromptTokens),
    ),
    source: meta?.source ?? "unknown",
    model: meta?.model ?? "",
    seed: Number.isFinite(meta?.seed) ? meta!.seed : 0,
    width: meta?.width ?? 0,
    height: meta?.height ?? 0,
    sampler: meta?.sampler ?? "",
    steps: meta?.steps ?? 0,
    cfgScale: meta?.cfgScale ?? 0,
    cfgRescale: meta?.cfgRescale ?? 0,
    noiseSchedule: meta?.noiseSchedule ?? "",
    varietyPlus: meta?.varietyPlus ?? false,
    fileSize: stat.size,
    fileModifiedAt: stat.mtime,
  };
}

// ── Factory ────────────────────────────────────────────────────

export function createWatchService(deps: WatchServiceDeps) {
  const {
    imageRepo,
    folderRepo,
    sender,
    readMeta,
    searchStats,
    duplicateDetection,
    similarityCache,
  } = deps;

  const fsWatchers = new Map<number, fs.FSWatcher>();
  const debounceTimers = new Map<string, NodeJS.Timeout>();
  const folderReconcileTimers = new Map<number, NodeJS.Timeout>();
  const pendingDuplicatePaths = new Map<string, number>();

  let scanActive = false;
  const deferredChanges = new Map<string, number>();
  const deferredReconcileFolders = new Set<number>();

  function emitSearchStatsProgress(done: number, total: number): void {
    sender.send("image:searchStatsProgress", { done, total });
  }

  // ── Process single file change ──────────────────────────────

  async function processChange(
    folderId: number,
    filePath: string,
  ): Promise<void> {
    if (scanActive) {
      deferredChanges.set(filePath, folderId);
      return;
    }

    if (!fs.existsSync(filePath)) {
      pendingDuplicatePaths.delete(filePath);
      await duplicateDetection?.forgetIgnored(filePath);

      const existing = await imageRepo.findByPath(filePath);
      if (existing) {
        await imageRepo.deleteByPath(filePath);
        if (similarityCache) {
          await similarityCache.deleteForImageIds([existing.id]);
        }
        if (searchStats) {
          await searchStats.applyMutation(
            existing as SearchStatSource,
            null,
            emitSearchStatsProgress,
          );
        }
        sender.send("image:removed", [existing.id]);
      } else {
        await reconcileFolderMissingRows(folderId);
      }
      return;
    }

    // File added or modified
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      const stat = fs.statSync(filePath);
      const mtime = stat.mtime;

      if (duplicateDetection && (await duplicateDetection.isIgnored(filePath)))
        return;

      const existing = await imageRepo.findByPath(filePath);
      if (existing && existing.fileModifiedAt.getTime() === mtime.getTime())
        return;
      if (pendingDuplicatePaths.has(filePath)) return;

      if (!existing && duplicateDetection) {
        const duplicateGroup =
          await duplicateDetection.findDuplicateForIncomingPath(filePath);
        if (duplicateGroup) {
          pendingDuplicatePaths.set(filePath, folderId);
          sender.send("image:watchDuplicate", duplicateGroup);
          return;
        }
      }

      const meta = readMeta(filePath);
      const data = buildUpsertData(filePath, folderId, stat, meta);
      const image = await imageRepo.upsertByPath(data);

      if (searchStats) {
        await searchStats.applyMutation(
          existing as SearchStatSource | null,
          image as SearchStatSource,
          emitSearchStatsProgress,
        );
      }
      if (similarityCache) {
        await similarityCache.refreshForImageIds([image.id]);
      }

      sender.send("image:batch", [image]);
    } catch {
      // skip unreadable files
    }
  }

  // ── Folder reconciliation (detect missing files) ────────────

  async function reconcileFolderMissingRows(folderId: number): Promise<void> {
    if (scanActive) {
      deferredReconcileFolders.add(folderId);
      return;
    }

    try {
      const folder = await folderRepo.findById(folderId);
      if (!folder) return;

      // Skip if folder root is inaccessible (e.g. NAS offline)
      try {
        await fs.promises.access(folder.path);
      } catch {
        return;
      }

      const allRemovedIds: number[] = [];
      let lastId = 0;

      while (true) {
        const rows = await imageRepo.findByFolderIdCursor(
          folderId,
          lastId,
          QUERY_CHUNK,
        );
        if (rows.length === 0) break;
        lastId = rows[rows.length - 1].id;

        const missing = rows.filter((row) => !fs.existsSync(row.path));
        for (let i = 0; i < missing.length; i += DELETE_BATCH) {
          const batch = missing.slice(i, i + DELETE_BATCH);
          const batchIds = batch.map((row) => row.id);

          await imageRepo.deleteByIds(batchIds);

          if (similarityCache) {
            await similarityCache.deleteForImageIds(batchIds);
          }
          if (searchStats) {
            await searchStats.decrementForRows(batch, emitSearchStatsProgress);
          }

          for (const row of batch) allRemovedIds.push(row.id);
        }
      }

      if (allRemovedIds.length > 0) {
        sender.send("image:removed", allRemovedIds);
      }
    } catch {
      // ignore reconciliation failures
    }
  }

  // ── Scheduling ──────────────────────────────────────────────

  function scheduleProcess(folderId: number, filePath: string): void {
    if (scanActive) {
      deferredChanges.set(filePath, folderId);
      return;
    }
    clearTimeout(debounceTimers.get(filePath));
    debounceTimers.set(
      filePath,
      setTimeout(() => {
        debounceTimers.delete(filePath);
        void processChange(folderId, filePath);
      }, DEBOUNCE_MS),
    );
  }

  function scheduleFolderReconcile(folderId: number): void {
    if (scanActive) {
      deferredReconcileFolders.add(folderId);
      return;
    }
    clearTimeout(folderReconcileTimers.get(folderId));
    folderReconcileTimers.set(
      folderId,
      setTimeout(() => {
        folderReconcileTimers.delete(folderId);
        void reconcileFolderMissingRows(folderId);
      }, DEBOUNCE_MS),
    );
  }

  function flushDeferred(discardChanges: boolean): void {
    if (discardChanges) {
      deferredChanges.clear();
    } else {
      const changes = new Map(deferredChanges);
      deferredChanges.clear();
      for (const [filePath, folderId] of changes) {
        scheduleProcess(folderId, filePath);
      }
    }

    const reconcileFolders = new Set(deferredReconcileFolders);
    deferredReconcileFolders.clear();
    for (const folderId of reconcileFolders) {
      scheduleFolderReconcile(folderId);
    }
  }

  // ── Public API ──────────────────────────────────────────────

  return {
    watchFolder(folderId: number, folderPath: string): void {
      fsWatchers.get(folderId)?.close();
      try {
        const watcher = fs.watch(
          folderPath,
          { recursive: true },
          (_, filename) => {
            if (!filename) {
              scheduleFolderReconcile(folderId);
              return;
            }
            const fullPath = path.join(folderPath, filename);
            if (
              ![".png", ".webp"].includes(path.extname(fullPath).toLowerCase())
            )
              return;
            scheduleProcess(folderId, fullPath);
          },
        );
        watcher.on("error", () => {
          fsWatchers.get(folderId)?.close();
          fsWatchers.delete(folderId);
        });
        fsWatchers.set(folderId, watcher);
      } catch {
        log.warn(`failed to watch folder: ${folderPath}`);
      }
    },

    stopFolder(folderId: number): void {
      fsWatchers.get(folderId)?.close();
      fsWatchers.delete(folderId);
      clearTimeout(folderReconcileTimers.get(folderId));
      folderReconcileTimers.delete(folderId);
    },

    stopAll(): void {
      fsWatchers.forEach((w) => w.close());
      fsWatchers.clear();
      debounceTimers.forEach((t) => clearTimeout(t));
      debounceTimers.clear();
      folderReconcileTimers.forEach((t) => clearTimeout(t));
      folderReconcileTimers.clear();
      pendingDuplicatePaths.clear();
      scanActive = false;
      deferredChanges.clear();
      deferredReconcileFolders.clear();
    },

    setScanActive(
      active: boolean,
      options?: { discardDeferredChanges?: boolean },
    ): void {
      scanActive = active;
      if (!active) {
        flushDeferred(options?.discardDeferredChanges ?? false);
      }
    },

    applyResolvedDuplicates(data: {
      touchedIncomingPaths: string[];
      retainedIncomingPaths: string[];
    }): void {
      const retained = new Set(data.retainedIncomingPaths);
      for (const incomingPath of data.touchedIncomingPaths) {
        const folderId = pendingDuplicatePaths.get(incomingPath);
        pendingDuplicatePaths.delete(incomingPath);
        if (folderId !== undefined && retained.has(incomingPath)) {
          scheduleProcess(folderId, incomingPath);
        }
      }
    },

    async startAll(options?: { paused?: boolean }): Promise<void> {
      if (options?.paused) {
        scanActive = true;
      }
      const folders = await folderRepo.findAll();
      for (const folder of folders) {
        this.watchFolder(folder.id, folder.path);
      }
      log.info(`watching ${folders.length} folders`);
    },
  };
}

export type WatchService = ReturnType<typeof createWatchService>;
