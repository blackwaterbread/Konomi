import type { EventSender } from "@core/types/event-sender";
import { getDB, runMigrations } from "@core/lib/db";
import { createPrismaFolderRepo } from "@core/lib/repositories/prisma-folder-repo";
import { createPrismaImageRepo } from "@core/lib/repositories/prisma-image-repo";
import { createPrismaCategoryRepo } from "@core/lib/repositories/prisma-category-repo";
import { createPrismaPromptRepo } from "@core/lib/repositories/prisma-prompt-repo";
import { createPrismaNaiConfigRepo } from "@core/lib/repositories/prisma-nai-config-repo";
import { createScanService } from "@core/services/scan-service";
import { createFolderService } from "@core/services/folder-service";
import { createCategoryService } from "@core/services/category-service";
import { createImageService } from "@core/services/image-service";
import { createDuplicateService } from "@core/services/duplicate-service";
import { createPromptBuilderService } from "@core/services/prompt-builder-service";
import { createPromptTagService } from "@core/services/prompt-tag-service";
import { createNaiGenService } from "@core/services/nai-gen-service";
import { createWatchService } from "@core/services/watch-service";
import { readImageMeta } from "@core/lib/image-meta";
import { getPromptsDBPath } from "@core/lib/prompts-db";
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
  applyImageSearchStatsMutations,
  applyImageSearchStatsMutation,
  decrementImageSearchStatsForRows,
} from "@core/lib/search-stats-store";
import {
  deleteSimilarityCacheForImageIds,
  refreshSimilarityCacheForImageIds,
} from "@core/lib/phash";
import { createLogger } from "@core/lib/logger";

const log = createLogger("web/services");

export function createServices(sender: EventSender) {
  // ── Repositories ─────────────────────────
  const folderRepo = createPrismaFolderRepo(getDB);
  const categoryRepo = createPrismaCategoryRepo(getDB);
  const imageRepo = createPrismaImageRepo(getDB);
  const promptRepo = createPrismaPromptRepo(getDB);
  const naiConfigRepo = createPrismaNaiConfigRepo(getDB);

  // ── Adapters ─────────────────────────────
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

  // ── Services ─────────────────────────────
  const folderService = createFolderService({ folderRepo, imageRepo });
  const categoryService = createCategoryService({ categoryRepo, imageRepo });
  const promptBuilderService = createPromptBuilderService({ promptRepo });
  const naiGenService = createNaiGenService({ naiConfigRepo });
  const promptTagService = createPromptTagService({ getDbPath: getPromptsDBPath });

  const scanService = createScanService({
    imageRepo,
    folderRepo,
    sender,
    readMeta: (filePath) => naiPool.run(filePath),
    hashFile: fileHash,
    searchStats: searchStatsAdapter,
    ignoredDuplicates: { isIgnored: isIgnoredDuplicatePath },
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
    sender,
    readMeta: readImageMeta,
    searchStats: {
      applyMutation: applyImageSearchStatsMutation,
      decrementForRows: decrementImageSearchStatsForRows,
    },
    duplicateDetection: {
      findDuplicateForIncomingPath: (p) => duplicateService.findDuplicateForIncomingPath(p),
      isIgnored: isIgnoredDuplicatePath,
      forgetIgnored: forgetIgnoredDuplicatePath,
    },
    similarityCache: {
      deleteForImageIds: deleteSimilarityCacheForImageIds,
      refreshForImageIds: refreshSimilarityCacheForImageIds,
    },
  });

  return {
    folderRepo,
    imageRepo,
    categoryRepo,
    folderService,
    categoryService,
    imageService,
    scanService,
    duplicateService,
    promptBuilderService,
    promptTagService,
    naiGenService,
    watchService,
    sender,
  };
}

export type Services = ReturnType<typeof createServices>;

export async function bootstrap(services: Services): Promise<void> {
  runMigrations((progress) => {
    services.sender.send("db:migrationProgress", progress);
  });

  await services.categoryService.seedBuiltins();
  log.info("Seeded builtin categories");

  await services.duplicateService.ensureIgnoredLoaded();
  log.info("Loaded ignored duplicate paths");

  await services.watchService.startAll({ paused: true });
  log.info("Watcher started in paused mode");
}
