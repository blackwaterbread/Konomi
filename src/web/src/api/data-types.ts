// ---------------------------------------------------------------------------
// Shared data types used across the API boundary.
// Both Electron (preload) and Browser (HTTP client) implementations use these.
// ---------------------------------------------------------------------------

import type { ImageMeta } from "@/types/image-meta";

export type { ImageMeta };

export type Folder = {
  id: number;
  name: string;
  path: string;
  createdAt: Date;
};

export type FolderStats = {
  path: string;
  imageCount: number;
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
  promptTokens?: string;
  negativePromptTokens?: string;
  characterPromptTokens?: string;
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
