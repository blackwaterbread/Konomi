import type { EventSender } from "./lib/watcher";
import {
  startWatching,
  watchNewFolder,
  unwatchFolder,
  notifyWatchDuplicateResolved,
  setWatcherScanActive,
} from "./lib/watcher";
import {
  getFolders,
  createFolder,
  deleteFolder,
  renameFolder,
  getSubfolderPaths,
} from "./lib/folder";
import {
  listImagesPage,
  listMatchingImageIds,
  listImagesByIds,
  listImageIdsForFolder,
  getImageSearchPresetStats,
  suggestImageSearchTags,
  listImageSearchStatSourcesForFolder,
  decrementImageSearchStatsForRows,
  quickVerifyFolders,
  syncAllFolders,
  setImageFavorite,
  findFolderDuplicateImages,
  resolveFolderDuplicates,
  listIgnoredDuplicatePaths,
  clearIgnoredDuplicatePaths,
  ensureIgnoredDuplicatePathsLoaded,
  rescanAllMetadata,
  rescanImageMetadata,
} from "./lib/image";
import {
  listCategories as listPromptCategories,
  createCategory as createPromptCategory,
  renameCategory as renamePromptCategory,
  deleteCategory as deletePromptCategory,
  resetCategories as resetPromptCategories,
  createGroup as createPromptGroup,
  deleteGroup as deletePromptGroup,
  renameGroup as renamePromptGroup,
  createToken,
  deleteToken,
  reorderGroups as reorderPromptGroups,
  reorderTokens,
} from "./lib/prompt";
import {
  computeAllHashes,
  deleteSimilarityCacheForImageIds,
  getGroupForImage,
  getSimilarGroups,
  getSimilarityReasons,
  resetAllHashes,
} from "./lib/phash";
import {
  listCategories,
  createCategory,
  deleteCategory,
  renameCategory,
  updateCategoryColor,
  addImageToCategory,
  removeImageFromCategory,
  addImagesToCategory,
  removeImagesFromCategory,
  addImagesByPrompt,
  getCategoryImageIds,
  getCategoriesForImage,
  getCommonCategoryIdsForImages,
  seedBuiltinCategories,
} from "./lib/category";
import {
  getNaiConfig,
  updateNaiConfig,
  generateImage,
  validateApiKey,
  getSubscriptionInfo,
} from "./lib/nai-gen";
import type { NaiConfigPatch, GenerateParams } from "./lib/nai-gen";
import type { CancelToken } from "./lib/scanner";
import { createLogger } from "./lib/logger";
import { suggestPromptTags, searchPromptTags } from "./lib/prompts-db";
import { getDB, runMigrations } from "./lib/db";

let scanCancelToken: CancelToken | null = null;
let computeHashesInFlight: Promise<number> | null = null;
const log = createLogger("main/utility");

// Abstract EventSender wrapping parentPort push messages
const utilitySender: EventSender = {
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
      return getFolders();
    case "folder:create": {
      const { name, path } = payload as { name: string; path: string };
      const folder = await createFolder(name, path);
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
    }
    case "folder:delete": {
      const { id } = payload as { id: number };
      unwatchFolder(id);
      const folderImageIds = await listImageIdsForFolder(id);
      const folderStatRows = await listImageSearchStatSourcesForFolder(id);
      await deleteFolder(id);
      await deleteSimilarityCacheForImageIds(folderImageIds);
      await decrementImageSearchStatsForRows(
        folderStatRows,
        emitSearchStatsProgress,
      );
      try {
        await getDB().$executeRawUnsafe("VACUUM");
      } catch {
        /* ignore */
      }
      return null;
    }
    case "folder:rename": {
      const { id, name } = payload as { id: number; name: string };
      return renameFolder(id, name);
    }
    case "folder:listSubdirectories": {
      const { id } = payload as { id: number };
      return getSubfolderPaths(id);
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
      return quickVerifyFolders();
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
        return await syncAllFolders({
          onBatch: (batch) => utilitySender.send("image:batch", batch),
          onProgress: (done, total) =>
            utilitySender.send("image:scanProgress", { done, total }),
          onFolderStart: (folderId, folderName) =>
            utilitySender.send("image:scanFolder", {
              folderId,
              folderName,
              active: true,
            }),
          onFolderEnd: (folderId) =>
            utilitySender.send("image:scanFolder", { folderId, active: false }),
          signal: scanCancelToken,
          onDuplicateGroup: detectDuplicates
            ? (group) => utilitySender.send("image:watchDuplicate", group)
            : undefined,
          folderIds,
          orderedFolderIds,
          onSearchStatsProgress: emitSearchStatsProgress,
          onDupCheckProgress: (done, total) =>
            utilitySender.send("image:dupCheckProgress", { done, total }),
          onPhase: (phase) => utilitySender.send("image:scanPhase", { phase }),
          skipFolderIds,
        });
      } finally {
        scanCancelToken = null;
        setWatcherScanActive(false);
      }
    }
    case "image:cancelScan":
      if (scanCancelToken) scanCancelToken.cancelled = true;
      return null;
    case "image:setFavorite": {
      const { id, isFavorite } = payload as { id: number; isFavorite: boolean };
      return setImageFavorite(id, isFavorite);
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
      return listPromptCategories();
    case "prompt:createCategory": {
      const { name } = payload as { name: string };
      return createPromptCategory(name);
    }
    case "prompt:renameCategory": {
      const { id, name } = payload as { id: number; name: string };
      return renamePromptCategory(id, name);
    }
    case "prompt:deleteCategory": {
      const { id } = payload as { id: number };
      return deletePromptCategory(id);
    }
    case "prompt:resetCategories":
      return resetPromptCategories();
    case "prompt:createGroup": {
      const { categoryId, name } = payload as {
        categoryId: number;
        name: string;
      };
      return createPromptGroup(categoryId, name);
    }
    case "prompt:deleteGroup": {
      const { id } = payload as { id: number };
      return deletePromptGroup(id);
    }
    case "prompt:renameGroup": {
      const { id, name } = payload as { id: number; name: string };
      return renamePromptGroup(id, name);
    }
    case "prompt:createToken": {
      const { groupId, label } = payload as { groupId: number; label: string };
      return createToken(groupId, label);
    }
    case "prompt:deleteToken": {
      const { id } = payload as { id: number };
      return deleteToken(id);
    }
    case "prompt:reorderGroups": {
      const { categoryId, ids } = payload as {
        categoryId: number;
        ids: number[];
      };
      return reorderPromptGroups(categoryId, ids);
    }
    case "prompt:reorderTokens": {
      const { groupId, ids } = payload as { groupId: number; ids: number[] };
      return reorderTokens(groupId, ids);
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
      return listCategories();
    case "category:create": {
      const { name } = payload as { name: string };
      return createCategory(name);
    }
    case "category:delete": {
      const { id } = payload as { id: number };
      return deleteCategory(id);
    }
    case "category:rename": {
      const { id, name } = payload as { id: number; name: string };
      return renameCategory(id, name);
    }
    case "category:addImage": {
      const { imageId, categoryId } = payload as {
        imageId: number;
        categoryId: number;
      };
      return addImageToCategory(imageId, categoryId);
    }
    case "category:removeImage": {
      const { imageId, categoryId } = payload as {
        imageId: number;
        categoryId: number;
      };
      return removeImageFromCategory(imageId, categoryId);
    }
    case "category:addImages": {
      const { imageIds, categoryId } = payload as {
        imageIds: number[];
        categoryId: number;
      };
      return addImagesToCategory(imageIds, categoryId);
    }
    case "category:removeImages": {
      const { imageIds, categoryId } = payload as {
        imageIds: number[];
        categoryId: number;
      };
      return removeImagesFromCategory(imageIds, categoryId);
    }
    case "category:addByPrompt": {
      const { categoryId, query } = payload as {
        categoryId: number;
        query: string;
      };
      return addImagesByPrompt(categoryId, query);
    }
    case "category:imageIds": {
      const { categoryId } = payload as { categoryId: number };
      return getCategoryImageIds(categoryId);
    }
    case "category:forImage": {
      const { imageId } = payload as { imageId: number };
      return getCategoriesForImage(imageId);
    }
    case "category:commonForImages": {
      const { imageIds } = payload as { imageIds: number[] };
      return getCommonCategoryIdsForImages(imageIds);
    }
    case "category:setColor": {
      const { id, color } = payload as { id: number; color: string | null };
      return updateCategoryColor(id, color);
    }

    case "nai:validateApiKey":
      return validateApiKey(payload as string);
    case "nai:getSubscription":
      return getSubscriptionInfo();
    case "nai:getConfig":
      return getNaiConfig();
    case "nai:updateConfig":
      return updateNaiConfig(payload as NaiConfigPatch);
    case "nai:generate":
      return generateImage(payload as GenerateParams, (dataUrl) => {
        utilitySender.send("nai:generatePreview", dataUrl);
      });

    default:
      throw new Error(`Unknown request type: ${type}`);
  }
}

// Seed builtins on startup
seedBuiltinCategories()
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
