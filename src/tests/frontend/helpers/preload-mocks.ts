import { vi } from "vitest";

type Listener<T> = (payload: T) => void;

function createEventChannel<T>() {
  const listeners = new Set<Listener<T>>();
  const subscribe = vi.fn((listener: Listener<T>) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  });

  return {
    subscribe,
    emit(payload: T) {
      for (const listener of [...listeners]) {
        listener(payload);
      }
    },
    reset() {
      listeners.clear();
      subscribe.mockClear();
    },
  };
}

const imageBatch =
  createEventChannel<
    Window["image"] extends { onBatch: (cb: infer T) => unknown }
      ? T extends (payload: infer P) => unknown
        ? P
        : never
      : never
  >();
const imageRemoved = createEventChannel<number[]>();
const imageWatchDuplicate =
  createEventChannel<
    Parameters<Parameters<Window["image"]["onWatchDuplicate"]>[0]>[0]
  >();
const imageHashProgress = createEventChannel<{ done: number; total: number }>();
const imageSimilarityProgress = createEventChannel<{
  done: number;
  total: number;
}>();
const imageScanProgress = createEventChannel<{ done: number; total: number }>();
const imageSearchStatsProgress = createEventChannel<{
  done: number;
  total: number;
}>();
const imageScanFolder = createEventChannel<{
  folderId: number;
  folderName?: string;
  active: boolean;
}>();
const imageDupCheckProgress = createEventChannel<{
  done: number;
  total: number;
}>();
const imageScanPhase = createEventChannel<{ phase: string }>();
const imageRescanMetadataProgress = createEventChannel<{
  done: number;
  total: number;
}>();
const dbMigrationProgress = createEventChannel<{
  done: number;
  total: number;
  migrationName: string;
}>();
const naiGeneratePreview = createEventChannel<string>();
const appUpdateAvailable = createEventChannel<{
  version: string;
  releaseUrl?: string;
}>();
const appUpdateDownloaded = createEventChannel<{ version: string }>();

export const preloadEvents = {
  db: {
    migrationProgress: dbMigrationProgress,
  },
  image: {
    batch: imageBatch,
    removed: imageRemoved,
    watchDuplicate: imageWatchDuplicate,
    hashProgress: imageHashProgress,
    similarityProgress: imageSimilarityProgress,
    scanProgress: imageScanProgress,
    searchStatsProgress: imageSearchStatsProgress,
    scanFolder: imageScanFolder,
    dupCheckProgress: imageDupCheckProgress,
    scanPhase: imageScanPhase,
    rescanMetadataProgress: imageRescanMetadataProgress,
  },
  nai: {
    generatePreview: naiGeneratePreview,
  },
  appInfo: {
    updateAvailable: appUpdateAvailable,
    updateDownloaded: appUpdateDownloaded,
  },
};

export const preloadMocks = {
  db: {
    runMigrations: vi.fn().mockResolvedValue(undefined),
    onMigrationProgress: dbMigrationProgress.subscribe,
  },
  appInfo: {
    isDevMode: vi.fn().mockResolvedValue(false),
    get: vi.fn().mockResolvedValue({
      appName: "Konomi",
      appVersion: "0.1.0",
      electronVersion: "39.0.0",
      chromeVersion: "139.0.0.0",
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    }),
    getLocale: vi.fn().mockResolvedValue("en"),
    getDbFileSize: vi.fn().mockResolvedValue(null),
    getPromptsDbSchemaVersion: vi.fn().mockResolvedValue(null),
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    installUpdate: vi.fn().mockResolvedValue(undefined),
    onUpdateAvailable: appUpdateAvailable.subscribe,
    onUpdateDownloaded: appUpdateDownloaded.subscribe,
    onUpdateProgress: vi.fn().mockReturnValue(() => {}),
    onUtilityReset: vi.fn().mockReturnValue(() => {}),
    clearResourceCache: vi.fn(),
  },
  promptBuilder: {
    listCategories: vi.fn().mockResolvedValue([]),
    suggestTags: vi.fn().mockResolvedValue({
      suggestions: [],
      stats: { totalTags: 0, maxCount: 0, bucketThresholds: [] },
    }),
    createCategory: vi.fn(),
    renameCategory: vi.fn(),
    deleteCategory: vi.fn(),
    resetCategories: vi.fn(),
    createGroup: vi.fn(),
    deleteGroup: vi.fn(),
    renameGroup: vi.fn(),
    createToken: vi.fn(),
    deleteToken: vi.fn(),
    reorderGroups: vi.fn(),
    reorderTokens: vi.fn(),
    searchTags: vi.fn().mockResolvedValue({
      rows: [],
      totalCount: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    }),
  },
  image: {
    readNaiMeta: vi.fn().mockResolvedValue(null),
    readMetaFromBuffer: vi.fn().mockResolvedValue(null),
    readFile: vi.fn(),
    getSearchPresetStats: vi.fn().mockResolvedValue({
      availableResolutions: [],
      availableModels: [],
    }),
    suggestTags: vi.fn().mockResolvedValue([]),
    listPage: vi.fn().mockResolvedValue({
      rows: [],
      totalCount: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    }),
    listMatchingIds: vi.fn().mockResolvedValue([]),
    bulkDelete: vi.fn().mockResolvedValue({ deleted: 0, failed: 0 }),
    listByIds: vi.fn().mockResolvedValue([]),
    scan: vi.fn().mockResolvedValue(undefined),
    setFavorite: vi.fn().mockResolvedValue(undefined),
    watch: vi.fn().mockResolvedValue(undefined),
    listIgnoredDuplicates: vi.fn().mockResolvedValue([]),
    clearIgnoredDuplicates: vi.fn().mockResolvedValue(0),
    onBatch: imageBatch.subscribe,
    onRemoved: imageRemoved.subscribe,
    onWatchDuplicate: imageWatchDuplicate.subscribe,
    revealInExplorer: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    computeHashes: vi.fn().mockResolvedValue(0),
    resetHashes: vi.fn().mockResolvedValue(undefined),
    similarGroups: vi.fn().mockResolvedValue([]),
    similarGroupForImage: vi.fn().mockResolvedValue(null),
    similarReasons: vi.fn().mockResolvedValue([]),
    onHashProgress: imageHashProgress.subscribe,
    onSimilarityProgress: imageSimilarityProgress.subscribe,
    onScanProgress: imageScanProgress.subscribe,
    onSearchStatsProgress: imageSearchStatsProgress.subscribe,
    cancelScan: vi.fn().mockResolvedValue(undefined),
    onScanFolder: imageScanFolder.subscribe,
    onDupCheckProgress: imageDupCheckProgress.subscribe,
    onScanPhase: imageScanPhase.subscribe,
    onRescanMetadataProgress: imageRescanMetadataProgress.subscribe,
    quickVerify: vi.fn().mockResolvedValue({
      changedFolderIds: [],
      unchangedFolderIds: [],
    }),
    onQuickVerifyProgress: vi.fn().mockReturnValue(() => {}),
    rescanMetadata: vi.fn().mockResolvedValue(0),
    rescanImageMetadata: vi.fn().mockResolvedValue(0),
  },
  dialog: {
    selectDirectory: vi.fn().mockResolvedValue(null),
    selectDirectories: vi.fn().mockResolvedValue(null),
  },
  folder: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    findDuplicates: vi.fn().mockResolvedValue([]),
    resolveDuplicates: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn(),
    revealInExplorer: vi.fn().mockResolvedValue(undefined),
    listSubdirectories: vi.fn().mockResolvedValue([]),
    listSubdirectoriesByPath: vi.fn().mockResolvedValue([]),
  },
  nai: {
    validateApiKey: vi.fn().mockResolvedValue({ valid: true, tier: "Scroll" }),
    getConfig: vi.fn().mockResolvedValue({ id: 1, apiKey: "" }),
    updateConfig: vi.fn().mockResolvedValue({ id: 1, apiKey: "" }),
    generate: vi.fn().mockResolvedValue("C:/output/generated.png"),
    getSubscription: vi
      .fn()
      .mockResolvedValue({ tier: "Scroll", anlas: 0, fixedAnlas: 0, purchasedAnlas: 0 }),
    onGeneratePreview: naiGeneratePreview.subscribe,
  },
  category: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn(),
    addImage: vi.fn().mockResolvedValue(undefined),
    removeImage: vi.fn().mockResolvedValue(undefined),
    addImages: vi.fn().mockResolvedValue(undefined),
    removeImages: vi.fn().mockResolvedValue(undefined),
    addByPrompt: vi.fn().mockResolvedValue(0),
    imageIds: vi.fn().mockResolvedValue([]),
    forImage: vi.fn().mockResolvedValue([]),
    commonForImages: vi.fn().mockResolvedValue([]),
    setColor: vi.fn().mockResolvedValue(undefined),
  },
};

function installPreloadMocks(): void {
  Object.assign(window, preloadMocks);
}

export function resetPreloadMocks(): void {
  preloadEvents.db.migrationProgress.reset();
  preloadEvents.image.batch.reset();
  preloadEvents.image.removed.reset();
  preloadEvents.image.watchDuplicate.reset();
  preloadEvents.image.hashProgress.reset();
  preloadEvents.image.similarityProgress.reset();
  preloadEvents.image.scanProgress.reset();
  preloadEvents.image.searchStatsProgress.reset();
  preloadEvents.image.scanFolder.reset();
  preloadEvents.image.dupCheckProgress.reset();
  preloadEvents.nai.generatePreview.reset();
  preloadEvents.appInfo.updateAvailable.reset();
  preloadEvents.appInfo.updateDownloaded.reset();

  preloadMocks.appInfo.isDevMode.mockReset().mockResolvedValue(false);
  preloadMocks.appInfo.get.mockReset().mockResolvedValue({
    appName: "Konomi",
    appVersion: "0.1.0",
    electronVersion: "39.0.0",
    chromeVersion: "139.0.0.0",
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
  });
  preloadMocks.appInfo.getLocale.mockReset().mockResolvedValue("en");
  preloadMocks.appInfo.getDbFileSize.mockReset().mockResolvedValue(null);
  preloadMocks.appInfo.getPromptsDbSchemaVersion
    .mockReset()
    .mockResolvedValue(null);
  preloadMocks.appInfo.checkForUpdates.mockReset().mockResolvedValue(undefined);
  preloadMocks.appInfo.installUpdate.mockReset().mockResolvedValue(undefined);
  preloadMocks.appInfo.onUpdateProgress.mockReset().mockReturnValue(() => {});
  preloadMocks.appInfo.onUtilityReset.mockReset().mockReturnValue(() => {});

  preloadMocks.promptBuilder.listCategories.mockReset().mockResolvedValue([]);
  preloadMocks.promptBuilder.suggestTags.mockReset().mockResolvedValue({
    suggestions: [],
    stats: { totalTags: 0, maxCount: 0, bucketThresholds: [] },
  });
  preloadMocks.promptBuilder.createCategory.mockReset();
  preloadMocks.promptBuilder.renameCategory.mockReset();
  preloadMocks.promptBuilder.deleteCategory.mockReset();
  preloadMocks.promptBuilder.resetCategories.mockReset();
  preloadMocks.promptBuilder.createGroup.mockReset();
  preloadMocks.promptBuilder.deleteGroup.mockReset();
  preloadMocks.promptBuilder.renameGroup.mockReset();
  preloadMocks.promptBuilder.createToken.mockReset();
  preloadMocks.promptBuilder.deleteToken.mockReset();
  preloadMocks.promptBuilder.reorderGroups.mockReset();
  preloadMocks.promptBuilder.reorderTokens.mockReset();
  preloadMocks.promptBuilder.searchTags.mockReset().mockResolvedValue({
    rows: [],
    totalCount: 0,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  });

  preloadMocks.image.readNaiMeta.mockReset().mockResolvedValue(null);
  preloadMocks.image.readMetaFromBuffer.mockReset().mockResolvedValue(null);
  preloadMocks.image.readFile.mockReset();
  preloadMocks.image.getSearchPresetStats.mockReset().mockResolvedValue({
    availableResolutions: [],
    availableModels: [],
  });
  preloadMocks.image.suggestTags.mockReset().mockResolvedValue([]);
  preloadMocks.image.listPage.mockReset().mockResolvedValue({
    rows: [],
    totalCount: 0,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  });
  preloadMocks.image.listMatchingIds.mockReset().mockResolvedValue([]);
  preloadMocks.image.bulkDelete
    .mockReset()
    .mockResolvedValue({ deleted: 0, failed: 0 });
  preloadMocks.image.listByIds.mockReset().mockResolvedValue([]);
  preloadMocks.image.scan.mockReset().mockResolvedValue(undefined);
  preloadMocks.image.setFavorite.mockReset().mockResolvedValue(undefined);
  preloadMocks.image.watch.mockReset().mockResolvedValue(undefined);
  preloadMocks.image.listIgnoredDuplicates.mockReset().mockResolvedValue([]);
  preloadMocks.image.clearIgnoredDuplicates.mockReset().mockResolvedValue(0);
  preloadMocks.image.revealInExplorer.mockReset().mockResolvedValue(undefined);
  preloadMocks.image.delete.mockReset().mockResolvedValue(undefined);
  preloadMocks.image.computeHashes.mockReset().mockResolvedValue(0);
  preloadMocks.image.resetHashes.mockReset().mockResolvedValue(undefined);
  preloadMocks.image.similarGroups.mockReset().mockResolvedValue([]);
  preloadMocks.image.similarGroupForImage.mockReset().mockResolvedValue(null);
  preloadMocks.image.similarReasons.mockReset().mockResolvedValue([]);
  preloadMocks.image.cancelScan.mockReset().mockResolvedValue(undefined);
  preloadMocks.image.quickVerify
    .mockReset()
    .mockResolvedValue({ changedFolderIds: [], unchangedFolderIds: [] });
  preloadMocks.image.rescanMetadata.mockReset().mockResolvedValue(0);
  preloadMocks.image.rescanImageMetadata.mockReset().mockResolvedValue(0);

  preloadMocks.db.runMigrations.mockReset().mockResolvedValue(undefined);

  preloadMocks.dialog.selectDirectory.mockReset().mockResolvedValue(null);
  preloadMocks.dialog.selectDirectories.mockReset().mockResolvedValue(null);


  preloadMocks.folder.list.mockReset().mockResolvedValue([]);
  preloadMocks.folder.create.mockReset();
  preloadMocks.folder.findDuplicates.mockReset().mockResolvedValue([]);
  preloadMocks.folder.resolveDuplicates
    .mockReset()
    .mockResolvedValue(undefined);
  preloadMocks.folder.delete.mockReset().mockResolvedValue(undefined);
  preloadMocks.folder.rename.mockReset();
  preloadMocks.folder.revealInExplorer.mockReset().mockResolvedValue(undefined);
  preloadMocks.folder.listSubdirectories.mockReset().mockResolvedValue([]);
  preloadMocks.folder.listSubdirectoriesByPath.mockReset().mockResolvedValue([]);

  preloadMocks.nai.validateApiKey.mockReset().mockResolvedValue({
    valid: true,
    tier: "Scroll",
  });
  preloadMocks.nai.getConfig
    .mockReset()
    .mockResolvedValue({ id: 1, apiKey: "" });
  preloadMocks.nai.updateConfig
    .mockReset()
    .mockResolvedValue({ id: 1, apiKey: "" });
  preloadMocks.nai.generate
    .mockReset()
    .mockResolvedValue("C:/output/generated.png");
  preloadMocks.nai.getSubscription
    .mockReset()
    .mockResolvedValue({ tier: "Scroll", anlas: 0, fixedAnlas: 0, purchasedAnlas: 0 });

  preloadMocks.category.list.mockReset().mockResolvedValue([]);
  preloadMocks.category.create.mockReset();
  preloadMocks.category.delete.mockReset().mockResolvedValue(undefined);
  preloadMocks.category.rename.mockReset();
  preloadMocks.category.addImage.mockReset().mockResolvedValue(undefined);
  preloadMocks.category.removeImage.mockReset().mockResolvedValue(undefined);
  preloadMocks.category.addImages.mockReset().mockResolvedValue(undefined);
  preloadMocks.category.removeImages.mockReset().mockResolvedValue(undefined);
  preloadMocks.category.addByPrompt.mockReset().mockResolvedValue(0);
  preloadMocks.category.imageIds.mockReset().mockResolvedValue([]);
  preloadMocks.category.forImage.mockReset().mockResolvedValue([]);
  preloadMocks.category.commonForImages.mockReset().mockResolvedValue([]);
  preloadMocks.category.setColor.mockReset().mockResolvedValue(undefined);

  installPreloadMocks();
}

installPreloadMocks();
