// ---------------------------------------------------------------------------
// Entity types (DB-agnostic row shapes)
// ---------------------------------------------------------------------------

export type FolderEntity = {
  id: number;
  name: string;
  path: string;
  createdAt: Date;
};

export type ImageEntity = {
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
  fileSize: number;
  fileModifiedAt: Date;
  createdAt: Date;
};

/** Lightweight projection for sync — skip heavy fields */
export type ImageSyncRow = {
  id: number;
  path: string;
  fileModifiedAt: Date;
  source: string;
};

export type CategoryEntity = {
  id: number;
  name: string;
  isBuiltin: boolean;
  order: number;
  color: string | null;
};

// ---------------------------------------------------------------------------
// Image upsert data (flat DB row shape, ready to write)
// ---------------------------------------------------------------------------

export type ImageUpsertData = {
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
  fileSize: number;
  fileModifiedAt: Date;
};

// ---------------------------------------------------------------------------
// Repository interfaces — consumers must implement these
// ---------------------------------------------------------------------------

export interface FolderRepository {
  findAll(): Promise<FolderEntity[]>;
  findById(id: number): Promise<FolderEntity | null>;
  create(name: string, path: string): Promise<FolderEntity>;
  delete(id: number): Promise<void>;
  rename(id: number, name: string): Promise<FolderEntity>;
}

export interface ImageRepository {
  findById(id: number): Promise<ImageEntity | null>;
  findByPath(path: string): Promise<ImageEntity | null>;

  /** Lightweight listing for sync: returns only id, path, mtime, source */
  findSyncRowsByFolderId(folderId: number): Promise<ImageSyncRow[]>;

  /** Batch upsert — returns full entities for event emission */
  upsertBatch(rows: ImageUpsertData[]): Promise<ImageEntity[]>;

  /** Single upsert (watcher use) */
  upsertByPath(data: ImageUpsertData): Promise<ImageEntity>;

  deleteByIds(ids: number[]): Promise<void>;
  deleteByPath(path: string): Promise<void>;
  countByFolderId(folderId: number): Promise<number>;
  existsByPath(path: string): Promise<boolean>;

  /** Update folder scan fingerprint */
  updateFolderScanMeta(
    folderId: number,
    fileCount: number,
    finishedAt: Date,
  ): Promise<void>;

  /** Paginated path listing for folder — used by subfolder extraction */
  getPathsByFolderId(
    folderId: number,
  ): Promise<Array<{ id: number; path: string }>>;

  /** Sum of fileSize for all images in a folder */
  sumFileSizeByFolderId(folderId: number): Promise<number>;

  /** Find image IDs whose prompt or characterPrompts contain the query */
  findIdsByPromptContaining(query: string): Promise<number[]>;

  /** Find images matching any of the given file sizes (for duplicate detection) */
  findByFileSize(
    sizes: number[],
  ): Promise<Array<{ id: number; path: string; fileSize: number }>>;

  /** Fetch search stat source fields for images at given paths */
  findSearchStatSourcesByPaths(
    paths: string[],
  ): Promise<Array<{ path: string } & SearchStatSource>>;

  /** Fetch search stat source fields for images with given IDs */
  findSearchStatSourcesByIds(ids: number[]): Promise<SearchStatSource[]>;
}

// ---------------------------------------------------------------------------
// NAI config entity & repository
// ---------------------------------------------------------------------------

export type NaiConfigEntity = {
  id: number;
  apiKey: string | null;
};

export interface NaiConfigRepository {
  get(): Promise<NaiConfigEntity>;
  update(patch: { apiKey?: string }): Promise<NaiConfigEntity>;
}

// ---------------------------------------------------------------------------
// Prompt builder entity types
// ---------------------------------------------------------------------------

export type PromptTokenEntity = {
  id: number;
  label: string;
  order: number;
  groupId: number;
};

export type PromptGroupEntity = {
  id: number;
  name: string;
  categoryId: number;
  order: number;
  tokens: PromptTokenEntity[];
};

export type PromptCategoryEntity = {
  id: number;
  name: string;
  isBuiltin: boolean;
  order: number;
  groups: PromptGroupEntity[];
};

// ---------------------------------------------------------------------------
// Prompt builder repository
// ---------------------------------------------------------------------------

export interface PromptBuilderRepository {
  listCategories(): Promise<PromptCategoryEntity[]>;
  createCategory(name: string): Promise<PromptCategoryEntity>;
  renameCategory(id: number, name: string): Promise<void>;
  deleteCategory(id: number): Promise<void>;
  resetCategories(defaults: Array<{ name: string; order: number }>): Promise<void>;
  createGroup(categoryId: number, name: string): Promise<PromptGroupEntity>;
  deleteGroup(id: number): Promise<void>;
  renameGroup(id: number, name: string): Promise<void>;
  createToken(groupId: number, label: string): Promise<PromptTokenEntity>;
  deleteToken(id: number): Promise<void>;
  reorderGroups(ids: number[]): Promise<void>;
  reorderTokens(ids: number[]): Promise<void>;
  seedDefaults(defaults: Array<{ name: string; order: number }>): Promise<void>;
}

// ---------------------------------------------------------------------------
// Search stats (lightweight projection for stat mutation tracking)
// ---------------------------------------------------------------------------

export type SearchStatSource = {
  width: number;
  height: number;
  model: string;
  promptTokens: string;
  negativePromptTokens: string;
  characterPromptTokens: string;
};

export type SearchStatMutation = {
  before: SearchStatSource | null;
  after: SearchStatSource | null;
};

// ---------------------------------------------------------------------------
// Image category repository
// ---------------------------------------------------------------------------

export interface CategoryRepository {
  findAll(): Promise<CategoryEntity[]>;
  findById(id: number): Promise<CategoryEntity | null>;
  create(name: string): Promise<CategoryEntity>;
  delete(id: number): Promise<void>;
  rename(id: number, name: string): Promise<CategoryEntity>;
  updateColor(id: number, color: string | null): Promise<CategoryEntity>;
  addImage(imageId: number, categoryId: number): Promise<void>;
  removeImage(imageId: number, categoryId: number): Promise<void>;
  addImages(imageIds: number[], categoryId: number): Promise<void>;
  removeImages(imageIds: number[], categoryId: number): Promise<void>;
  getImageIds(categoryId: number): Promise<number[]>;
  getCategoriesForImage(imageId: number): Promise<number[]>;
  getCommonCategoriesForImages(imageIds: number[]): Promise<number[]>;
  seedBuiltins(): Promise<void>;
}
