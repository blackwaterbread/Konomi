import type { EventSender as WatcherEventSender } from "./lib/watcher";
import {
  startWatching,
  watchNewFolder,
  unwatchFolder,
  notifyWatchDuplicateResolved,
  setWatcherScanActive,
} from "./lib/watcher";
import {
  listImagesPage,
  listMatchingImageIds,
  listImagesByIds,
  listImageIdsForFolder,
  getImageSearchPresetStats,
  suggestImageSearchTags,
  listImageSearchStatSourcesForFolder,
  decrementImageSearchStatsForRows,
  findFolderDuplicateImages,
  resolveFolderDuplicates,
  listIgnoredDuplicatePaths,
  clearIgnoredDuplicatePaths,
  ensureIgnoredDuplicatePathsLoaded,
  isIgnoredDuplicatePath,
  applyImageSearchStatsMutations,
  rescanAllMetadata,
  rescanImageMetadata,
  fileHash,
  naiPool,
} from "./lib/image";
import { createScanService } from "@core/services/scan-service";
import { createPromptBuilderService } from "@core/services/prompt-builder-service";
import { createPrismaPromptRepo } from "./lib/repositories/prisma-prompt-repo";
import {
  computeAllHashes,
  deleteSimilarityCacheForImageIds,
  getGroupForImage,
  getSimilarGroups,
  getSimilarityReasons,
  resetAllHashes,
} from "./lib/phash";
import { createNaiGenService } from "@core/services/nai-gen-service";
import type { NaiConfigPatch, GenerateParams } from "@core/services/nai-gen-service";
import { createPrismaNaiConfigRepo } from "./lib/repositories/prisma-nai-config-repo";
import type { CancelToken } from "@core/lib/scanner";
import { createLogger } from "@core/lib/logger";
import { createFolderService } from "@core/services/folder-service";
import { createCategoryService } from "@core/services/category-service";
import { createPrismaFolderRepo } from "./lib/repositories/prisma-folder-repo";
import { createPrismaCategoryRepo } from "./lib/repositories/prisma-category-repo";
import { createPrismaImageRepo } from "./lib/repositories/prisma-image-repo";
import { suggestPromptTags, searchPromptTags } from "./lib/prompts-db";
import { getDB, runMigrations } from "./lib/db";

let scanCancelToken: CancelToken | null = null;
let computeHashesInFlight: Promise<number> | null = null;
const log = createLogger("main/utility");

// ── Repository & Service initialization ─────────────────────
const folderRepo = createPrismaFolderRepo(getDB);
const categoryRepo = createPrismaCategoryRepo(getDB);
const imageRepo = createPrismaImageRepo(getDB);

const promptRepo = createPrismaPromptRepo(getDB);

const naiConfigRepo = createPrismaNaiConfigRepo(getDB);

const folderService = createFolderService({ folderRepo, imageRepo });
const categoryService = createCategoryService({ categoryRepo, imageRepo });
const promptBuilderService = createPromptBuilderService({ promptRepo });
const naiGenService = createNaiGenService({ naiConfigRepo });
const scanService = createScanService({
  imageRepo,
  folderRepo,
  sender: { send(channel: string, data: unknown) { process.parentPort.postMessage({ event: channel, payload: data }); } },
  readMeta: (filePath) => naiPool.run(filePath),
  hashFile: fileHash,
  searchStats: {
    applyMutations: applyImageSearchStatsMutations,
  },
  ignoredDuplicates: {
    isIgnored: isIgnoredDuplicatePath,
  },
  similarityCache: {
    deleteForImageIds: deleteSimilarityCacheForImageIds,
  },
});

// Abstract EventSender wrapping parentPort push messages
const utilitySender: WatcherEventSender = {
  send(channel: string, data: unknown): void {
    process.parentPort.postMessage({ event: channel, payload: data });
  },
  isDestroyed(): boolean {
    return false;
  },
};

async function handleRequest(type: string, payload: unknown): Promise<unknown> {
  const emitSearchStatsProgress = (done: number, total: number): void => {
    utilitySender.send("image:searchStatsProgress", { done, total });
  };
  switch (type) {
    case "db:runMigrations":
      runMigrations((progress) => {
        utilitySender.send("db:migrationProgress", progress);
      });
      return;
    case "folder:list":
      return folderService.list();
    case "folder:create": {
      const { name, path } = payload as { name: string; path: string };
      const folder = await folderService.create(name, path);
      watchNewFolder(folder.id, folder.path);
      return folder;
    }
    case "folder:findDuplicates": {
      const { path } = payload as { path: string };
      return findFolderDuplicateImages(path);
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
      setWatcherScanActive(true);
      try {
        const resolved = await resolveFolderDuplicates(
          resolutions,
          emitSearchStatsProgress,
        );
        if (resolved.removedImageIds.length > 0) {
          utilitySender.send("image:removed", resolved.removedImageIds);
        }
        notifyWatchDuplicateResolved({
          touchedIncomingPaths: resolved.touchedIncomingPaths,
          retainedIncomingPaths: resolved.retainedIncomingPaths,
        });
        return null;
      } finally {
        setWatcherScanActive(false);
      }
    }
    case "folder:delete": {
      const { id } = payload as { id: number };
      unwatchFolder(id);
      const folderImageIds = await listImageIdsForFolder(id);
      const folderStatRows = await listImageSearchStatSourcesForFolder(id);
      await folderService.delete(id);
      // Defer non-critical cleanup so the UI gets an immediate response
      (async () => {
        await deleteSimilarityCacheForImageIds(folderImageIds);
        await decrementImageSearchStatsForRows(
          folderStatRows,
          emitSearchStatsProgress,
        );
        try {
          await getDB().$executeRawUnsafe("PRAGMA incremental_vacuum");
        } catch {
          /* ignore */
        }
      })();
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
      return listImagesPage(
        (payload as {
          page?: number;
          pageSize?: number;
          folderIds?: number[];
          searchQuery?: string;
          sortBy?: "recent" | "oldest" | "favorites" | "name";
          onlyRecent?: boolean;
          recentDays?: number;
          customCategoryId?: number | null;
          builtinCategory?: "favorites" | "random" | null;
          randomSeed?: number;
          resolutionFilters?: Array<{ width: number; height: number }>;
          modelFilters?: string[];
          seedFilters?: number[];
          excludeTags?: string[];
        }) ?? {},
      );
    case "image:listMatchingIds":
      return listMatchingImageIds(
        (payload as {
          page?: number;
          pageSize?: number;
          folderIds?: number[];
          searchQuery?: string;
          sortBy?: "recent" | "oldest" | "favorites" | "name";
          onlyRecent?: boolean;
          recentDays?: number;
          customCategoryId?: number | null;
          builtinCategory?: "favorites" | "random" | null;
          randomSeed?: number;
          resolutionFilters?: Array<{ width: number; height: number }>;
          modelFilters?: string[];
          seedFilters?: number[];
          excludeTags?: string[];
        }) ?? {},
      );
    case "image:listByIds": {
      const { ids } = payload as { ids: number[] };
      return listImagesByIds(ids);
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
      setWatcherScanActive(true);
      try {
        return await scanService.scanAll({
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
      } finally {
        scanCancelToken = null;
        setWatcherScanActive(false, { discardDeferredChanges: true });
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
    case "image:watch":
      // No-op if watcher was already started at boot (paused mode).
      // Kept for backwards compatibility; the watcher is now auto-started.
      return null;
    case "image:listIgnoredDuplicates":
      return listIgnoredDuplicatePaths();
    case "image:clearIgnoredDuplicates":
      return clearIgnoredDuplicatePaths();

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
      return suggestPromptTags(
        (payload as {
          prefix: string;
          limit?: number;
          exclude?: string[];
        }) ?? { prefix: "" },
      );
    case "prompt:searchTags":
      return searchPromptTags(
        (payload as {
          name?: string;
          sortBy?: "name" | "count";
          order?: "asc" | "desc";
          page?: number;
          pageSize?: number;
        }) ?? {},
      );

    case "image:computeHashes":
      if (computeHashesInFlight) {
        log.debug("Deduplicating image:computeHashes request");
        return computeHashesInFlight;
      }
      computeHashesInFlight = computeAllHashes(
        (done, total) =>
          utilitySender.send("image:hashProgress", { done, total }),
        (done, total) =>
          utilitySender.send("image:similarityProgress", { done, total }),
      ).finally(() => {
        computeHashesInFlight = null;
      });
      return computeHashesInFlight;
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
    case "image:resetHashes":
      return resetAllHashes();

    case "image:rescanMetadata":
      return rescanAllMetadata(
        (done, total) =>
          utilitySender.send("image:rescanMetadataProgress", { done, total }),
        (images) => utilitySender.send("image:batch", images),
        emitSearchStatsProgress,
      );

    case "image:rescanImageMetadata": {
      const { paths } = payload as { paths: string[] };
      return rescanImageMetadata(paths, (images) =>
        utilitySender.send("image:batch", images),
      );
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
ensureIgnoredDuplicatePathsLoaded()
  .then(() => log.info("Loaded ignored duplicate paths"))
  .catch((error) =>
    log.errorWithStack("Failed to load ignored duplicate paths", error),
  );

// Start watching folders immediately in paused mode so file changes that
// occur before the first scan are queued and flushed after the scan finishes.
startWatching(utilitySender, { paused: true })
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
