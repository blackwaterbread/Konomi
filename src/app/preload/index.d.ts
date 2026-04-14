// Re-export shared data types from the web frontend base
export type {
  ImageMeta,
  Folder,
  FolderStats,
  FolderDuplicateExistingEntry,
  FolderDuplicateIncomingEntry,
  FolderDuplicateGroup,
  FolderDuplicateGroupResolution,
  ImageRow,
  ImageSortBy,
  ImageBuiltinCategory,
  ImageListQuery,
  ImageListResult,
  ImageSearchPresetStats,
  ImageTagSuggestQuery,
  ImageTagSuggestion,
  SimilarGroup,
  SimilarityReason,
  SimilarityReasonItem,
  Category,
  PromptToken,
  PromptTagSearchQuery,
  PromptTagSearchRow,
  PromptTagSearchResult,
  PromptTagSuggestQuery,
  PromptTagSuggestion,
  PromptTagSuggestStats,
  PromptTagSuggestResult,
  PromptGroup,
  PromptCategory,
  NaiConfig,
  NaiSubscriptionInfo,
  GenerateParams,
  AppInfo,
} from "../../web/src/api/data-types";

/** @deprecated Use ImageMeta instead */
export type { ImageMeta as NovelAIMeta } from "../../web/src/api/data-types";

// Re-export API interface types for Window declaration
export type {
  KonomiApi,
  AppInfoApi,
  DbApi,
  DialogApi,
  FolderApi,
  ImageApi,
  CategoryApi,
  NaiApi,
  PromptBuilderApi,
} from "../../web/src/api/types";

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
      clearResourceCache: () => void;
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
      onQuickVerifyProgress: (
        cb: (data: { done: number; total: number }) => void,
      ) => () => void;
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
      similarGroupForImage: (
        imageId: number,
      ) => Promise<SimilarGroup | null>;
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
      stats: (id: number) => Promise<FolderStats | null>;
      size: (id: number) => Promise<number>;
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
