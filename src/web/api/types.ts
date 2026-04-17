// ---------------------------------------------------------------------------
// KonomiApi — platform-agnostic API interface
// ---------------------------------------------------------------------------
// Electron: implemented via IPC (preload/contextBridge)
// Browser:  implemented via HTTP fetch + WebSocket
//
// Extracted from preload/index.d.ts Window global declarations.
// Shared data types (ImageRow, Folder, etc.) are re-exported from preload
// types so both implementations and consumers use the same shapes.
// ---------------------------------------------------------------------------

import type {
  ImageMeta,
  Folder,
  FolderStats,
  FolderDuplicateGroup,
  FolderDuplicateGroupResolution,
  ImageRow,
  ImageListQuery,
  ImageListResult,
  ImageSearchPresetStats,
  ImageTagSuggestQuery,
  ImageTagSuggestion,
  SimilarGroup,
  SimilarityReasonItem,
  Category,
  PromptCategory,
  PromptGroup,
  PromptToken,
  PromptTagSuggestQuery,
  PromptTagSuggestResult,
  PromptTagSearchQuery,
  PromptTagSearchResult,
  NaiConfig,
  NaiSubscriptionInfo,
  GenerateParams,
  AppInfo,
} from "./data-types";

// ── AppInfo API ────────────────────────────────────────────────

export interface AppInfoApi {
  isElectron: boolean;
  isDevMode(): Promise<boolean>;
  get(): Promise<AppInfo>;
  getLocale(): Promise<string>;
  getDbFileSize(): Promise<number | null>;
  getPromptsDbSchemaVersion(): Promise<number | null>;
  checkForUpdates(): Promise<void>;
  installUpdate(): Promise<void>;
  onUpdateAvailable(cb: (info: { version: string; releaseUrl?: string }) => void): () => void;
  onUpdateDownloaded(cb: (info: { version: string }) => void): () => void;
  onUpdateProgress(cb: (data: { percent: number }) => void): () => void;
  onUtilityReset(cb: () => void): () => void;
  clearResourceCache(): void;
}

// ── DB API ─────────────────────────────────────────────────────

export interface DbApi {
  runMigrations(): Promise<void>;
  onMigrationProgress(
    cb: (data: { done: number; total: number; migrationName: string }) => void,
  ): () => void;
}

// ── Dialog API ─────────────────────────────────────────────────

export interface DialogApi {
  selectDirectory(): Promise<string | null>;
  selectDirectories(): Promise<string[] | null>;
}

// ── Folder API ─────────────────────────────────────────────────

export interface FolderApi {
  list(): Promise<Folder[]>;
  create(name: string, path: string): Promise<Folder>;
  findDuplicates(path: string): Promise<FolderDuplicateGroup[]>;
  resolveDuplicates(resolutions: FolderDuplicateGroupResolution[]): Promise<void>;
  delete(id: number): Promise<void>;
  rename(id: number, name: string): Promise<Folder>;
  revealInExplorer(idOrPath: number | string): Promise<void>;
  listSubdirectories(id: number): Promise<string[]>;
  listSubdirectoriesByPath(folderPath: string): Promise<{ name: string; path: string }[]>;
  stats(id: number): Promise<FolderStats | null>;
  size(id: number): Promise<number>;
  availableDirectories(): Promise<{ name: string; path: string }[]>;
}

// ── Image API ──────────────────────────────────────────────────

type ProgressCallback = (data: { done: number; total: number }) => void;

export interface ImageApi {
  readNaiMeta(path: string): Promise<ImageMeta | null>;
  readMetaFromBuffer(data: Uint8Array): Promise<ImageMeta | null>;
  readFile(path: string): Promise<Uint8Array>;
  getSearchPresetStats(): Promise<ImageSearchPresetStats>;
  suggestTags(query: ImageTagSuggestQuery): Promise<ImageTagSuggestion[]>;
  listPage(query: ImageListQuery): Promise<ImageListResult>;
  listMatchingIds(query: ImageListQuery): Promise<number[]>;
  bulkDelete(ids: number[]): Promise<{ deleted: number; failed: number }>;
  listByIds(ids: number[]): Promise<ImageRow[]>;
  quickVerify(): Promise<{ changedFolderIds: number[]; unchangedFolderIds: number[] }>;
  scan(options?: {
    detectDuplicates?: boolean;
    folderIds?: number[];
    orderedFolderIds?: number[];
    skipFolderIds?: number[];
  }): Promise<void>;
  setFavorite(id: number, isFavorite: boolean): Promise<void>;
  watch(): Promise<void>;
  listIgnoredDuplicates(): Promise<string[]>;
  clearIgnoredDuplicates(): Promise<number>;
  revealInExplorer(path: string): Promise<void>;
  delete(path: string): Promise<void>;
  computeHashes(): Promise<number>;
  resetHashes(): Promise<void>;
  rescanMetadata(): Promise<number>;
  rescanImageMetadata(paths: string[]): Promise<number>;
  similarGroups(threshold: number, jaccardThreshold?: number): Promise<SimilarGroup[]>;
  similarGroupForImage(imageId: number): Promise<SimilarGroup | null>;
  similarReasons(
    imageId: number,
    candidateImageIds: number[],
    threshold: number,
    jaccardThreshold?: number,
  ): Promise<SimilarityReasonItem[]>;
  cancelScan(): Promise<void>;

  // Push event subscriptions
  onBatch(cb: (images: ImageRow[]) => void): () => void;
  onRemoved(cb: (ids: number[]) => void): () => void;
  onWatchDuplicate(cb: (item: FolderDuplicateGroup) => void): () => void;
  onQuickVerifyProgress(cb: ProgressCallback): () => void;
  onHashProgress(cb: ProgressCallback): () => void;
  onSimilarityProgress(cb: ProgressCallback): () => void;
  onScanProgress(cb: ProgressCallback): () => void;
  onScanPhase(cb: (data: { phase: string }) => void): () => void;
  onDupCheckProgress(cb: ProgressCallback): () => void;
  onSearchStatsProgress(cb: ProgressCallback): () => void;
  onRescanMetadataProgress(cb: ProgressCallback): () => void;
  onScanFolder(cb: (data: { folderId: number; folderName?: string; active: boolean }) => void): () => void;
}

// ── Category API ───────────────────────────────────────────────

export interface CategoryApi {
  list(): Promise<Category[]>;
  create(name: string): Promise<Category>;
  delete(id: number): Promise<void>;
  rename(id: number, name: string): Promise<Category>;
  addImage(imageId: number, categoryId: number): Promise<void>;
  removeImage(imageId: number, categoryId: number): Promise<void>;
  addImages(imageIds: number[], categoryId: number): Promise<void>;
  removeImages(imageIds: number[], categoryId: number): Promise<void>;
  addByPrompt(categoryId: number, query: string): Promise<number>;
  imageIds(categoryId: number): Promise<number[]>;
  forImage(imageId: number): Promise<number[]>;
  commonForImages(imageIds: number[]): Promise<number[]>;
  setColor(id: number, color: string | null): Promise<Category>;
}

// ── NAI API ────────────────────────────────────────────────────

export interface NaiApi {
  validateApiKey(apiKey: string): Promise<{ valid: boolean; tier?: string; anlas?: number }>;
  getSubscription(): Promise<NaiSubscriptionInfo>;
  getConfig(): Promise<NaiConfig>;
  updateConfig(patch: { apiKey?: string }): Promise<NaiConfig>;
  generate(params: GenerateParams): Promise<string>;
  onGeneratePreview(cb: (dataUrl: string) => void): () => void;
}

// ── PromptBuilder API ──────────────────────────────────────────

export interface PromptBuilderApi {
  listCategories(): Promise<PromptCategory[]>;
  suggestTags(query: PromptTagSuggestQuery): Promise<PromptTagSuggestResult>;
  createCategory(name: string): Promise<PromptCategory>;
  renameCategory(id: number, name: string): Promise<void>;
  deleteCategory(id: number): Promise<void>;
  resetCategories(): Promise<void>;
  createGroup(categoryId: number, name: string): Promise<PromptGroup>;
  deleteGroup(id: number): Promise<void>;
  renameGroup(id: number, name: string): Promise<void>;
  createToken(groupId: number, label: string): Promise<PromptToken>;
  deleteToken(id: number): Promise<void>;
  reorderGroups(categoryId: number, ids: number[]): Promise<void>;
  reorderTokens(groupId: number, ids: number[]): Promise<void>;
  searchTags(query: PromptTagSearchQuery): Promise<PromptTagSearchResult>;
}

// ── Aggregate ──────────────────────────────────────────────────

export interface KonomiApi {
  appInfo: AppInfoApi;
  db: DbApi;
  dialog: DialogApi;
  folder: FolderApi;
  image: ImageApi;
  category: CategoryApi;
  nai: NaiApi;
  promptBuilder: PromptBuilderApi;
}
