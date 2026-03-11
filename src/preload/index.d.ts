import type { NovelAIMeta } from "../renderer/src/types/nai";

export type { NovelAIMeta };

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

export type SimilarGroup = { id: string; name: string; imageIds: number[] };

export type Category = {
  id: number;
  name: string;
  isBuiltin: boolean;
  order: number;
};

export type PromptToken = {
  id: number;
  label: string;
  order: number;
  groupId: number;
};
export type PromptGroup = {
  id: number;
  name: string;
  type: string;
  order: number;
  tokens: PromptToken[];
};

export type NaiConfig = {
  id: number;
  apiKey: string;
};

export type GenerateParams = {
  prompt: string;
  negativePrompt?: string;
  characterPrompts?: string[];
  characterNegativePrompts?: string[];
  outputFolder?: string;
  model?: string;
  width?: number;
  height?: number;
  scale?: number;
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
      get: () => Promise<AppInfo>;
    };
    promptBuilder: {
      listGroups: () => Promise<PromptGroup[]>;
      createGroup: (name: string, type: string) => Promise<PromptGroup>;
      deleteGroup: (id: number) => Promise<void>;
      renameGroup: (id: number, name: string) => Promise<void>;
      reorderGroups: (ids: number[]) => Promise<void>;
      createToken: (groupId: number, label: string) => Promise<PromptToken>;
      deleteToken: (id: number) => Promise<void>;
      reorderTokens: (groupId: number, ids: number[]) => Promise<void>;
    };
    image: {
      readNaiMeta: (path: string) => Promise<NovelAIMeta | null>;
      readMetaFromBuffer: (data: Uint8Array) => Promise<NovelAIMeta | null>;
      readFile: (path: string) => Promise<Buffer>;
      list: () => Promise<ImageRow[]>;
      getSearchPresetStats: () => Promise<ImageSearchPresetStats>;
      listPage: (query: ImageListQuery) => Promise<ImageListResult>;
      listByIds: (ids: number[]) => Promise<ImageRow[]>;
      scan: (options?: {
        detectDuplicates?: boolean;
        orderedFolderIds?: number[];
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
      similarGroups: (threshold: number) => Promise<SimilarGroup[]>;
      onHashProgress: (
        cb: (data: { done: number; total: number }) => void,
      ) => () => void;
      onScanProgress: (
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
    dialog: {
      selectDirectory: () => Promise<string | null>;
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
    };
    nai: {
      getConfig: () => Promise<NaiConfig>;
      updateConfig: (patch: { apiKey?: string }) => Promise<NaiConfig>;
      generate: (params: GenerateParams) => Promise<string>;
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
    };
  }
}
