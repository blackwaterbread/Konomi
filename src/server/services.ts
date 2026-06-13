import path from "path";
import type { EventSender } from "@core/types/event-sender";
import { getDB } from "./db";
import {
  listAvailableDirectories,
  dataRootExists,
  isUnderDataRoot,
} from "./lib/data-root";
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
import { createMaintenanceService } from "@core/services/maintenance-service";
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
  decrementImageSearchStatsForRows,
  listImageSearchStatSourcesForFolder,
} from "@core/lib/search-stats-store";
import {
  computeAllHashes,
  deleteSimilarityCacheForImageIds,
} from "@core/lib/phash";
import type { CancelToken } from "@core/lib/scanner";
import { createLogger } from "@core/lib/logger";
import { Database } from "bun:sqlite";

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
  const promptTagService = createPromptTagService({
    getDbPath: getPromptsDBPath,
    openDatabase: (path, options) =>
      new Database(path, {
        readonly: options.readonly,
        create: !options.fileMustExist,
      }),
  });

  // Maintenance service tracks scan-active so the scheduler defers analysis
  // while bulk scans are running. The plain reference is captured here and
  // mutated from runInitialScan / future scan handlers. `shuttingDown` is
  // flipped by the SIGTERM handler; runInitialScan checks it before starting
  // so a signal that arrives before the initial scan has launched can't get
  // overwritten by a fresh, un-cancelled token.
  const scanState: {
    active: boolean;
    cancelToken: CancelToken | null;
    shuttingDown: boolean;
    /**
     * Promise for the in-flight background scan started by the HTTP scan
     * endpoint. Shutdown awaits it (after cancelling the token) so worker
     * pools aren't torn down mid-scan. The initial scan and data-root-watcher
     * scans are tracked separately by their own callers.
     */
    inFlight: Promise<void> | null;
  } = {
    active: false,
    cancelToken: null,
    shuttingDown: false,
    inFlight: null,
  };

  // Single chokepoint for toggling scan-active. Mutates scanState AND
  // broadcasts `image:scanActive` so every connected client (including ones
  // that didn't initiate the scan, or reconnected mid-scan) mirrors the
  // state. `image:scanActive {active:false}` is the universal "a scan
  // finished" signal the browser client waits on — every scan path (manual
  // endpoint, initial scan, data-root-watcher) routes through here.
  const setScanActive = (active: boolean): void => {
    scanState.active = active;
    sender.send("image:scanActive", { active });
  };

  const maintenanceService = createMaintenanceService({
    computeAllHashes,
    sender,
    isScanActive: () => scanState.active,
  });

  // Wrapped sender: any time scan-service / watcher / other emitters send
  // batch or removed events, schedule an analysis run. The maintenance
  // service debounces (clearScheduleTimer + setTimeout) and defers while a
  // scan is active, so a stream of scan-emitted batches collapses into a
  // single trailing run after the scan finishes. Routing scan events
  // through this wrapper means new scan emit-points stay safe even if a
  // caller forgets the explicit scheduleAnalysis(0).
  const maintenanceAwareSender: EventSender = {
    send(channel: string, data: unknown) {
      sender.send(channel, data);
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
    ignoredDuplicates: { isIgnored: isIgnoredDuplicatePath },
    similarityCache: similarityCacheAdapter,
  });

  const imageService = createImageService({
    imageRepo,
    folderRepo,
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
    maintenanceService,
    sender,
    scanState,
    setScanActive,
  };
}

export type Services = ReturnType<typeof createServices>;

function normalizeFsPath(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function reconcileRemovedFolders(services: Services): Promise<number> {
  // Guard: if DATA_ROOT itself is missing, don't assume every folder was
  // removed — that could wipe a user's entire library on a misconfigured
  // restart. Skip reconciliation entirely in that case.
  if (!(await dataRootExists())) {
    log.warn("DATA_ROOT missing, skipping folder reconciliation");
    return 0;
  }

  const detected = await listAvailableDirectories();
  const detectedPaths = new Set(detected.map((d) => normalizeFsPath(d.path)));
  const existing = await services.folderService.list();

  let removed = 0;
  for (const folder of existing) {
    // Defensive: only reconcile folders under DATA_ROOT. Web-server folders
    // always are, but skip any outliers to avoid deleting unrelated state.
    if (!isUnderDataRoot(folder.path)) continue;
    if (detectedPaths.has(normalizeFsPath(folder.path))) continue;
    try {
      await services.folderService.delete(folder.id);
      removed++;
      log.info(`Auto-removed missing folder: ${folder.name} (${folder.path})`);
    } catch (err) {
      log.errorWithStack(
        `Failed to auto-remove folder ${folder.path}`,
        err as Error,
      );
    }
  }
  return removed;
}

async function autoRegisterFolders(services: Services): Promise<number> {
  const detected = await listAvailableDirectories();
  if (detected.length === 0) return 0;

  const existing = await services.folderService.list();
  const existingPaths = new Set(existing.map((f) => normalizeFsPath(f.path)));

  let registered = 0;
  for (const dir of detected) {
    if (existingPaths.has(normalizeFsPath(dir.path))) continue;
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

  const removed = await reconcileRemovedFolders(services);
  if (removed > 0) log.info(`Auto-removed ${removed} folder(s)`);

  const registered = await autoRegisterFolders(services);
  if (registered > 0) log.info(`Auto-registered ${registered} folder(s)`);
}

export async function runInitialScan(services: Services): Promise<void> {
  // Bail if a SIGTERM arrived before we got to start. Without this guard
  // shutdown's `cancelToken.cancelled = true` would have run against a null
  // token, then we'd allocate a fresh un-cancelled token and proceed past
  // the shutdown sequence.
  if (services.scanState.shuttingDown) {
    log.info("Skipping initial scan — shutdown already requested");
    return;
  }
  const cancelToken = { cancelled: false };
  services.scanState.cancelToken = cancelToken;
  services.setScanActive(true);
  try {
    log.info("Initial scan starting");
    await services.scanService.scanAll({ signal: cancelToken });
    log.info("Initial scan complete");
    if (!cancelToken.cancelled) {
      services.maintenanceService.scheduleAnalysis(0);
    }
  } catch (err) {
    log.errorWithStack("Initial scan failed", err as Error);
  } finally {
    services.scanState.cancelToken = null;
    services.setScanActive(false);
  }
}
