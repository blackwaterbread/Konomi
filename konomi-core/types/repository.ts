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
  seed: string;
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
  seed: string;
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
// Metadata update entry (for rescan operations)
// ---------------------------------------------------------------------------

export type ImageMetadataUpdateEntry = {
  path: string;
  prompt: string;
  negativePrompt: string;
  characterPrompts: string;
  promptTokens: string;
  negativePromptTokens: string;
  characterPromptTokens: string;
  source: string;
  model: string;
  seed: string;
  width: number;
  height: number;
  sampler: string;
  steps: number;
  cfgScale: number;
  cfgRescale: number;
  noiseSchedule: string;
  varietyPlus: boolean;
};

// ---------------------------------------------------------------------------
// NAI config entity
// ---------------------------------------------------------------------------

export type NaiConfigEntity = {
  id: number;
  apiKey: string | null;
};

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

