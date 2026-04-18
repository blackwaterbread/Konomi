import path from "path";
import type { EventSender } from "@core/types/event-sender";
import { getDB } from "./db";
import { listAvailableDirectories } from "./lib/data-root";
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
  const folderRepo = createPrismaFolderRepo(getDB as any);
  const categoryRepo = createPrismaCategoryRepo(getDB as any);
  const imageRepo = createPrismaImageRepo(getDB as any);
  const promptRepo = createPrismaPromptRepo(getDB as any);
  const naiConfigRepo = createPrismaNaiConfigRepo(getDB as any);

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

async function autoRegisterFolders(services: Services): Promise<number> {
  const detected = await listAvailableDirectories();
  if (detected.length === 0) return 0;

  const existing = await services.folderService.list();
  const normalizePath = (p: string) => {
    const resolved = path.resolve(p);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const existingPaths = new Set(existing.map((f) => normalizePath(f.path)));

  let registered = 0;
  for (const dir of detected) {
    if (existingPaths.has(normalizePath(dir.path))) continue;
    try {
      await services.folderService.create(dir.name, dir.path);
      registered++;
      log.info(`Auto-registered folder: ${dir.name} (${dir.path})`);
    } catch (err) {
      log.errorWithStack(
        `Failed to auto-register folder ${dir.path}`,
        err as Error,
      );
    }
  }
  return registered;
}

export async function bootstrap(services: Services): Promise<void> {
  await services.categoryService.seedBuiltins();
  log.info("Seeded builtin categories");

  await services.duplicateService.ensureIgnoredLoaded();
  log.info("Loaded ignored duplicate paths");

  const registered = await autoRegisterFolders(services);
  if (registered > 0) log.info(`Auto-registered ${registered} folder(s)`);

  await services.watchService.startAll({ paused: true });
  log.info("Watcher started in paused mode");
}

export async function runInitialScan(services: Services): Promise<void> {
  try {
    log.info("Initial scan starting");
    await services.scanService.scanAll();
    log.info("Initial scan complete");
  } catch (err) {
    log.errorWithStack("Initial scan failed", err as Error);
  } finally {
    services.watchService.setScanActive(false, {
      discardDeferredChanges: true,
    });
  }
}
