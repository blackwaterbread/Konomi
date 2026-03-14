import type { EventSender } from "./lib/watcher";
import {
  startWatching,
  watchNewFolder,
  unwatchFolder,
  notifyWatchDuplicateResolved,
} from "./lib/watcher";
import {
  getFolders,
  createFolder,
  deleteFolder,
  renameFolder,
} from "./lib/folder";
import {
  listImages,
  listImagesPage,
  listImagesByIds,
  listImageIdsForFolder,
  getImageSearchPresetStats,
  suggestImageSearchTags,
  listImageSearchStatSourcesForFolder,
  decrementImageSearchStatsForRows,
  syncAllFolders,
  setImageFavorite,
  backfillPromptTokens,
  findFolderDuplicateImages,
  resolveFolderDuplicates,
  listIgnoredDuplicatePaths,
  clearIgnoredDuplicatePaths,
} from "./lib/image";
import {
  listGroups,
  createGroup,
  deleteGroup,
  renameGroup,
  reorderGroups,
  resetGroups,
  createToken,
  deleteToken,
  reorderTokens,
} from "./lib/prompt";
import {
  computeAllHashes,
  deleteSimilarityCacheForImageIds,
  getSimilarGroups,
  getSimilarityReasons,
  resetAllHashes,
} from "./lib/phash";
import {
  listCategories,
  createCategory,
  deleteCategory,
  renameCategory,
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
import { getNaiConfig, updateNaiConfig, generateImage } from "./lib/nai-gen";
import type { NaiConfigPatch, GenerateParams } from "./lib/nai-gen";
import type { CancelToken } from "./lib/scanner";
import { createLogger } from "./lib/logger";

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
      return null;
    }
    case "folder:rename": {
      const { id, name } = payload as { id: number; name: string };
      return renameFolder(id, name);
    }

    case "image:list":
      return listImages();
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
        }) ?? {},
      );
    case "image:listByIds": {
      const { ids } = payload as { ids: number[] };
      return listImagesByIds(ids);
    }
    case "image:scan": {
      const { detectDuplicates = false, orderedFolderIds } =
        (payload as
          | { detectDuplicates?: boolean; orderedFolderIds?: number[] }
          | undefined) ?? {};
      scanCancelToken = { cancelled: false };
      try {
        return await syncAllFolders(
          (batch) => utilitySender.send("image:batch", batch),
          (done, total) =>
            utilitySender.send("image:scanProgress", { done, total }),
          (folderId, folderName) =>
            utilitySender.send("image:scanFolder", {
              folderId,
              folderName,
              active: true,
            }),
          (folderId) =>
            utilitySender.send("image:scanFolder", { folderId, active: false }),
          scanCancelToken,
          detectDuplicates
            ? (group) => utilitySender.send("image:watchDuplicate", group)
            : undefined,
          orderedFolderIds,
          emitSearchStatsProgress,
        );
      } finally {
        scanCancelToken = null;
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
      await startWatching(utilitySender);
      return null;
    case "image:listIgnoredDuplicates":
      return listIgnoredDuplicatePaths();
    case "image:clearIgnoredDuplicates":
      return clearIgnoredDuplicatePaths();

    case "prompt:listGroups":
      return listGroups();
    case "prompt:createGroup": {
      const { name, type: pType } = payload as { name: string; type: string };
      return createGroup(name, pType);
    }
    case "prompt:deleteGroup": {
      const { id } = payload as { id: number };
      return deleteGroup(id);
    }
    case "prompt:renameGroup": {
      const { id, name } = payload as { id: number; name: string };
      return renameGroup(id, name);
    }
    case "prompt:reorderGroups": {
      const { ids } = payload as { ids: number[] };
      return reorderGroups(ids);
    }
    case "prompt:createToken": {
      const { groupId, label } = payload as { groupId: number; label: string };
      return createToken(groupId, label);
    }
    case "prompt:deleteToken": {
      const { id } = payload as { id: number };
      return deleteToken(id);
    }
    case "prompt:reorderTokens": {
      const { groupId, ids } = payload as { groupId: number; ids: number[] };
      return reorderTokens(groupId, ids);
    }
    case "prompt:resetGroups":
      return resetGroups();

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

    case "nai:getConfig":
      return getNaiConfig();
    case "nai:updateConfig":
      return updateNaiConfig(payload as NaiConfigPatch);
    case "nai:generate":
      return generateImage(payload as GenerateParams);

    default:
      throw new Error(`Unknown request type: ${type}`);
  }
}

// Seed builtins + deferred prompt backfill on startup
seedBuiltinCategories()
  .then(() => log.info("Seeded builtin categories"))
  .catch((error) =>
    log.errorWithStack("Failed to seed builtin categories", error),
  );
setTimeout(() => {
  backfillPromptTokens()
    .then(() => log.info("Backfilled prompt tokens"))
    .catch((error) =>
      log.errorWithStack("Failed to backfill prompt tokens", error),
    );
}, 8000);

process.parentPort.on("message", async (e: Electron.MessageEvent) => {
  const { id, type, payload } = e.data as {
    id: number;
    type: string;
    payload: unknown;
  };
  const startedAt = Date.now();
  log.debug("Request start", { id, type });
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
