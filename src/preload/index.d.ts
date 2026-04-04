import type { ImageMeta } from "../renderer/src/types/image-meta";

export type { ImageMeta };
/** @deprecated Use ImageMeta instead */
export type NovelAIMeta = ImageMeta;

export type Folder = {
  id: number;
  name: string;
  path: string;
  createdAt: Date;
};

export type FolderDuplicateExistingEntry = {
  imageId: number;
  path: string;
  fileName: string;
};

export type FolderDuplicateIncomingEntry = {
  path: string;
  fileName: string;
};

export type FolderDuplicateGroup = {
  id: string;
  hash: string;
  previewPath: string;
  previewFileName: string;
  existingEntries: FolderDuplicateExistingEntry[];
  incomingEntries: FolderDuplicateIncomingEntry[];
};

export type FolderDuplicateGroupResolution = {
  id: string;
  hash: string;
  existingEntries: Array<{ imageId: number; path: string }>;
  incomingPaths: string[];
  keep: "existing" | "incoming" | "ignore";
};

export type ImageRow = {
  id: number;
  path: string;
  folderId: number;
  prompt: string;
  negativePrompt: string;
  characterPrompts: string;
  promptTokens: string;
  negativePromptTokens: string;
  characterPromptTokens: string;
  source: string;
  model: string;
  seed: number;
  width: number;
  height: number;
  sampler: string;
  steps: number;
  cfgScale: number;
  cfgRescale: number;
  noiseSchedule: string;
  varietyPlus: boolean;
  isFavorite: boolean;
  pHash: string;
  fileModifiedAt: Date;
  createdAt: Date;
};

export type ImageSortBy = "recent" | "oldest" | "favorites" | "name";
export type ImageBuiltinCategory = "favorites" | "random";

export type ImageListQuery = {
  page?: number;
  pageSize?: number;
  folderIds?: number[];
  searchQuery?: string;
  sortBy?: ImageSortBy;
  onlyRecent?: boolean;
  recentDays?: number;
  customCategoryId?: number | null;
  builtinCategory?: ImageBuiltinCategory | null;
  randomSeed?: number;
  resolutionFilters?: Array<{ width: number; height: number }>;
  modelFilters?: string[];
  seedFilters?: number[];
  excludeTags?: string[];
  subfolderFilters?: Array<{
    folderId: number;
    selectedPaths: string[];
    allPaths: string[];
    includeRoot?: boolean;
  }>;
};

export type ImageListResult = {
  rows: ImageRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type ImageSearchPresetStats = {
  availableResolutions: Array<{ width: number; height: number }>;
  availableModels: string[];
};

export type ImageTagSuggestQuery = {
  prefix: string;
  limit?: number;
  exclude?: string[];
};

export type ImageTagSuggestion = {
  tag: string;
  count: number;
};

export type SimilarGroup = { id: string; name: string; imageIds: number[] };
export type SimilarityReason = "visual" | "prompt" | "both";
export type SimilarityReasonItem = {
  imageId: number;
  reason: SimilarityReason;
  score: number;
};

export type Category = {
  id: number;
  name: string;
  isBuiltin: boolean;
  order: number;
  color: string | null;
};

export type PromptToken = {
  id: number;
  label: string;
  order: number;
  groupId: number;
};
export type PromptTagSearchQuery = {
  name?: string;
  sortBy?: "name" | "count";
  order?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

export type PromptTagSearchRow = {
  tag: string;
  postCount: number;
};

export type PromptTagSearchResult = {
  rows: PromptTagSearchRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type PromptTagSuggestQuery = {
  prefix: string;
  limit?: number;
  exclude?: string[];
};
export type PromptTagSuggestion = {
  tag: string;
  count: number;
};
export type PromptTagSuggestStats = {
  totalTags: number;
  maxCount: number;
  bucketThresholds: number[];
};
export type PromptTagSuggestResult = {
  suggestions: PromptTagSuggestion[];
  stats: PromptTagSuggestStats;
};
export type PromptGroup = {
  id: number;
  name: string;
  categoryId: number;
  order: number;
  tokens: PromptToken[];
};

export type PromptCategory = {
  id: number;
  name: string;
  isBuiltin: boolean;
  order: number;
  groups: PromptGroup[];
};

export type NaiConfig = {
  id: number;
  apiKey: string;
};

export type NaiSubscriptionInfo = {
  tier: string;
  anlas: number;
  fixedAnlas: number;
  purchasedAnlas: number;
};

export type GenerateParams = {
  prompt: string;
  negativePrompt?: string;
  characterPrompts?: string[];
  characterNegativePrompts?: string[];
  characterPositions?: string[];
  outputFolder?: string;
  model?: string;
  width?: number;
  height?: number;
  scale?: number;
  cfgRescale?: number;
  varietyPlus?: boolean;
  sampler?: string;
  steps?: number;
  seed?: number;
  noiseSchedule?: string;
  i2i?: { imageData: Uint8Array; strength: number; noise: number };
  vibes?: Array<{
    imageData: Uint8Array;
    infoExtracted: number;
    strength: number;
  }>;
  preciseRef?: { imageData: Uint8Array; fidelity: number };
};

export type AppInfo = {
  appName: string;
  appVersion: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
};

declare global {
  interface Window {
    appInfo: {
      isDevMode: () => Promise<boolean>;
      get: () => Promise<AppInfo>;
      getLocale: () => Promise<string>;
      getDbFileSize: () => Promise<number | null>;
      getPromptsDbSchemaVersion: () => Promise<number | null>;
      checkForUpdates: () => Promise<void>;
      installUpdate: () => Promise<void>;
      onUpdateAvailable: (
        cb: (info: { version: string; releaseUrl?: string }) => void,
      ) => () => void;
      onUpdateDownloaded: (
        cb: (info: { version: string }) => void,
      ) => () => void;
      onUpdateProgress: (cb: (data: { percent: number }) => void) => () => void;
      onUtilityReset: (cb: () => void) => () => void;
    };
    promptBuilder: {
      listCategories: () => Promise<PromptCategory[]>;
      suggestTags: (
        query: PromptTagSuggestQuery,
      ) => Promise<PromptTagSuggestResult>;
      createCategory: (name: string) => Promise<PromptCategory>;
      renameCategory: (id: number, name: string) => Promise<void>;
      deleteCategory: (id: number) => Promise<void>;
      resetCategories: () => Promise<void>;
      createGroup: (categoryId: number, name: string) => Promise<PromptGroup>;
      deleteGroup: (id: number) => Promise<void>;
      renameGroup: (id: number, name: string) => Promise<void>;
      createToken: (groupId: number, label: string) => Promise<PromptToken>;
      deleteToken: (id: number) => Promise<void>;
      reorderGroups: (categoryId: number, ids: number[]) => Promise<void>;
      reorderTokens: (groupId: number, ids: number[]) => Promise<void>;
      searchTags: (
        query: PromptTagSearchQuery,
      ) => Promise<PromptTagSearchResult>;
    };
    image: {
      readNaiMeta: (path: string) => Promise<ImageMeta | null>;
      readMetaFromBuffer: (data: Uint8Array) => Promise<ImageMeta | null>;
      readFile: (path: string) => Promise<Buffer>;
      getSearchPresetStats: () => Promise<ImageSearchPresetStats>;
      suggestTags: (
        query: ImageTagSuggestQuery,
      ) => Promise<ImageTagSuggestion[]>;
      listPage: (query: ImageListQuery) => Promise<ImageListResult>;
      listMatchingIds: (query: ImageListQuery) => Promise<number[]>;
      bulkDelete: (ids: number[]) => Promise<{ deleted: number; failed: number }>;
      listByIds: (ids: number[]) => Promise<ImageRow[]>;
      quickVerify: () => Promise<{
        changedFolderIds: number[];
        unchangedFolderIds: number[];
      }>;
      scan: (options?: {
        detectDuplicates?: boolean;
        folderIds?: number[];
        orderedFolderIds?: number[];
        skipFolderIds?: number[];
      }) => Promise<void>;
      setFavorite: (id: number, isFavorite: boolean) => Promise<void>;
      watch: () => Promise<void>;
      listIgnoredDuplicates: () => Promise<string[]>;
      clearIgnoredDuplicates: () => Promise<number>;
      onBatch: (cb: (images: ImageRow[]) => void) => () => void;
      onRemoved: (cb: (ids: number[]) => void) => () => void;
      onWatchDuplicate: (
        cb: (item: FolderDuplicateGroup) => void,
      ) => () => void;
      revealInExplorer: (path: string) => Promise<void>;
      delete: (path: string) => Promise<void>;
      computeHashes: () => Promise<number>;
      resetHashes: () => Promise<void>;
      rescanMetadata: () => Promise<number>;
      rescanImageMetadata: (paths: string[]) => Promise<number>;
      onRescanMetadataProgress: (
        cb: (data: { done: number; total: number }) => void,
      ) => () => void;
      similarGroups: (
        threshold: number,
        jaccardThreshold?: number,
      ) => Promise<SimilarGroup[]>;
      similarReasons: (
        imageId: number,
        candidateImageIds: number[],
        threshold: number,
        jaccardThreshold?: number,
      ) => Promise<SimilarityReasonItem[]>;
      onHashProgress: (
        cb: (data: { done: number; total: number }) => void,
      ) => () => void;
      onSimilarityProgress: (
        cb: (data: { done: number; total: number }) => void,
      ) => () => void;
      onScanProgress: (
        cb: (data: { done: number; total: number }) => void,
      ) => () => void;
      onScanPhase: (
        cb: (data: { phase: string }) => void,
      ) => () => void;
      onDupCheckProgress: (
        cb: (data: { done: number; total: number }) => void,
      ) => () => void;
      onSearchStatsProgress: (
        cb: (data: { done: number; total: number }) => void,
      ) => () => void;
      cancelScan: () => Promise<void>;
      onScanFolder: (
        cb: (data: {
          folderId: number;
          folderName?: string;
          active: boolean;
        }) => void,
      ) => () => void;
    };
    db: {
      runMigrations: () => Promise<void>;
      onMigrationProgress: (
        cb: (data: {
          done: number;
          total: number;
          migrationName: string;
        }) => void,
      ) => () => void;
    };
    dialog: {
      selectDirectory: () => Promise<string | null>;
      selectDirectories: () => Promise<string[] | null>;
    };
    folder: {
      list: () => Promise<Folder[]>;
      create: (name: string, path: string) => Promise<Folder>;
      findDuplicates: (path: string) => Promise<FolderDuplicateGroup[]>;
      resolveDuplicates: (
        resolutions: FolderDuplicateGroupResolution[],
      ) => Promise<void>;
      delete: (id: number) => Promise<void>;
      rename: (id: number, name: string) => Promise<Folder>;
      revealInExplorer: (idOrPath: number | string) => Promise<void>;
      listSubdirectories: (id: number) => Promise<string[]>;
      listSubdirectoriesByPath: (
        folderPath: string,
      ) => Promise<{ name: string; path: string }[]>;
    };
    nai: {
      validateApiKey: (
        apiKey: string,
      ) => Promise<{ valid: boolean; tier?: string; anlas?: number }>;
      getSubscription: () => Promise<NaiSubscriptionInfo>;
      getConfig: () => Promise<NaiConfig>;
      updateConfig: (patch: { apiKey?: string }) => Promise<NaiConfig>;
      generate: (params: GenerateParams) => Promise<string>;
      onGeneratePreview: (cb: (dataUrl: string) => void) => () => void;
    };
    category: {
      list: () => Promise<Category[]>;
      create: (name: string) => Promise<Category>;
      delete: (id: number) => Promise<void>;
      rename: (id: number, name: string) => Promise<Category>;
      addImage: (imageId: number, categoryId: number) => Promise<void>;
      removeImage: (imageId: number, categoryId: number) => Promise<void>;
      addImages: (imageIds: number[], categoryId: number) => Promise<void>;
      removeImages: (imageIds: number[], categoryId: number) => Promise<void>;
      addByPrompt: (categoryId: number, query: string) => Promise<number>;
      imageIds: (categoryId: number) => Promise<number[]>;
      forImage: (imageId: number) => Promise<number[]>;
      commonForImages: (imageIds: number[]) => Promise<number[]>;
      setColor: (id: number, color: string | null) => Promise<Category>;
    };
  }
}
