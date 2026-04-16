// ---------------------------------------------------------------------------
// Image listing / query types (DB-agnostic)
// ---------------------------------------------------------------------------

export type ImageSortBy = "recent" | "oldest" | "favorites" | "name";
export type ImageBuiltinCategory = "favorites" | "random";

export type ImageQueryResolutionFilter = {
  width: number;
  height: number;
};

export type SubfolderFilter = {
  folderId: number;
  selectedPaths: string[];
  allPaths: string[];
  includeRoot: boolean;
};

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
  resolutionFilters?: ImageQueryResolutionFilter[];
  modelFilters?: string[];
  seedFilters?: string[];
  excludeTags?: string[];
  subfolderFilters?: Array<{
    folderId: number;
    selectedPaths: string[];
    allPaths: string[];
    includeRoot?: boolean;
  }>;
};

export type ImageListResult = {
  rows: ImageEntity[];
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

// Re-import to use in ImageListResult
import type { ImageEntity } from "./repository";
