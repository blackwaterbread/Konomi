// Types
export type { ImageMeta } from "./types/image-meta";
export type {
  ImageListQuery,
  ImageListResult,
  ImageSortBy,
  ImageBuiltinCategory,
  ImageQueryResolutionFilter,
  SubfolderFilter,
  ImageSearchPresetStats,
  ImageTagSuggestQuery,
  ImageTagSuggestion,
} from "./types/image-query";

// Repository interfaces (DB layer contract)
export type {
  FolderEntity,
  ImageEntity,
  ImageSyncRow,
  ImageUpsertData,
  CategoryEntity,
  PromptTokenEntity,
  PromptGroupEntity,
  PromptCategoryEntity,
  NaiConfigEntity,
  SearchStatSource,
  SearchStatMutation,
} from "./types/repository";

// Repository concrete types
export type { FolderRepo } from "./lib/repositories/prisma-folder-repo";
export type { ImageRepo } from "./lib/repositories/prisma-image-repo";
export type { CategoryRepo } from "./lib/repositories/prisma-category-repo";
export type { NaiConfigRepo } from "./lib/repositories/prisma-nai-config-repo";
export type { PromptRepo } from "./lib/repositories/prisma-prompt-repo";

// Event sender interface (communication layer contract)
export type {
  EventSender,
  ScanProgressEvent,
  ScanFolderEvent,
  ImageBatchEvent,
  ImageRemovedEvent,
  KonomiEventMap,
} from "./types/event-sender";

// Token parsing
export { parsePromptTokens } from "./lib/token";
export type { PromptToken } from "./lib/token";

// Image metadata parsers
export { readImageMeta, readImageMetaFromBuffer } from "./lib/image-meta";
export { readNaiMeta, readNaiMetaFromBuffer, readNaiMetaFromPngText, readNaiMetaFromWebp } from "./lib/nai";
export { readWebuiMeta, readWebuiMetaFromBuffer } from "./lib/webui";
export { readMidjourneyMeta, readMidjourneyMetaFromBuffer } from "./lib/midjourney";
export { readComfyuiMeta, readComfyuiMetaFromBuffer } from "./lib/comfyui";

// PNG helpers
export { readPngTextChunks, readPngSize } from "./lib/png-meta";

// Native addon wrappers
export { computePHash, computeAllPairs, extractNaiLsb, resizePng } from "./lib/konomi-image";
export type { AllPairsInput, AllPairsResult, ResizePngResult } from "./lib/konomi-image";
export { decodeWebpAlpha, decodeWebpRgb, resizeWebp } from "./lib/webp-alpha";
export type { WebpResizeResult } from "./lib/webp-alpha";

// File scanner
export { walkImageFiles, scanImageFiles, countImageFiles, verifyImageFolder, withConcurrency } from "./lib/scanner";
export type { CancelToken } from "./lib/scanner";

// Logger
export { createLogger } from "./lib/logger";
export type { Logger } from "./lib/logger";

// Worker pool
export { WorkerPool } from "./lib/worker-pool";
export type { WorkerPoolOptions } from "./lib/worker-pool";

// Services
export { createScanService, classifyFolderFiles } from "./services/scan-service";
export type {
  ScanService,
  ScanServiceDeps,
  ScanOptions,
  ScanPhase,
  ClassifyResult,
  QuickVerifyResult,
  FolderDuplicateExistingEntry,
  FolderDuplicateIncomingEntry,
  FolderDuplicateGroup,
  FolderDuplicateGroupResolution,
  SearchStatsAdapter,
  IgnoredDuplicateAdapter,
  SimilarityCacheAdapter,
} from "./services/scan-service";

export { createFolderService } from "./services/folder-service";
export type { FolderService, FolderServiceDeps, FolderStats } from "./services/folder-service";

export { createCategoryService } from "./services/category-service";
export type { CategoryService, CategoryServiceDeps } from "./services/category-service";

export { createWatchService } from "./services/watch-service";
export type {
  WatchService,
  WatchServiceDeps,
  WatchSearchStatsAdapter,
  WatchDuplicateDetectionAdapter,
  WatchSimilarityCacheAdapter,
} from "./services/watch-service";

export { createImageService } from "./services/image-service";
export type { ImageService, ImageServiceDeps } from "./services/image-service";

export { createDuplicateService } from "./services/duplicate-service";
export type {
  DuplicateService,
  DuplicateServiceDeps,
} from "./services/duplicate-service";

export { createPromptTagService, normalizePromptTerm } from "./services/prompt-tag-service";
export type {
  PromptTagService,
  PromptTagServiceDeps,
  PromptTagSearchQuery,
  PromptTagSearchRow,
  PromptTagSearchResult,
  PromptTagSuggestQuery,
  PromptTagSuggestion,
  PromptTagSuggestStats,
  PromptTagSuggestResult,
} from "./services/prompt-tag-service";

export { createPromptBuilderService } from "./services/prompt-builder-service";
export { createNaiGenService } from "./services/nai-gen-service";
export type { PromptBuilderService, PromptBuilderServiceDeps } from "./services/prompt-builder-service";

export type { NaiGenService, NaiGenServiceDeps, NaiConfigPatch, GenerateParams, I2IRef, VibeRef, PreciseRef } from "./services/nai-gen-service";

// Search stats (pure logic)
export {
  buildStatDeltasFromMutations,
  collectTokenCountMap,
  extractTokenTexts,
  normalizeTagSuggestionText,
  normalizeTagSuggestionCandidates,
  normalizeSuggestLimit,
  normalizeExcludedTagKeys,
  mergeAndSortTagSuggestions,
  MIN_TAG_CONTAINS_QUERY_LENGTH,
} from "./lib/search-stats";
export type {
  SearchStatDelta,
  SearchStatMutationInput,
  TagSuggestion,
} from "./lib/search-stats";

// Similarity algorithms
export {
  clamp01,
  hammingDistance,
  parseTokenSet,
  sumTokenWeights,
  weightedIntersection,
  weightedJaccardFromIntersection,
  computeTextScore,
  computeHybridScore,
  shouldPersistCachePair,
  shouldLinkAtThreshold,
  classifyReasonAtThreshold,
  getThresholdConfig,
  resolveThresholdConfig,
  HYBRID_PHASH_WEIGHT,
  HYBRID_TEXT_WEIGHT,
  CONFLICT_PENALTY_WEIGHT,
  UI_THRESHOLD_MIN,
  UI_THRESHOLD_MAX,
} from "./lib/similarity";
export type {
  SimilarityThresholdConfig,
  SimilarityImage,
  SimilarityCacheRow,
  SimilarityReason,
  SimilarityReasonItem,
} from "./lib/similarity";

// Similarity service
export { createSimilarityService } from "./services/similarity-service";
export type {
  SimilarityService,
  SimilarityServiceDeps,
  SimilarGroup,
} from "./services/similarity-service";

// Maintenance service
export { createMaintenanceService } from "./services/maintenance-service";
export type {
  MaintenanceService,
  MaintenanceServiceDeps,
} from "./services/maintenance-service";
