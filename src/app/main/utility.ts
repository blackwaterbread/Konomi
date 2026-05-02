import {
  ensureIgnoredDuplicatePathsLoaded,
  isIgnoredDuplicatePath,
  fileHash,
  naiPool,
  listIgnoredDuplicatePaths,
  clearIgnoredDuplicatePaths,
  registerIgnoredDuplicatePaths,
  forgetIgnoredDuplicatePath,
} from "@core/lib/image-infra";
import {
  getImageSearchPresetStats,
  suggestImageSearchTags,
  listImageSearchStatSourcesForFolder,
  decrementImageSearchStatsForRows,
  applyImageSearchStatsMutations,
  applyImageSearchStatsMutation,
} from "@core/lib/search-stats-store";
import { createWatchService } from "@core/services/watch-service";
import { readImageMeta } from "@core/lib/image-meta";
import type { ImageEntity } from "@core/types/repository";
import type { ImageListQuery } from "@core/types/image-query";
import { createScanService } from "@core/services/scan-service";
import { createImageService } from "@core/services/image-service";
import { createDuplicateService } from "@core/services/duplicate-service";
import { createPromptBuilderService } from "@core/services/prompt-builder-service";
import { createPrismaPromptRepo } from "@core/lib/repositories/prisma-prompt-repo";
import {
  computeAllHashes,
  deleteSimilarityCacheForImageIds,
  refreshSimilarityCacheForImageIds,
  getGroupForImage,
  getSimilarGroups,
  getSimilarityReasons,
  resetAllHashes,
  pHashPool,
} from "@core/lib/phash";
import { createNaiGenService } from "@core/services/nai-gen-service";
import type {
  NaiConfigPatch,
  GenerateParams,
} from "@core/services/nai-gen-service";
import { createPrismaNaiConfigRepo } from "@core/lib/repositories/prisma-nai-config-repo";
import type { CancelToken } from "@core/lib/scanner";
import { createLogger } from "@core/lib/logger";
import { createFolderService } from "@core/services/folder-service";
import { createCategoryService } from "@core/services/category-service";
import { createMaintenanceService } from "@core/services/maintenance-service";
import { createPrismaFolderRepo } from "@core/lib/repositories/prisma-folder-repo";
import { createPrismaCategoryRepo } from "@core/lib/repositories/prisma-category-repo";
import { createPrismaImageRepo } from "@core/lib/repositories/prisma-image-repo";
import { createPromptTagService } from "@core/services/prompt-tag-service";
import { getPromptsDBPath } from "@core/lib/prompts-db";
import { getDB, runMigrations, disconnectDB } from "@core/lib/db";
import Database from "better-sqlite3";

let scanCancelToken: CancelToken | null = null;
const log = createLogger("main/utility");

// ── Repository & Service initialization ─────────────────────
const folderRepo = createPrismaFolderRepo(getDB);
const categoryRepo = createPrismaCategoryRepo(getDB);
const imageRepo = createPrismaImageRepo(getDB);

const promptRepo = createPrismaPromptRepo(getDB);

const naiConfigRepo = createPrismaNaiConfigRepo(getDB);

const folderService = createFolderService({
  folderRepo,
  imageRepo,
  similarityCache: {
    deleteForImageIds: deleteSimilarityCacheForImageIds,
  },
  searchStats: {
    listSourcesForFolder: listImageSearchStatSourcesForFolder,
    decrementForRows: decrementImageSearchStatsForRows,
  },
});
const categoryService = createCategoryService({ categoryRepo, imageRepo });
const promptBuilderService = createPromptBuilderService({ promptRepo });
const naiGenService = createNaiGenService({ naiConfigRepo });
const searchStatsAdapter = {
  applyMutations: applyImageSearchStatsMutations,
};
const ignoredDuplicatesAdapter = {
  ensureLoaded: ensureIgnoredDuplicatePathsLoaded,
  isIgnored: isIgnoredDuplicatePath,
  register: registerIgnoredDuplicatePaths,
  forget: forgetIgnoredDuplicatePath,
  list: listIgnoredDuplicatePaths,
  clear: clearIgnoredDuplicatePaths,
};
const similarityCacheAdapter = {
  deleteForImageIds: deleteSimilarityCacheForImageIds,
};

const promptTagService = createPromptTagService({
  getDbPath: getPromptsDBPath,
  openDatabase: (path, options) => new Database(path, options),
});

// Abstract EventSender wrapping parentPort push messages
const utilitySender = {
  send(channel: string, data: unknown): void {
    process.parentPort.postMessage({ event: channel, payload: data });
  },
};

let scanInFlight = false;

const maintenanceService = createMaintenanceService({
  computeAllHashes,
  sender: utilitySender,
  isScanActive: () => scanInFlight,
});

// Maintenance auto-trigger: any time scan-service / watcher / other emitters
// send batch or removed events, schedule an analysis run. The maintenance
// service debounces (clearScheduleTimer + setTimeout) and defers while a
// scan is active, so the constant stream of scan-emitted batches collapses
// into a single trailing run after scan completion. Routing scan events
// through this wrapper means new scan emit-points stay safe even if a
// caller forgets the explicit scheduleAnalysis(0).
const maintenanceAwareSender = {
  send(channel: string, data: unknown): void {
    utilitySender.send(channel, data);
    if (channel === "image:batch" || channel === "image:removed") {
      maintenanceService.scheduleAnalysis();
    }
  },
};

const scanService = createScanService({
  imageRepo,
  folderRepo,
  sender: maintenanceAwareSender,
  readMeta: (filePath) => naiPool.run(filePath),
  hashFile: fileHash,
  searchStats: searchStatsAdapter,
  ignoredDuplicates: {
    isIgnored: isIgnoredDuplicatePath,
  },
  similarityCache: similarityCacheAdapter,
});
const imageService = createImageService({
  imageRepo,
  readMeta: (filePath) => naiPool.run(filePath),
  searchStats: searchStatsAdapter,
});
const duplicateService = createDuplicateService({
  imageRepo,
  hashFile: fileHash,
  ignoredDuplicates: ignoredDuplicatesAdapter,
  searchStats: searchStatsAdapter,
  similarityCache: similarityCacheAdapter,
});

const watchService = createWatchService({
  imageRepo,
  folderRepo,
  sender: maintenanceAwareSender,
  readMeta: readImageMeta,
  searchStats: {
    applyMutation: applyImageSearchStatsMutation,
    decrementForRows: decrementImageSearchStatsForRows,
  },
  duplicateDetection: {
    findDuplicateForIncomingPath: (p) =>
      duplicateService.findDuplicateForIncomingPath(p),
    isIgnored: isIgnoredDuplicatePath,
    forgetIgnored: forgetIgnoredDuplicatePath,
  },
  similarityCache: {
    deleteForImageIds: deleteSimilarityCacheForImageIds,
    refreshForImageIds: refreshSimilarityCacheForImageIds,
  },
});

async function handleRequest(type: string, payload: unknown): Promise<unknown> {
  const emitSearchStatsProgress = (done: number, total: number): void => {
    utilitySender.send("image:searchStatsProgress", { done, total });
  };
  switch (type) {
    case "db:runMigrations":
      await runMigrations((progress) => {
        utilitySender.send("db:migrationProgress", progress);
      });
      return;
    case "folder:list":
      return folderService.list();
    case "folder:create": {
      const { name, path } = payload as { name: string; path: string };
      const folder = await folderService.create(name, path);
      watchService.watchFolder(folder.id, folder.path);
      return folder;
    }
    case "folder:findDuplicates": {
      const { path } = payload as { path: string };
      return duplicateService.findDuplicates(path);
    }
    case "folder:resolveDuplicates": {
      const { resolutions } = payload as {
        resolutions: Array<{
          id: string;
          hash: string;
          existingEntries: Array<{ imageId: number; path: string }>;
          incomingPaths: string[];
          keep: "existing" | "incoming" | "ignore";
        }>;
      };
      // Pause watcher during resolution to prevent it from re-detecting
      // deleted/retained files as new changes or new duplicates.
      watchService.setScanActive(true);
      try {
        const resolved = await duplicateService.resolve(
          resolutions,
          emitSearchStatsProgress,
        );
        if (resolved.removedImageIds.length > 0) {
          utilitySender.send("image:removed", resolved.removedImageIds);
        }
        watchService.applyResolvedDuplicates({
          touchedIncomingPaths: resolved.touchedIncomingPaths,
          retainedIncomingPaths: resolved.retainedIncomingPaths,
        });
        maintenanceService.scheduleAnalysis(0);
        return null;
      } finally {
        watchService.setScanActive(false);
      }
    }
    case "folder:delete": {
      const { id } = payload as { id: number };
      watchService.stopFolder(id);
      // folderService.delete handles ImageSimilarityCache + ImageSearchStat
      // cleanup internally so the web/data-root paths get the same parity.
      await folderService.delete(id, emitSearchStatsProgress);
      // PRAGMA is sqlite-specific and best-effort, so it stays out of core.
      try {
        await getDB().$executeRawUnsafe("PRAGMA incremental_vacuum");
      } catch {
        /* ignore */
      }
      return null;
    }
    case "folder:rename": {
      const { id, name } = payload as { id: number; name: string };
      return folderService.rename(id, name);
    }
    case "folder:listSubdirectories": {
      const { id } = payload as { id: number };
      return folderService.getSubfolderPaths(id);
    }
    case "folder:stats": {
      const { id } = payload as { id: number };
      return folderService.getStats(id);
    }
    case "folder:size": {
      const { id } = payload as { id: number };
      return folderService.getSize(id);
    }

    case "image:getSearchPresetStats":
      return getImageSearchPresetStats(emitSearchStatsProgress);
    case "image:suggestTags":
      return suggestImageSearchTags(
        (payload as {
          prefix: string;
          limit?: number;
          exclude?: string[];
        }) ?? { prefix: "" },
      );
    case "image:listPage":
      return imageService.listPage(
        (payload as ImageListQuery | undefined) ?? {},
      );
    case "image:listMatchingIds":
      return imageService.listMatchingIds(
        (payload as ImageListQuery | undefined) ?? {},
      );
    case "image:listByIds": {
      const { ids } = payload as { ids: number[] };
      return imageService.listByIds(ids);
    }
    case "image:quickVerify":
      return scanService.quickVerify(
        undefined,
        (done: number, total: number) => {
          utilitySender.send("image:quickVerifyProgress", { done, total });
        },
      );
    case "image:scan": {
      const {
        detectDuplicates = false,
        folderIds,
        orderedFolderIds,
        skipFolderIds,
      } = (payload as
        | {
            detectDuplicates?: boolean;
            folderIds?: number[];
            orderedFolderIds?: number[];
            skipFolderIds?: number[];
          }
        | undefined) ?? {};
      scanCancelToken = { cancelled: false };
      scanInFlight = true;
      watchService.setScanActive(true);
      try {
        const result = await scanService.scanAll({
          signal: scanCancelToken,
          folderIds,
          orderedFolderIds,
          skipFolderIds,
          detectDuplicates,
          onDuplicateGroup: detectDuplicates
            ? (group) => utilitySender.send("image:watchDuplicate", group)
            : undefined,
          onDupCheckProgress: (done, total) =>
            utilitySender.send("image:dupCheckProgress", { done, total }),
          onSearchStatsProgress: emitSearchStatsProgress,
          onPhase: (phase) => utilitySender.send("image:scanPhase", { phase }),
        });
        if (!scanCancelToken?.cancelled) {
          maintenanceService.scheduleAnalysis(0);
        }
        return result;
      } finally {
        scanCancelToken = null;
        scanInFlight = false;
        watchService.setScanActive(false, { discardDeferredChanges: true });
      }
    }
    case "image:cancelScan":
      if (scanCancelToken) scanCancelToken.cancelled = true;
      return null;
    case "image:setFavorite": {
      const { id, isFavorite } = payload as { id: number; isFavorite: boolean };
      await imageRepo.setFavorite(id, isFavorite);
      return null;
    }
    // fs.watch can miss deletion events on some filesystems (network volumes,
    // some Linux setups), so callers explicitly request DB cleanup after they
    // unlink/trash a file. setScanActive pauses the watcher so any delayed
    // file-gone event won't double-decrement search stats.
    case "image:cleanupDeletedByPath": {
      const { path: imagePath } = payload as { path: string };
      watchService.setScanActive(true);
      try {
        const existing = await imageRepo.findByPath(imagePath);
        if (!existing) return { deletedFromDb: false };
        await imageRepo.deleteByIds([existing.id]);
        await deleteSimilarityCacheForImageIds([existing.id]);
        await decrementImageSearchStatsForRows(
          [existing],
          emitSearchStatsProgress,
        );
        utilitySender.send("image:removed", [existing.id]);
        return { deletedFromDb: true };
      } finally {
        watchService.setScanActive(false, { discardDeferredChanges: true });
      }
    }
    case "image:cleanupDeletedByIds": {
      const { ids } = payload as { ids: number[] };
      if (ids.length === 0) return { deletedFromDb: 0 };
      watchService.setScanActive(true);
      try {
        const rows = await imageRepo.listByIds(ids);
        if (rows.length === 0) return { deletedFromDb: 0 };
        const deletedIds = rows.map((r) => r.id);
        await imageRepo.deleteByIds(deletedIds);
        await deleteSimilarityCacheForImageIds(deletedIds);
        await decrementImageSearchStatsForRows(rows, emitSearchStatsProgress);
        utilitySender.send("image:removed", deletedIds);
        return { deletedFromDb: deletedIds.length };
      } finally {
        watchService.setScanActive(false, { discardDeferredChanges: true });
      }
    }
    case "image:watch":
      // No-op if watcher was already started at boot (paused mode).
      // Kept for backwards compatibility; the watcher is now auto-started.
      return null;
    case "image:listIgnoredDuplicates":
      return duplicateService.listIgnored();
    case "image:clearIgnoredDuplicates":
      return duplicateService.clearIgnored();

    case "prompt:listCategories":
      return promptBuilderService.listCategories();
    case "prompt:createCategory": {
      const { name } = payload as { name: string };
      return promptBuilderService.createCategory(name);
    }
    case "prompt:renameCategory": {
      const { id, name } = payload as { id: number; name: string };
      return promptBuilderService.renameCategory(id, name);
    }
    case "prompt:deleteCategory": {
      const { id } = payload as { id: number };
      return promptBuilderService.deleteCategory(id);
    }
    case "prompt:resetCategories":
      return promptBuilderService.resetCategories();
    case "prompt:createGroup": {
      const { categoryId, name } = payload as {
        categoryId: number;
        name: string;
      };
      return promptBuilderService.createGroup(categoryId, name);
    }
    case "prompt:deleteGroup": {
      const { id } = payload as { id: number };
      return promptBuilderService.deleteGroup(id);
    }
    case "prompt:renameGroup": {
      const { id, name } = payload as { id: number; name: string };
      return promptBuilderService.renameGroup(id, name);
    }
    case "prompt:createToken": {
      const { groupId, label } = payload as { groupId: number; label: string };
      return promptBuilderService.createToken(groupId, label);
    }
    case "prompt:deleteToken": {
      const { id } = payload as { id: number };
      return promptBuilderService.deleteToken(id);
    }
    case "prompt:reorderGroups": {
      const { categoryId, ids } = payload as {
        categoryId: number;
        ids: number[];
      };
      return promptBuilderService.reorderGroups(categoryId, ids);
    }
    case "prompt:reorderTokens": {
      const { groupId, ids } = payload as { groupId: number; ids: number[] };
      return promptBuilderService.reorderTokens(groupId, ids);
    }
    case "prompt:suggestTags":
      return promptTagService.suggestTags(
        (payload as {
          prefix: string;
          limit?: number;
          exclude?: string[];
        }) ?? { prefix: "" },
      );
    case "prompt:searchTags":
      return promptTagService.searchTags(
        (payload as {
          name?: string;
          sortBy?: "name" | "count";
          order?: "asc" | "desc";
          page?: number;
          pageSize?: number;
        }) ?? {},
      );

    case "image:computeHashes": {
      // Manual trigger: client (settings panel "지금 분석") forces an
      // analysis run. The maintenance service dedupes against any in-flight
      // run automatically.
      const result = await maintenanceService.runAnalysisNow();
      return result.hashed;
    }
    case "image:similarGroups": {
      const { threshold, jaccardThreshold } = payload as {
        threshold: number;
        jaccardThreshold?: number;
      };
      return getSimilarGroups(threshold, jaccardThreshold, (done, total) =>
        utilitySender.send("image:similarityProgress", { done, total }),
      );
    }
    case "image:similarGroupForImage": {
      const { imageId } = payload as { imageId: number };
      return getGroupForImage(imageId);
    }
    case "image:similarReasons": {
      const { imageId, candidateImageIds, threshold, jaccardThreshold } =
        payload as {
          imageId: number;
          candidateImageIds: number[];
          threshold: number;
          jaccardThreshold?: number;
        };
      return getSimilarityReasons(
        imageId,
        candidateImageIds,
        threshold,
        jaccardThreshold,
      );
    }
    case "image:resetHashes": {
      const result = await resetAllHashes();
      // Hashes were just cleared — schedule maintenance to recompute.
      maintenanceService.scheduleAnalysis(0);
      return result;
    }

    case "image:rescanMetadata": {
      const result = await imageService.rescanAll(
        (done: number, total: number) =>
          utilitySender.send("image:rescanMetadataProgress", { done, total }),
        (images: ImageEntity[]) =>
          utilitySender.send(
            "image:batch",
            images.map((img) => ({ ...img, isNew: false })),
          ),
        emitSearchStatsProgress,
      );
      // Token text changed → similarity cache may be stale → schedule run.
      maintenanceService.scheduleAnalysis(0);
      return result;
    }

    case "image:rescanImageMetadata": {
      const { paths } = payload as { paths: string[] };
      const result = await imageService.rescanPaths(
        paths,
        (images: ImageEntity[]) =>
          utilitySender.send(
            "image:batch",
            images.map((img) => ({ ...img, isNew: false })),
          ),
      );
      // Token text changed → similarity cache for these images is stale.
      maintenanceService.scheduleAnalysis(0);
      return result;
    }

    case "category:list":
      return categoryService.list();
    case "category:create": {
      const { name } = payload as { name: string };
      return categoryService.create(name);
    }
    case "category:delete": {
      const { id } = payload as { id: number };
      return categoryService.delete(id);
    }
    case "category:rename": {
      const { id, name } = payload as { id: number; name: string };
      return categoryService.rename(id, name);
    }
    case "category:addImage": {
      const { imageId, categoryId } = payload as {
        imageId: number;
        categoryId: number;
      };
      return categoryService.addImage(imageId, categoryId);
    }
    case "category:removeImage": {
      const { imageId, categoryId } = payload as {
        imageId: number;
        categoryId: number;
      };
      return categoryService.removeImage(imageId, categoryId);
    }
    case "category:addImages": {
      const { imageIds, categoryId } = payload as {
        imageIds: number[];
        categoryId: number;
      };
      return categoryService.addImages(imageIds, categoryId);
    }
    case "category:removeImages": {
      const { imageIds, categoryId } = payload as {
        imageIds: number[];
        categoryId: number;
      };
      return categoryService.removeImages(imageIds, categoryId);
    }
    case "category:addByPrompt": {
      const { categoryId, query } = payload as {
        categoryId: number;
        query: string;
      };
      return categoryService.addImagesByPrompt(categoryId, query);
    }
    case "category:imageIds": {
      const { categoryId } = payload as { categoryId: number };
      return categoryService.getImageIds(categoryId);
    }
    case "category:forImage": {
      const { imageId } = payload as { imageId: number };
      return categoryService.getCategoriesForImage(imageId);
    }
    case "category:commonForImages": {
      const { imageIds } = payload as { imageIds: number[] };
      return categoryService.getCommonCategoriesForImages(imageIds);
    }
    case "category:setColor": {
      const { id, color } = payload as { id: number; color: string | null };
      return categoryService.updateColor(id, color);
    }

    case "nai:validateApiKey":
      return naiGenService.validateApiKey(payload as string);
    case "nai:getSubscription":
      return naiGenService.getSubscriptionInfo();
    case "nai:getConfig":
      return naiGenService.getConfig();
    case "nai:updateConfig":
      return naiGenService.updateConfig(payload as NaiConfigPatch);
    case "nai:generate":
      return naiGenService.generate(
        payload as GenerateParams,
        (dataUrl: string) => {
          utilitySender.send("nai:generatePreview", dataUrl);
        },
      );

    case "system:shutdown": {
      // Triggered by the bridge on app close. Gives the utility process a
      // chance to drain in-flight maintenance work, terminate worker
      // threads, and disconnect from the DB cleanly. Reply with `null` once
      // done so the bridge can proceed with child.kill().
      log.info("Shutdown requested");
      maintenanceService.requestShutdown();
      if (scanCancelToken) scanCancelToken.cancelled = true;
      try {
        watchService.stopAll();
      } catch (err) {
        log.errorWithStack("watchService.stopAll failed", err as Error);
      }
      try {
        await maintenanceService.flush();
      } catch (err) {
        log.errorWithStack("maintenance.flush failed", err as Error);
      }
      try {
        await Promise.allSettled([naiPool.shutdown(), pHashPool.shutdown()]);
      } catch (err) {
        log.errorWithStack("Worker pool shutdown failed", err as Error);
      }
      try {
        await disconnectDB();
      } catch (err) {
        log.errorWithStack("disconnectDB failed", err as Error);
      }
      log.info("Shutdown complete");
      return null;
    }

    default:
      throw new Error(`Unknown request type: ${type}`);
  }
}

// Seed builtins on startup
categoryService
  .seedBuiltins()
  .then(() => log.info("Seeded builtin categories"))
  .catch((error) =>
    log.errorWithStack("Failed to seed builtin categories", error),
  );

// Eager-load ignored duplicate paths so first request doesn't pay the cost
duplicateService
  .ensureIgnoredLoaded()
  .then(() => log.info("Loaded ignored duplicate paths"))
  .catch((error) =>
    log.errorWithStack("Failed to load ignored duplicate paths", error),
  );

// Start watching folders immediately in paused mode so file changes that
// occur before the first scan are queued and flushed after the scan finishes.
watchService
  .startAll({ paused: true })
  .then(() => log.info("Watcher started in paused mode"))
  .catch((error) =>
    log.errorWithStack("Failed to start watcher on boot", error),
  );

process.parentPort.on("message", async (e: Electron.MessageEvent) => {
  const { id, type, payload } = e.data as {
    id: number;
    type: string;
    payload: unknown;
  };
  const startedAt = Date.now();
  log.debug("Request start", { id, type });
  // Acknowledge receipt so the bridge resets its timeout — queue-wait time
  // no longer counts against the request timeout.
  process.parentPort.postMessage({ id, ack: true });
  try {
    const result = await handleRequest(type, payload);
    log.debug("Request success", {
      id,
      type,
      elapsedMs: Date.now() - startedAt,
    });
    process.parentPort.postMessage({ id, result });
  } catch (error) {
    log.errorWithStack("Request failed", error, {
      id,
      type,
      elapsedMs: Date.now() - startedAt,
    });
    process.parentPort.postMessage({ id, error: String(error) });
  }
});
