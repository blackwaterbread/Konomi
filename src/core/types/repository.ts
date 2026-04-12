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
}

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
  seedBuiltins(): Promise<void>;
}
