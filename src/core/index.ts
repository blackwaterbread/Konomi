// Types
export type { ImageMeta } from "./types/image-meta";

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
  FolderRepository,
  ImageRepository,
  CategoryRepository,
  PromptBuilderRepository,
  NaiConfigEntity,
  NaiConfigRepository,
  SearchStatSource,
  SearchStatMutation,
} from "./types/repository";

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
export { readNaiMeta, readNaiMetaFromBuffer, readNaiMetaFromPngText } from "./lib/nai";
export { readWebuiMeta, readWebuiMetaFromBuffer } from "./lib/webui";
export { readMidjourneyMeta, readMidjourneyMetaFromBuffer } from "./lib/midjourney";
export { readComfyuiMeta, readComfyuiMetaFromBuffer } from "./lib/comfyui";

// PNG helpers
export { readPngTextChunks, readPngSize } from "./lib/png-meta";

// File scanner
export { walkImageFiles, scanImageFiles, countImageFiles, verifyImageFolder, withConcurrency } from "./lib/scanner";
export type { CancelToken } from "./lib/scanner";

// Logger
export { createLogger } from "./lib/logger";
export type { Logger } from "./lib/logger";

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
export type { WatchService, WatchServiceDeps } from "./services/watch-service";

export { createPromptBuilderService } from "./services/prompt-builder-service";
export { createNaiGenService } from "./services/nai-gen-service";
export type { PromptBuilderService, PromptBuilderServiceDeps } from "./services/prompt-builder-service";

export type { NaiGenService, NaiGenServiceDeps, NaiConfigPatch, GenerateParams, I2IRef, VibeRef, PreciseRef } from "./services/nai-gen-service";

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
