import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import { Worker } from "worker_threads";
import { getDB, getRawDB } from "./db";
import { getFolders } from "./folder";
import { scanImageFiles, walkImageFiles, countImageFiles, withConcurrency } from "./scanner";
import type { CancelToken } from "./scanner";
import { parsePromptTokens } from "./token";
import { deleteSimilarityCacheForImageIds } from "./phash";
import type { ImageMeta } from "@/types/image-meta";
import type { Prisma } from "../../generated/prisma/client";

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
  fileSize: number;
  fileModifiedAt: Date;
  createdAt: Date;
};

const IMAGE_LIST_PAGE_SELECT = {
  id: true,
  path: true,
  folderId: true,
  prompt: true,
  negativePrompt: true,
  characterPrompts: true,
  promptTokens: true,
  negativePromptTokens: true,
  characterPromptTokens: true,
  source: true,
  model: true,
  seed: true,
  width: true,
  height: true,
  sampler: true,
  steps: true,
  cfgScale: true,
  cfgRescale: true,
  noiseSchedule: true,
  varietyPlus: true,
  isFavorite: true,
  pHash: true,
  fileSize: true,
  fileModifiedAt: true,
  createdAt: true,
} as const satisfies Prisma.ImageSelect;

export type ImageSortBy = "recent" | "oldest" | "favorites" | "name";
export type ImageBuiltinCategory = "favorites" | "random";

export type ImageQueryResolutionFilter = {
  width: number;
  height: number;
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
  keep: "existing" | "incoming" | "ignore";
  existingEntries: Array<{ imageId: number; path: string }>;
  incomingPaths: string[];
};

// ── Worker pool ───────────────────────────────────────────────
const POOL_SIZE = 4;
const BATCH_SIZE = 20;
const WORKER_PATH = path.join(__dirname, "nai.worker.js");
const CPU_COUNT = Math.max(2, os.cpus().length || 4);
const SIZE_SCAN_CONCURRENCY = Math.min(32, Math.max(8, CPU_COUNT * 2));
const HASH_SCAN_CONCURRENCY = Math.min(
  12,
  Math.max(4, Math.ceil(CPU_COUNT * 1.5)),
);
const SYNC_SCAN_CONCURRENCY = Math.min(24, Math.max(8, CPU_COUNT * 2));

class WorkerPool {
  private idle: Worker[] = [];
  private queue: Array<{
    filePath: string;
    resolve: (r: ImageMeta | null) => void;
  }> = [];
  private callbacks = new Map<number, (r: ImageMeta | null) => void>();
  private workerTask = new Map<Worker, number>();
  private seq = 0;

  constructor(size: number, workerPath: string) {
    for (let i = 0; i < size; i++) this.addWorker(workerPath);
  }

  private addWorker(workerPath: string): void {
    const w = new Worker(workerPath);
    w.on(
      "message",
      ({ id, result }: { id: number; result: ImageMeta | null }) => {
        this.workerTask.delete(w);
        this.callbacks.get(id)?.(result);
        this.callbacks.delete(id);
        this.dispatch(w);
      },
    );
    w.on("error", () => {
      const id = this.workerTask.get(w);
      this.workerTask.delete(w);
      if (id !== undefined) {
        this.callbacks.get(id)?.(null);
        this.callbacks.delete(id);
      }
      w.terminate().catch(() => {});
      this.addWorker(workerPath);
      this.flush();
    });
    this.idle.push(w);
    this.flush();
  }

  private dispatch(w: Worker): void {
    const next = this.queue.shift();
    if (!next) {
      this.idle.push(w);
      return;
    }
    const id = this.seq++;
    this.callbacks.set(id, next.resolve);
    this.workerTask.set(w, id);
    w.postMessage({ id, filePath: next.filePath });
  }

  private flush(): void {
    while (this.queue.length > 0 && this.idle.length > 0) {
      this.dispatch(this.idle.shift()!);
    }
  }

  run(filePath: string): Promise<ImageMeta | null> {
    return new Promise((resolve) => {
      this.queue.push({ filePath, resolve });
      this.flush();
    });
  }
}

const naiPool = new WorkerPool(POOL_SIZE, WORKER_PATH);

async function fileHash(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finalize = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const hash = crypto.createHash("sha1");
    const stream = fs.createReadStream(filePath);
    stream.on("error", () => finalize(null));
    stream.on("data", (chunk: string | Buffer) => {
      hash.update(chunk);
    });
    stream.on("end", () => {
      try {
        finalize(hash.digest("hex"));
      } catch {
        finalize(null);
      }
    });
  });
}

async function fileSize(filePath: string): Promise<number | null> {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

type ExistingSignatureBuckets = Map<string, FolderDuplicateExistingEntry[]>;

type ExistingSizeBuckets = Map<number, FolderDuplicateExistingEntry[]>;
type IncomingSizeBuckets = Map<number, FolderDuplicateIncomingEntry[]>;

async function buildExistingSizeBuckets(
  candidateFileSizes: number[],
  signal?: CancelToken,
): Promise<ExistingSizeBuckets> {
  if (candidateFileSizes.length === 0) return new Map();
  const rawDb = getRawDB();
  const buckets: ExistingSizeBuckets = new Map();
  // Query only existing images whose fileSize matches one of the candidate sizes
  const CHUNK = 500;
  for (let i = 0; i < candidateFileSizes.length; i += CHUNK) {
    if (signal?.cancelled) break;
    const chunk = candidateFileSizes.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = rawDb
      .prepare(
        `SELECT id, path, fileSize FROM "Image" WHERE fileSize IN (${placeholders})`,
      )
      .all(...chunk) as Array<{ id: number; path: string; fileSize: number }>;
    for (const row of rows) {
      const bucket = buckets.get(row.fileSize) ?? [];
      bucket.push({
        imageId: row.id,
        path: row.path,
        fileName: path.basename(row.path),
      });
      buckets.set(row.fileSize, bucket);
    }
  }
  return buckets;
}

async function buildIncomingSizeBuckets(
  incomingPaths: string[],
  signal?: CancelToken,
): Promise<IncomingSizeBuckets> {
  const buckets: IncomingSizeBuckets = new Map();
  await withConcurrency(
    incomingPaths,
    SIZE_SCAN_CONCURRENCY,
    async (incomingPath) => {
      const size = await fileSize(incomingPath);
      if (size === null) return;
      const bucket = buckets.get(size) ?? [];
      bucket.push({
        path: incomingPath,
        fileName: path.basename(incomingPath),
      });
      buckets.set(size, bucket);
    },
    signal,
  );
  return buckets;
}

function collectCandidateSizes(
  incomingSizeBuckets: IncomingSizeBuckets,
  existingSizeBuckets: ExistingSizeBuckets,
): number[] {
  const sizes: number[] = [];
  for (const [size, incomingEntries] of incomingSizeBuckets.entries()) {
    const existingEntries = existingSizeBuckets.get(size) ?? [];
    if (incomingEntries.length > 1 || existingEntries.length > 0) {
      sizes.push(size);
    }
  }
  return sizes;
}

async function buildIncomingSignatureBuckets(
  incomingSizeBuckets: IncomingSizeBuckets,
  candidateSizes: number[],
  signal?: CancelToken,
  onItemDone?: () => void,
): Promise<Map<string, FolderDuplicateIncomingEntry[]>> {
  const buckets = new Map<string, FolderDuplicateIncomingEntry[]>();
  const targets = candidateSizes.flatMap((size) =>
    (incomingSizeBuckets.get(size) ?? []).map((entry) => ({ size, entry })),
  );
  await withConcurrency(
    targets,
    HASH_SCAN_CONCURRENCY,
    async ({ size, entry }) => {
      const hash = await fileHash(entry.path);
      onItemDone?.();
      if (!hash) return;
      const signature = `${size}:${hash}`;
      const bucket = buckets.get(signature) ?? [];
      bucket.push(entry);
      buckets.set(signature, bucket);
    },
    signal,
  );
  return buckets;
}

async function buildExistingSignatureBuckets(
  existingSizeBuckets: ExistingSizeBuckets,
  candidateSizes: number[],
  signal?: CancelToken,
  onItemDone?: () => void,
): Promise<ExistingSignatureBuckets> {
  const buckets: ExistingSignatureBuckets = new Map();
  const targets = candidateSizes.flatMap((size) =>
    (existingSizeBuckets.get(size) ?? []).map((entry) => ({ size, entry })),
  );
  await withConcurrency(
    targets,
    HASH_SCAN_CONCURRENCY,
    async ({ size, entry }) => {
      const hash = await fileHash(entry.path);
      onItemDone?.();
      if (!hash) return;
      const signature = `${size}:${hash}`;
      const bucket = buckets.get(signature) ?? [];
      bucket.push(entry);
      buckets.set(signature, bucket);
    },
    signal,
  );
  return buckets;
}

function buildDuplicateGroupsFromBuckets(
  incomingBuckets: Map<string, FolderDuplicateIncomingEntry[]>,
  existingBuckets: ExistingSignatureBuckets,
  incomingPathSet: Set<string>,
): FolderDuplicateGroup[] {
  const groups: FolderDuplicateGroup[] = [];
  for (const [signature, incomingEntries] of incomingBuckets.entries()) {
    const existingEntries = (existingBuckets.get(signature) ?? []).filter(
      (entry) => !incomingPathSet.has(entry.path),
    );
    const hasCrossDuplicate =
      existingEntries.length > 0 && incomingEntries.length > 0;
    const hasIncomingOnlyDuplicate = incomingEntries.length > 1;
    if (!hasCrossDuplicate && !hasIncomingOnlyDuplicate) continue;

    const hash = signature.split(":")[1] ?? signature;
    const previewEntry = existingEntries[0] ?? incomingEntries[0];
    if (!previewEntry) continue;

    groups.push({
      id: signature,
      hash,
      previewPath: previewEntry.path,
      previewFileName: previewEntry.fileName,
      existingEntries,
      incomingEntries,
    });
  }
  return groups;
}

const ignoredDuplicatePaths = new Set<string>();
let ignoredDuplicatePathsLoaded = false;
let ignoredDuplicatePathsLoading: Promise<void> | null = null;

export async function ensureIgnoredDuplicatePathsLoaded(): Promise<void> {
  if (ignoredDuplicatePathsLoaded) return;
  if (ignoredDuplicatePathsLoading) {
    await ignoredDuplicatePathsLoading;
    return;
  }

  const db = getDB();
  ignoredDuplicatePathsLoading = (async () => {
    const rows = await db.ignoredDuplicatePath.findMany({
      select: { path: true },
    });
    rows.forEach((row) => ignoredDuplicatePaths.add(row.path));
    ignoredDuplicatePathsLoaded = true;
  })();

  try {
    await ignoredDuplicatePathsLoading;
  } finally {
    ignoredDuplicatePathsLoading = null;
  }
}

export async function registerIgnoredDuplicatePaths(
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;
  await ensureIgnoredDuplicatePathsLoaded();
  const newPaths = paths.filter((p) => !ignoredDuplicatePaths.has(p));
  if (newPaths.length === 0) return;
  for (const p of newPaths) ignoredDuplicatePaths.add(p);
  const db = getDB();
  const BATCH_SIZE = 500;
  for (let i = 0; i < newPaths.length; i += BATCH_SIZE) {
    const batch = newPaths.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => "(?)").join(", ");
    await db.$executeRawUnsafe(
      `INSERT OR IGNORE INTO IgnoredDuplicatePath (path) VALUES ${placeholders}`,
      ...batch,
    );
  }
}

export async function isIgnoredDuplicatePath(
  filePath: string,
): Promise<boolean> {
  await ensureIgnoredDuplicatePathsLoaded();
  return ignoredDuplicatePaths.has(filePath);
}

export async function forgetIgnoredDuplicatePath(
  filePath: string,
): Promise<void> {
  await ensureIgnoredDuplicatePathsLoaded();
  if (!ignoredDuplicatePaths.has(filePath)) return;
  ignoredDuplicatePaths.delete(filePath);
  await getDB().$executeRawUnsafe(
    "DELETE FROM IgnoredDuplicatePath WHERE path = ?",
    filePath,
  );
}

export async function listIgnoredDuplicatePaths(): Promise<string[]> {
  await ensureIgnoredDuplicatePathsLoaded();
  return Array.from(ignoredDuplicatePaths).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

export async function clearIgnoredDuplicatePaths(): Promise<number> {
  await ensureIgnoredDuplicatePathsLoaded();
  const count = ignoredDuplicatePaths.size;
  ignoredDuplicatePaths.clear();
  await getDB().$executeRawUnsafe("DELETE FROM IgnoredDuplicatePath");
  return count;
}

let imageSearchStatTableReady = false;
let imageSearchStatRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let imageSearchTagStatsBackfillAttempted = false;

async function ensureImageSearchStatTable(): Promise<void> {
  if (imageSearchStatTableReady) return;
  const db = getDB();
  await db.imageSearchStat.findFirst({
    select: { kind: true, key: true },
  });
  imageSearchStatTableReady = true;
}

type SearchStatResolutionRow = {
  width: number | null;
  height: number | null;
  count: number;
};

type SearchStatModelRow = {
  model: string | null;
  count: number;
};

type SearchStatTokenSourceRow = {
  promptTokens: string;
  negativePromptTokens: string;
  characterPromptTokens: string;
};

type SearchStatTagRow = {
  key: string;
  model: string | null;
  count: number;
};

type SearchStatsProgressCallback = (done: number, total: number) => void;

const MAX_TAG_SUGGEST_LIMIT = 24;
const TOKEN_TEXT_FIELDS = [
  "promptTokens",
  "negativePromptTokens",
  "characterPromptTokens",
] as const;

export type ImageSearchStatSource = {
  width: number;
  height: number;
  model: string;
  promptTokens: string;
  negativePromptTokens: string;
  characterPromptTokens: string;
};

const IMAGE_SEARCH_STAT_SOURCE_SELECT = {
  width: true,
  height: true,
  model: true,
  promptTokens: true,
  negativePromptTokens: true,
  characterPromptTokens: true,
} as const satisfies Prisma.ImageSelect;

type ImageSearchStatMutation = {
  before: ImageSearchStatSource | null;
  after: ImageSearchStatSource | null;
};

type ImageSearchStatDelta = {
  kind: "resolution" | "model" | "tag";
  key: string;
  width: number | null;
  height: number | null;
  model: string | null;
  delta: number;
};

const MAX_TAG_SUGGEST_QUERY_ROWS = 160;
const MIN_TAG_CONTAINS_QUERY_LENGTH = 3;

function splitTopLevelTagParts(raw: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let angleDepth = 0;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "{") braceDepth++;
    else if (ch === "}" && braceDepth > 0) braceDepth--;
    else if (ch === "[") bracketDepth++;
    else if (ch === "]" && bracketDepth > 0) bracketDepth--;
    else if (ch === "(") parenDepth++;
    else if (ch === ")" && parenDepth > 0) parenDepth--;
    else if (ch === "<") angleDepth++;
    else if (ch === ">" && angleDepth > 0) angleDepth--;

    if (
      ch === "," &&
      braceDepth === 0 &&
      bracketDepth === 0 &&
      parenDepth === 0 &&
      angleDepth === 0
    ) {
      parts.push(raw.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(raw.slice(start));
  return parts;
}

function unwrapExplicitWeightTagBlock(raw: string): string {
  const text = raw.trim();
  const match = text.match(/^[-+]?(?:\d+(?:\.\d+)?|\.\d+)::([\s\S]*?)::$/);
  if (!match) return text;
  return match[1].trim();
}

function normalizeTagSuggestionCandidates(value: string): string[] {
  const base = unwrapExplicitWeightTagBlock(value);
  const parts = splitTopLevelTagParts(base);
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const part of parts) {
    const tag = normalizeTagSuggestionText(part);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(tag);
  }
  return normalized;
}

function hasEnclosingPair(text: string, open: string, close: string): boolean {
  if (text.length < 2) return false;
  if (!text.startsWith(open) || !text.endsWith(close)) return false;

  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === open) {
      depth++;
      continue;
    }
    if (ch !== close) continue;
    depth--;
    if (depth < 0) return false;
    if (depth === 0 && i < text.length - 1) return false;
  }
  return depth === 0;
}

function normalizeTagSegment(value: string): string {
  let text = value.trim();
  if (!text) return "";

  // Remove repeated keyword-style wrappers: {{{tag}}}, [[tag]], etc.
  let changed = true;
  while (changed) {
    changed = false;
    if (hasEnclosingPair(text, "{", "}")) {
      text = text.slice(1, -1).trim();
      changed = true;
      continue;
    }
    if (hasEnclosingPair(text, "[", "]")) {
      text = text.slice(1, -1).trim();
      changed = true;
      continue;
    }
  }

  // Defensive trim for partially malformed bracket wrappers.
  return text
    .replace(/^(?:\{|\}|\[|\])+/, "")
    .replace(/(?:\{|\}|\[|\])+$/, "")
    .trim();
}

function extractTokenTexts(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const texts: string[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const text = (item as { text?: unknown }).text;
      if (typeof text !== "string") continue;
      const normalized = normalizeTagSuggestionCandidates(text);
      if (normalized.length === 0) continue;
      texts.push(...normalized);
    }
    return texts;
  } catch {
    return [];
  }
}

function normalizeTagSuggestionText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const segments = trimmed.split(":");
  const normalized = segments.map((segment) => normalizeTagSegment(segment));
  return normalized.join(":").replace(/\s+/g, " ").trim();
}

function collectTokenCountMap(
  source: ImageSearchStatSource,
): Map<string, { tag: string; count: number }> {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const field of TOKEN_TEXT_FIELDS) {
    const tokenTexts = extractTokenTexts(source[field]);
    for (const tokenText of tokenTexts) {
      const key = tokenText.toLowerCase();
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, { tag: tokenText, count: 1 });
      }
    }
  }
  return counts;
}

function addStatDelta(
  map: Map<string, ImageSearchStatDelta>,
  next: ImageSearchStatDelta,
): void {
  const id = `${next.kind}\0${next.key}`;
  const existing = map.get(id);
  if (existing) {
    existing.delta += next.delta;
    if (
      next.kind === "tag" &&
      (!existing.model || existing.model.length === 0) &&
      next.model
    ) {
      existing.model = next.model;
    }
    return;
  }
  map.set(id, { ...next });
}

function collectSourceStatDeltas(
  source: ImageSearchStatSource,
  sign: 1 | -1,
  map: Map<string, ImageSearchStatDelta>,
): void {
  if (source.width > 0 && source.height > 0) {
    addStatDelta(map, {
      kind: "resolution",
      key: `${source.width}x${source.height}`,
      width: source.width,
      height: source.height,
      model: null,
      delta: sign,
    });
  }

  addStatDelta(map, {
    kind: "model",
    key: source.model ?? "",
    width: null,
    height: null,
    model: source.model ?? "",
    delta: sign,
  });

  const tokenCounts = collectTokenCountMap(source);
  for (const [key, value] of tokenCounts) {
    addStatDelta(map, {
      kind: "tag",
      key,
      width: null,
      height: null,
      model: value.tag,
      delta: sign * value.count,
    });
  }
}

function buildStatDeltasFromMutations(
  mutations: ImageSearchStatMutation[],
): ImageSearchStatDelta[] {
  const deltaMap = new Map<string, ImageSearchStatDelta>();
  for (const mutation of mutations) {
    if (mutation.before) {
      collectSourceStatDeltas(mutation.before, -1, deltaMap);
    }
    if (mutation.after) {
      collectSourceStatDeltas(mutation.after, 1, deltaMap);
    }
  }
  return Array.from(deltaMap.values()).filter((delta) => delta.delta !== 0);
}

async function applySearchStatDeltasInTx(
  tx: Pick<ReturnType<typeof getDB>, "$executeRawUnsafe">,
  deltas: ImageSearchStatDelta[],
  onProgress?: SearchStatsProgressCallback,
): Promise<void> {
  const total = deltas.length;
  let done = 0;
  let lastProgressAt = 0;
  onProgress?.(done, total);
  for (const delta of deltas) {
    if (delta.delta > 0) {
      await tx.$executeRawUnsafe(
        `INSERT INTO ImageSearchStat (kind, key, width, height, model, count, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(kind, key) DO UPDATE SET
             count = ImageSearchStat.count + excluded.count,
             width = COALESCE(ImageSearchStat.width, excluded.width),
             height = COALESCE(ImageSearchStat.height, excluded.height),
             model = CASE
               WHEN ImageSearchStat.kind = 'tag'
                 THEN COALESCE(NULLIF(ImageSearchStat.model, ''), excluded.model)
               ELSE excluded.model
             END,
             updatedAt = CURRENT_TIMESTAMP`,
        delta.kind,
        delta.key,
        delta.width,
        delta.height,
        delta.model,
        delta.delta,
      );
    } else {
      await tx.$executeRawUnsafe(
        `UPDATE ImageSearchStat
           SET count = count + ?, updatedAt = CURRENT_TIMESTAMP
           WHERE kind = ? AND key = ?`,
        delta.delta,
        delta.kind,
        delta.key,
      );
      await tx.$executeRawUnsafe(
        "DELETE FROM ImageSearchStat WHERE kind = ? AND key = ? AND count <= 0",
        delta.kind,
        delta.key,
      );
    }
    done++;
    const now = Date.now();
    if (done === total || now - lastProgressAt >= 100) {
      lastProgressAt = now;
      onProgress?.(done, total);
    }
  }
}

async function applyImageSearchStatDeltas(
  deltas: ImageSearchStatDelta[],
  onProgress?: SearchStatsProgressCallback,
): Promise<void> {
  if (deltas.length === 0) return;
  await ensureImageSearchStatTable();
  const db = getDB();
  await db.$transaction(async (tx) => {
    await applySearchStatDeltasInTx(tx, deltas, onProgress);
  });
}

export async function applyImageSearchStatsMutations(
  mutations: ImageSearchStatMutation[],
  onProgress?: SearchStatsProgressCallback,
): Promise<void> {
  const deltas = buildStatDeltasFromMutations(mutations);
  await applyImageSearchStatDeltas(deltas, onProgress);
}

export async function applyImageSearchStatsMutation(
  before: ImageSearchStatSource | null,
  after: ImageSearchStatSource | null,
  onProgress?: SearchStatsProgressCallback,
): Promise<void> {
  await applyImageSearchStatsMutations([{ before, after }], onProgress);
}

export async function decrementImageSearchStatsForRows(
  rows: ImageSearchStatSource[],
  onProgress?: SearchStatsProgressCallback,
): Promise<void> {
  if (rows.length === 0) return;
  await applyImageSearchStatsMutations(
    rows.map((row) => ({ before: row, after: null })),
    onProgress,
  );
}

export async function decrementImageSearchStatsForFolder(
  folderId: number,
  onProgress?: SearchStatsProgressCallback,
): Promise<void> {
  const rows = await listImageSearchStatSourcesForFolder(folderId);
  await decrementImageSearchStatsForRows(rows, onProgress);
}

export async function listImageSearchStatSourcesForFolder(
  folderId: number,
): Promise<ImageSearchStatSource[]> {
  return (await getDB().image.findMany({
    where: { folderId },
    select: IMAGE_SEARCH_STAT_SOURCE_SELECT,
  })) as ImageSearchStatSource[];
}


function normalizeSuggestLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 8;
  const integer = Math.floor(value!);
  if (integer < 1) return 1;
  return Math.min(integer, MAX_TAG_SUGGEST_LIMIT);
}

function normalizeExcludedTagKeys(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const trimmed = String(value ?? "")
      .trim()
      .toLowerCase();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

async function hasImageSearchTagRows(): Promise<boolean> {
  const rows = (await getDB().$queryRawUnsafe(
    "SELECT 1 AS found FROM ImageSearchStat WHERE kind = 'tag' LIMIT 1",
  )) as Array<{ found: number }>;
  return rows.length > 0;
}

async function readImageSearchPresetStatsFromTable(): Promise<ImageSearchPresetStats> {
  const db = getDB();
  const resolutionRows = (await db.$queryRawUnsafe(
    `SELECT width, height, count
     FROM ImageSearchStat
     WHERE kind = 'resolution' AND width IS NOT NULL AND height IS NOT NULL
     ORDER BY count DESC, width DESC, height DESC`,
  )) as SearchStatResolutionRow[];
  const modelRows = (await db.$queryRawUnsafe(
    `SELECT model, count
     FROM ImageSearchStat
     WHERE kind = 'model'
     ORDER BY count DESC, key ASC`,
  )) as SearchStatModelRow[];
  return {
    availableResolutions: resolutionRows
      .filter(
        (row) =>
          Number.isInteger(row.width) &&
          Number.isInteger(row.height) &&
          (row.width ?? 0) > 0 &&
          (row.height ?? 0) > 0,
      )
      .map((row) => ({
        width: row.width as number,
        height: row.height as number,
      })),
    availableModels: modelRows.map((row) => row.model ?? ""),
  };
}

export async function rebuildImageSearchPresetStats(
  onProgress?: SearchStatsProgressCallback,
): Promise<void> {
  await ensureImageSearchStatTable();
  const db = getDB();
  const resolutionRows = (await db.$queryRawUnsafe(
    `SELECT width, height, COUNT(*) AS count
     FROM Image
     WHERE width > 0 AND height > 0
     GROUP BY width, height`,
  )) as SearchStatResolutionRow[];
  const modelRows = (await db.$queryRawUnsafe(
    `SELECT model, COUNT(*) AS count
     FROM Image
     GROUP BY model`,
  )) as SearchStatModelRow[];
  // Build tag stats in batches to avoid loading all 35K+ token JSON strings at once
  const TAG_STAT_BATCH_SIZE = 5000;
  const tagCounts = new Map<string, { tag: string; count: number }>();
  let tagOffset = 0;
  for (;;) {
    const batch = (await db.image.findMany({
      select: {
        promptTokens: true,
        negativePromptTokens: true,
        characterPromptTokens: true,
      },
      skip: tagOffset,
      take: TAG_STAT_BATCH_SIZE,
    })) as SearchStatTokenSourceRow[];
    if (batch.length === 0) break;
    for (const row of batch) {
      for (const field of TOKEN_TEXT_FIELDS) {
        const tokenTexts = extractTokenTexts(row[field]);
        for (const tokenText of tokenTexts) {
          const key = tokenText.toLowerCase();
          const existing = tagCounts.get(key);
          if (existing) existing.count += 1;
          else tagCounts.set(key, { tag: tokenText, count: 1 });
        }
      }
    }
    tagOffset += batch.length;
    if (batch.length < TAG_STAT_BATCH_SIZE) break;
  }
  const tagRows = Array.from(tagCounts.entries()).map(([key, value]) => ({
    key,
    tag: value.tag,
    count: value.count,
  }));
  imageSearchTagStatsBackfillAttempted = true;

  const total = 1 + resolutionRows.length + modelRows.length + tagRows.length;
  let done = 0;
  let lastProgressAt = 0;
  onProgress?.(done, total);

  await db.$executeRawUnsafe("DELETE FROM ImageSearchStat");
  done++;
  onProgress?.(done, total);

  const BATCH_SIZE = 500;

  // Batch-insert resolution rows
  for (let i = 0; i < resolutionRows.length; i += BATCH_SIZE) {
    const batch = resolutionRows.slice(i, i + BATCH_SIZE);
    const placeholders: string[] = [];
    const params: unknown[] = [];
    for (const row of batch) {
      if (!Number.isInteger(row.width) || !Number.isInteger(row.height))
        continue;
      placeholders.push("(?, ?, ?, ?, NULL, ?, CURRENT_TIMESTAMP)");
      params.push(
        "resolution",
        `${row.width}x${row.height}`,
        row.width,
        row.height,
        row.count,
      );
    }
    if (placeholders.length > 0) {
      await db.$executeRawUnsafe(
        `INSERT INTO ImageSearchStat (kind, key, width, height, model, count, updatedAt)
         VALUES ${placeholders.join(", ")}`,
        ...params,
      );
    }
    done += batch.length;
    const now = Date.now();
    if (done === total || now - lastProgressAt >= 100) {
      lastProgressAt = now;
      onProgress?.(done, total);
    }
  }

  // Batch-insert model rows
  for (let i = 0; i < modelRows.length; i += BATCH_SIZE) {
    const batch = modelRows.slice(i, i + BATCH_SIZE);
    const placeholders: string[] = [];
    const params: unknown[] = [];
    for (const row of batch) {
      placeholders.push("(?, ?, NULL, NULL, ?, ?, CURRENT_TIMESTAMP)");
      params.push("model", row.model ?? "", row.model ?? "", row.count);
    }
    if (placeholders.length > 0) {
      await db.$executeRawUnsafe(
        `INSERT INTO ImageSearchStat (kind, key, width, height, model, count, updatedAt)
         VALUES ${placeholders.join(", ")}`,
        ...params,
      );
    }
    done += batch.length;
    const now = Date.now();
    if (done === total || now - lastProgressAt >= 100) {
      lastProgressAt = now;
      onProgress?.(done, total);
    }
  }

  // Batch-insert tag rows
  for (let i = 0; i < tagRows.length; i += BATCH_SIZE) {
    const batch = tagRows.slice(i, i + BATCH_SIZE);
    const placeholders: string[] = [];
    const params: unknown[] = [];
    for (const row of batch) {
      placeholders.push("(?, ?, NULL, NULL, ?, ?, CURRENT_TIMESTAMP)");
      params.push("tag", row.key, row.tag, row.count);
    }
    if (placeholders.length > 0) {
      await db.$executeRawUnsafe(
        `INSERT INTO ImageSearchStat (kind, key, width, height, model, count, updatedAt)
         VALUES ${placeholders.join(", ")}`,
        ...params,
      );
    }
    done += batch.length;
    const now = Date.now();
    if (done === total || now - lastProgressAt >= 100) {
      lastProgressAt = now;
      onProgress?.(done, total);
    }
  }
}

export async function getImageSearchPresetStats(
  onProgress?: SearchStatsProgressCallback,
): Promise<ImageSearchPresetStats> {
  await ensureImageSearchStatTable();
  let stats = await readImageSearchPresetStatsFromTable();
  const hasTagRows = await hasImageSearchTagRows();
  if (
    (stats.availableResolutions.length === 0 &&
      stats.availableModels.length === 0) ||
    !hasTagRows
  ) {
    await rebuildImageSearchPresetStats(onProgress);
    stats = await readImageSearchPresetStatsFromTable();
  }
  return stats;
}

export async function suggestImageSearchTags(
  query: ImageTagSuggestQuery,
): Promise<ImageTagSuggestion[]> {
  await ensureImageSearchStatTable();
  const prefix = String(query?.prefix ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ");
  if (!prefix) return [];
  const containsEnabled = prefix.length >= MIN_TAG_CONTAINS_QUERY_LENGTH;

  if (
    !(await hasImageSearchTagRows()) &&
    !imageSearchTagStatsBackfillAttempted
  ) {
    imageSearchTagStatsBackfillAttempted = true;
    await rebuildImageSearchPresetStats();
  }

  const db = getDB();
  const limit = normalizeSuggestLimit(query?.limit);
  const queryLimit = Math.max(
    limit,
    Math.min(MAX_TAG_SUGGEST_QUERY_ROWS, limit * 8),
  );
  const excluded = normalizeExcludedTagKeys(query?.exclude);
  const excludedSet = new Set(excluded);
  const normalizedKeySql =
    "LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(key, '_', ' '), '[', ''), ']', ''), '{', ''), '}', ''))";
  const excludedClause =
    excluded.length > 0
      ? ` AND ${normalizedKeySql} NOT IN (${excluded.map(() => "?").join(", ")})`
      : "";
  const keyFilterValue = containsEnabled ? `%${prefix}%` : `${prefix}%`;
  const orderRankSql = containsEnabled
    ? `CASE WHEN ${normalizedKeySql} = ? THEN 0 WHEN ${normalizedKeySql} LIKE ? THEN 1 ELSE 2 END`
    : `CASE WHEN ${normalizedKeySql} = ? THEN 0 ELSE 1 END`;
  const rows = (await db.$queryRawUnsafe(
    `SELECT key, model, count
     FROM ImageSearchStat
     WHERE kind = 'tag'
       AND ${normalizedKeySql} LIKE ?
       ${excludedClause}
     ORDER BY ${orderRankSql}, count DESC, key ASC
     LIMIT ?`,
    keyFilterValue,
    ...excluded,
    prefix,
    ...(containsEnabled ? [`${prefix}%`] : []),
    queryLimit,
  )) as SearchStatTagRow[];

  const merged = new Map<string, ImageTagSuggestion>();
  for (const row of rows) {
    const count = Math.max(0, Math.floor(row.count ?? 0));
    for (const tag of normalizeTagSuggestionCandidates(row.model ?? row.key)) {
      const key = tag.toLowerCase().replace(/_/g, " ");
      if (containsEnabled) {
        if (!key.includes(prefix)) continue;
      } else if (!key.startsWith(prefix)) {
        continue;
      }
      if (excludedSet.has(key)) continue;
      const existing = merged.get(key);
      if (existing) {
        existing.count += count;
      } else {
        merged.set(key, { tag, count });
      }
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => {
      const aExact = a.tag.toLowerCase() === prefix;
      const bExact = b.tag.toLowerCase() === prefix;
      if (aExact !== bExact) return aExact ? -1 : 1;
      if (containsEnabled) {
        const aPrefix = a.tag.toLowerCase().startsWith(prefix);
        const bPrefix = b.tag.toLowerCase().startsWith(prefix);
        if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
      }
      if (a.count !== b.count) return b.count - a.count;
      return a.tag.localeCompare(b.tag);
    })
    .slice(0, limit);
}

export function scheduleImageSearchPresetStatsRebuild(
  delayMs = 300,
  onProgress?: SearchStatsProgressCallback,
): void {
  if (imageSearchStatRefreshTimer) clearTimeout(imageSearchStatRefreshTimer);
  imageSearchStatRefreshTimer = setTimeout(
    () => {
      imageSearchStatRefreshTimer = null;
      void rebuildImageSearchPresetStats(onProgress).catch((error) => {
        console.warn(
          "[image.scheduleImageSearchPresetStatsRebuild] failed",
          error,
        );
      });
    },
    Math.max(0, delayMs),
  );
}

// ── Public API ────────────────────────────────────────────────

export async function listImageIdsForFolder(
  folderId: number,
): Promise<number[]> {
  const rows = await getDB().image.findMany({
    where: { folderId },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

type SubfolderFilter = {
  folderId: number;
  selectedPaths: string[];
  allPaths: string[];
  includeRoot: boolean;
};

type NormalizedImageListQuery = {
  page: number;
  pageSize: number;
  folderIds: number[];
  searchGroups: string[][];
  sortBy: ImageSortBy;
  onlyRecent: boolean;
  recentDays: number;
  customCategoryId: number | null;
  builtinCategory: ImageBuiltinCategory | null;
  randomSeed: number;
  resolutionFilters: ImageQueryResolutionFilter[];
  modelFilters: string[];
  seedFilters: number[];
  excludeTags: string[];
  subfolderFilters: SubfolderFilter[];
};

function normalizePositiveInt(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  const integer = Math.floor(value!);
  if (integer < 1) return fallback;
  return Math.min(integer, max);
}

function normalizeIntegerArray(values: number[] | undefined): number[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(values.filter((value) => Number.isInteger(value))),
  ) as number[];
}

function normalizeResolutionFilters(
  values: ImageQueryResolutionFilter[] | undefined,
): ImageQueryResolutionFilter[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const normalized: ImageQueryResolutionFilter[] = [];
  for (const value of values) {
    const width = Math.floor(value?.width ?? 0);
    const height = Math.floor(value?.height ?? 0);
    if (width < 1 || height < 1) continue;
    const key = `${width}x${height}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ width, height });
  }
  return normalized;
}

function normalizeSeedFilters(values: number[] | undefined): number[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<number>();
  const normalized: number[] = [];
  for (const value of values) {
    const n = Math.floor(value ?? NaN);
    if (!Number.isFinite(n)) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    normalized.push(n);
  }
  return normalized;
}

function normalizeStringArray(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function normalizeModelFilters(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

const MAX_SEARCH_TERMS = 32;
const MAX_OR_TERMS_PER_GROUP = 16;
const SEARCH_AND_SPLIT_RE = /[,\n\uFF0C]+/;
const SEARCH_OR_SPLIT_RE = /[|\uFF5C]+/;

function normalizeSearchGroups(rawQuery: string): string[][] {
  if (!rawQuery) return [];

  const normalized: string[][] = [];
  const seenGroups = new Set<string>();
  let totalTerms = 0;

  for (const rawGroup of rawQuery.split(SEARCH_AND_SPLIT_RE)) {
    if (totalTerms >= MAX_SEARCH_TERMS) break;

    const seenTerms = new Set<string>();
    const groupTerms: string[] = [];
    for (const rawTerm of rawGroup.split(SEARCH_OR_SPLIT_RE)) {
      if (totalTerms + groupTerms.length >= MAX_SEARCH_TERMS) break;
      if (groupTerms.length >= MAX_OR_TERMS_PER_GROUP) break;

      const term = rawTerm.trim();
      if (!term) continue;

      const variants = [
        ...new Set([term, term.replace(/_/g, " "), term.replace(/ /g, "_")]),
      ];
      for (const variant of variants) {
        if (totalTerms + groupTerms.length >= MAX_SEARCH_TERMS) break;
        const dedupeKey = variant.toLowerCase();
        if (seenTerms.has(dedupeKey)) continue;
        seenTerms.add(dedupeKey);
        groupTerms.push(variant);
      }
    }

    if (groupTerms.length === 0) continue;

    const groupKey = groupTerms.map((term) => term.toLowerCase()).join("\0");
    if (seenGroups.has(groupKey)) continue;
    seenGroups.add(groupKey);

    normalized.push(groupTerms);
    totalTerms += groupTerms.length;
  }

  return normalized;
}

function normalizeImageListQuery(
  query?: ImageListQuery,
): NormalizedImageListQuery {
  const normalizedSearchQuery = String(query?.searchQuery ?? "").trim();
  const normalizedSort = (() => {
    switch (query?.sortBy) {
      case "oldest":
      case "favorites":
      case "name":
        return query.sortBy;
      default:
        return "recent";
    }
  })();
  return {
    page: normalizePositiveInt(query?.page, 1, 100000),
    pageSize: normalizePositiveInt(query?.pageSize, 50, 200),
    folderIds: normalizeIntegerArray(query?.folderIds),
    searchGroups: normalizeSearchGroups(normalizedSearchQuery),
    sortBy: normalizedSort,
    onlyRecent: query?.onlyRecent === true,
    recentDays: normalizePositiveInt(query?.recentDays, 7, 3650),
    customCategoryId: Number.isInteger(query?.customCategoryId)
      ? (query?.customCategoryId as number)
      : null,
    builtinCategory:
      query?.builtinCategory === "favorites" ||
      query?.builtinCategory === "random"
        ? query.builtinCategory
        : null,
    randomSeed: Number.isFinite(query?.randomSeed)
      ? Math.floor(query!.randomSeed!)
      : 0,
    resolutionFilters: normalizeResolutionFilters(query?.resolutionFilters),
    modelFilters: normalizeModelFilters(query?.modelFilters),
    seedFilters: normalizeSeedFilters(query?.seedFilters),
    excludeTags: normalizeStringArray(query?.excludeTags),
    subfolderFilters: Array.isArray(query?.subfolderFilters)
      ? query.subfolderFilters
          .filter(
            (f) =>
              Number.isInteger(f.folderId) &&
              Array.isArray(f.selectedPaths) &&
              Array.isArray(f.allPaths),
          )
          .map((f) => ({
            folderId: f.folderId,
            selectedPaths: f.selectedPaths,
            allPaths: f.allPaths,
            includeRoot: f.includeRoot !== false,
          }))
      : [],
  };
}

function buildImageWhereInput(
  query: NormalizedImageListQuery,
): Prisma.ImageWhereInput {
  const andConditions: Prisma.ImageWhereInput[] = [];

  if (query.subfolderFilters.length === 0) {
    andConditions.push({ folderId: { in: query.folderIds } });
  } else {
    const sep = process.platform === "win32" ? "\\" : "/";
    const filteredFolderIds = new Set(
      query.subfolderFilters.map((f) => f.folderId),
    );
    const unfilteredIds = query.folderIds.filter(
      (id) => !filteredFolderIds.has(id),
    );
    const orConditions: Prisma.ImageWhereInput[] = [];
    if (unfilteredIds.length > 0) {
      orConditions.push({ folderId: { in: unfilteredIds } });
    }
    for (const sf of query.subfolderFilters) {
      const pathConditions: Prisma.ImageWhereInput[] = [
        // selected subfolders
        ...sf.selectedPaths.map((p) => ({
          path: { startsWith: p.endsWith(sep) ? p : p + sep },
        })),
        // root images: not under any known subdir (only if includeRoot)
        ...(sf.includeRoot && sf.allPaths.length > 0
          ? [
              {
                AND: sf.allPaths.map((p) => ({
                  path: {
                    not: { startsWith: p.endsWith(sep) ? p : p + sep },
                  },
                })),
              },
            ]
          : []),
      ];
      if (pathConditions.length > 0) {
        orConditions.push({
          AND: [{ folderId: sf.folderId }, { OR: pathConditions }],
        });
      }
    }
    andConditions.push({ OR: orConditions });
  }

  if (query.searchGroups.length > 0) {
    for (const terms of query.searchGroups) {
      const orConditions: Prisma.ImageWhereInput[] = [];
      for (const term of terms) {
        orConditions.push(
          { promptTokens: { contains: term } },
          { negativePromptTokens: { contains: term } },
          { characterPromptTokens: { contains: term } },
          { prompt: { contains: term } },
          { negativePrompt: { contains: term } },
          { characterPrompts: { contains: term } },
        );
      }
      andConditions.push({
        OR: orConditions,
      });
    }
  }

  if (query.resolutionFilters.length > 0) {
    andConditions.push({
      OR: query.resolutionFilters.map((filter) => ({
        width: filter.width,
        height: filter.height,
      })),
    });
  }

  if (query.modelFilters.length > 0) {
    andConditions.push({ model: { in: query.modelFilters } });
  }

  if (query.seedFilters.length > 0) {
    andConditions.push({ seed: { in: query.seedFilters } });
  }

  for (const tag of query.excludeTags) {
    andConditions.push({
      AND: [
        { promptTokens: { not: { contains: tag } } },
        { negativePromptTokens: { not: { contains: tag } } },
        { characterPromptTokens: { not: { contains: tag } } },
        { prompt: { not: { contains: tag } } },
        { negativePrompt: { not: { contains: tag } } },
        { characterPrompts: { not: { contains: tag } } },
      ],
    });
  }

  if (query.onlyRecent) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - query.recentDays);
    andConditions.push({ fileModifiedAt: { gte: cutoff } });
  }

  if (query.customCategoryId !== null) {
    andConditions.push({
      categories: { some: { categoryId: query.customCategoryId } },
    });
  }

  if (query.builtinCategory === "favorites") {
    andConditions.push({ isFavorite: true });
  }

  return andConditions.length > 0 ? { AND: andConditions } : {};
}

function buildImageOrderBy(
  sortBy: ImageSortBy,
): Prisma.ImageOrderByWithRelationInput[] {
  switch (sortBy) {
    case "oldest":
      return [{ fileModifiedAt: "asc" }, { id: "asc" }];
    case "favorites":
      return [
        { isFavorite: "desc" },
        { fileModifiedAt: "desc" },
        { id: "desc" },
      ];
    case "name":
      return [{ path: "asc" }, { id: "asc" }];
    case "recent":
    default:
      return [{ fileModifiedAt: "desc" }, { id: "desc" }];
  }
}

// ---------------------------------------------------------------------------
// Raw SQL WHERE builder (mirrors buildImageWhereInput for $queryRawUnsafe)
// ---------------------------------------------------------------------------

interface SqlFragment {
  sql: string;
  params: unknown[];
}

function placeholders(count: number): string {
  return new Array(count).fill("?").join(", ");
}

function buildImageWhereSql(query: NormalizedImageListQuery): SqlFragment {
  const conditions: string[] = [];
  const params: unknown[] = [];

  // folder / subfolder filter
  if (query.subfolderFilters.length === 0) {
    conditions.push(`"folderId" IN (${placeholders(query.folderIds.length)})`);
    params.push(...query.folderIds);
  } else {
    const sep = process.platform === "win32" ? "\\" : "/";
    const filteredFolderIds = new Set(
      query.subfolderFilters.map((f) => f.folderId),
    );
    const unfilteredIds = query.folderIds.filter(
      (id) => !filteredFolderIds.has(id),
    );
    const orParts: string[] = [];
    if (unfilteredIds.length > 0) {
      orParts.push(`"folderId" IN (${placeholders(unfilteredIds.length)})`);
      params.push(...unfilteredIds);
    }
    for (const sf of query.subfolderFilters) {
      const sfParams: unknown[] = [sf.folderId];
      const pathParts: string[] = [];
      for (const p of sf.selectedPaths) {
        const prefix = p.endsWith(sep) ? p : p + sep;
        pathParts.push(`"path" LIKE ? ESCAPE '\\'`);
        sfParams.push(sqlLikeEscape(prefix) + "%");
      }
      if (sf.includeRoot && sf.allPaths.length > 0) {
        const notParts = sf.allPaths.map((p) => {
          const prefix = p.endsWith(sep) ? p : p + sep;
          sfParams.push(sqlLikeEscape(prefix) + "%");
          return `"path" NOT LIKE ? ESCAPE '\\'`;
        });
        pathParts.push(`(${notParts.join(" AND ")})`);
      }
      if (pathParts.length > 0) {
        orParts.push(`("folderId" = ? AND (${pathParts.join(" OR ")}))`);
        params.push(...sfParams);
      }
    }
    if (orParts.length > 0) {
      conditions.push(`(${orParts.join(" OR ")})`);
    }
  }

  // search groups
  const searchColumns = [
    '"promptTokens"',
    '"negativePromptTokens"',
    '"characterPromptTokens"',
    '"prompt"',
    '"negativePrompt"',
    '"characterPrompts"',
  ];
  for (const terms of query.searchGroups) {
    const orParts: string[] = [];
    for (const term of terms) {
      for (const col of searchColumns) {
        orParts.push(`${col} LIKE ? ESCAPE '\\'`);
        params.push("%" + sqlLikeEscape(term) + "%");
      }
    }
    conditions.push(`(${orParts.join(" OR ")})`);
  }

  // resolution
  if (query.resolutionFilters.length > 0) {
    const orParts = query.resolutionFilters.map((f) => {
      params.push(f.width, f.height);
      return `("width" = ? AND "height" = ?)`;
    });
    conditions.push(`(${orParts.join(" OR ")})`);
  }

  // model
  if (query.modelFilters.length > 0) {
    conditions.push(`"model" IN (${placeholders(query.modelFilters.length)})`);
    params.push(...query.modelFilters);
  }

  // seed
  if (query.seedFilters.length > 0) {
    conditions.push(`"seed" IN (${placeholders(query.seedFilters.length)})`);
    params.push(...query.seedFilters);
  }

  // exclude tags
  for (const tag of query.excludeTags) {
    const escaped = "%" + sqlLikeEscape(tag) + "%";
    for (const col of searchColumns) {
      conditions.push(`${col} NOT LIKE ? ESCAPE '\\'`);
      params.push(escaped);
    }
  }

  // recent
  if (query.onlyRecent) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - query.recentDays);
    conditions.push(`"fileModifiedAt" >= ?`);
    params.push(cutoff.toISOString());
  }

  // custom category
  if (query.customCategoryId !== null) {
    conditions.push(
      `EXISTS (SELECT 1 FROM "ImageCategory" WHERE "ImageCategory"."imageId" = "Image"."id" AND "ImageCategory"."categoryId" = ?)`,
    );
    params.push(query.customCategoryId);
  }

  // favorites
  if (query.builtinCategory === "favorites") {
    conditions.push(`"isFavorite" = 1`);
  }

  return {
    sql: conditions.length > 0 ? conditions.join(" AND ") : "1=1",
    params,
  };
}

function sqlLikeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => "\\" + ch);
}

const IMAGE_LIST_PAGE_COLUMNS = Object.keys(IMAGE_LIST_PAGE_SELECT)
  .map((c) => `"${c}"`)
  .join(", ");

type RawImageRow = Omit<ImageRow, "isFavorite" | "varietyPlus"> & {
  isFavorite: number;
  varietyPlus: number;
};

function normalizeRawImageRow(raw: RawImageRow): ImageRow {
  return {
    ...raw,
    isFavorite: Boolean(raw.isFavorite),
    varietyPlus: Boolean(raw.varietyPlus),
  };
}

export async function listImagesPage(
  query?: ImageListQuery,
): Promise<ImageListResult> {
  const normalized = normalizeImageListQuery(query);
  const offset = (normalized.page - 1) * normalized.pageSize;
  if (normalized.folderIds.length === 0) {
    return {
      rows: [],
      totalCount: 0,
      page: normalized.page,
      pageSize: normalized.pageSize,
      totalPages: 1,
    };
  }

  const db = getDB();

  if (normalized.builtinCategory === "random") {
    const { sql: whereSql, params } = buildImageWhereSql(normalized);
    const rows = (
      await db.$queryRawUnsafe<RawImageRow[]>(
        `SELECT ${IMAGE_LIST_PAGE_COLUMNS} FROM "Image" WHERE ${whereSql} ORDER BY RANDOM() LIMIT ?`,
        ...params,
        normalized.pageSize,
      )
    ).map(normalizeRawImageRow);
    return {
      rows,
      totalCount: rows.length,
      page: normalized.page,
      pageSize: normalized.pageSize,
      totalPages: 1,
    };
  }

  const where = buildImageWhereInput(normalized);
  const totalCount = await db.image.count({ where });
  const rows = (await db.image.findMany({
    where,
    select: IMAGE_LIST_PAGE_SELECT,
    orderBy: buildImageOrderBy(normalized.sortBy),
    skip: offset,
    take: normalized.pageSize,
  })) as unknown as ImageRow[];
  return {
    rows,
    totalCount,
    page: normalized.page,
    pageSize: normalized.pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / normalized.pageSize)),
  };
}

export async function listMatchingImageIds(
  query?: ImageListQuery,
): Promise<number[]> {
  const normalized = normalizeImageListQuery(query);
  if (normalized.folderIds.length === 0) return [];

  if (normalized.builtinCategory === "random") {
    const pageResult = await listImagesPage(query);
    return pageResult.rows.map((r) => r.id);
  }

  const rows = await getDB().image.findMany({
    where: buildImageWhereInput(normalized),
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function listImagesByIds(imageIds: number[]): Promise<ImageRow[]> {
  const ids = normalizeIntegerArray(imageIds);
  if (ids.length === 0) return [];
  const rows = (await getDB().image.findMany({
    where: { id: { in: ids } },
  })) as unknown as ImageRow[];
  const rowMap = new Map(rows.map((row) => [row.id, row]));
  return ids
    .map((id) => rowMap.get(id))
    .filter((row): row is ImageRow => row !== undefined);
}

export async function findFolderDuplicateImages(
  folderPath: string,
  options?: {
    incomingPaths?: string[];
    signal?: CancelToken;
  },
): Promise<FolderDuplicateGroup[]> {
  await ensureIgnoredDuplicatePathsLoaded();
  const incomingPaths = (
    options?.incomingPaths ?? (await scanImageFiles(folderPath, options?.signal))
  ).filter((filePath) => !ignoredDuplicatePaths.has(filePath));
  if (incomingPaths.length === 0) return [];

  const incomingPathSet = new Set(incomingPaths);
  const incomingSizeBuckets = await buildIncomingSizeBuckets(
    incomingPaths,
    options?.signal,
  );
  const incomingFileSizes = [...incomingSizeBuckets.keys()];
  const existingSizeBuckets = await buildExistingSizeBuckets(
    incomingFileSizes,
    options?.signal,
  );
  const candidateSizes = collectCandidateSizes(
    incomingSizeBuckets,
    existingSizeBuckets,
  );
  if (candidateSizes.length === 0) return [];

  const existingSignatureBuckets = await buildExistingSignatureBuckets(
    existingSizeBuckets,
    candidateSizes,
    options?.signal,
  );
  const incomingSignatureBuckets = await buildIncomingSignatureBuckets(
    incomingSizeBuckets,
    candidateSizes,
    options?.signal,
  );

  return buildDuplicateGroupsFromBuckets(
    incomingSignatureBuckets,
    existingSignatureBuckets,
    incomingPathSet,
  );
}

export async function findDuplicateGroupForIncomingPath(
  incomingPath: string,
): Promise<FolderDuplicateGroup | null> {
  await ensureIgnoredDuplicatePathsLoaded();
  if (ignoredDuplicatePaths.has(incomingPath)) return null;

  const db = getDB();
  const incomingSize = await fileSize(incomingPath);
  if (incomingSize === null) return null;

  // DB에서 fileSize가 일치하는 행만 조회 — 전체 stat 루프 제거
  const candidates = await db.image.findMany({
    where: { fileSize: incomingSize, NOT: { path: incomingPath } },
    select: { id: true, path: true },
  });
  if (candidates.length === 0) return null;

  const incomingHash = await fileHash(incomingPath);
  if (!incomingHash) return null;

  const existingEntries: FolderDuplicateExistingEntry[] = [];
  await withConcurrency(candidates, HASH_SCAN_CONCURRENCY, async (row) => {
    const hash = await fileHash(row.path);
    if (hash !== incomingHash) return;
    existingEntries.push({
      imageId: row.id,
      path: row.path,
      fileName: path.basename(row.path),
    });
  });

  if (existingEntries.length === 0) return null;

  return {
    id: `${incomingSize}:${incomingHash}`,
    hash: incomingHash,
    previewPath: existingEntries[0].path,
    previewFileName: existingEntries[0].fileName,
    existingEntries,
    incomingEntries: [
      { path: incomingPath, fileName: path.basename(incomingPath) },
    ],
  };
}

export async function resolveFolderDuplicates(
  resolutions: FolderDuplicateGroupResolution[],
  onSearchStatsProgress?: SearchStatsProgressCallback,
): Promise<{
  removedImageIds: number[];
  retainedIncomingPaths: string[];
  touchedIncomingPaths: string[];
}> {
  const db = getDB();
  const incomingToDelete = new Set<string>();
  const existingToDelete = new Map<number, string>();
  const removedImageIds: number[] = [];
  const retainedIncomingPaths = new Set<string>();
  const touchedIncomingPaths = new Set<string>();
  const ignoredIncomingPaths = new Set<string>();

  for (const resolution of resolutions) {
    const incomingPaths = Array.from(new Set(resolution.incomingPaths));
    for (const incomingPath of incomingPaths) {
      touchedIncomingPaths.add(incomingPath);
    }

    if (resolution.keep === "ignore") {
      for (const incomingPath of incomingPaths) {
        ignoredIncomingPaths.add(incomingPath);
      }
      continue;
    }

    for (const incomingPath of incomingPaths) {
      await forgetIgnoredDuplicatePath(incomingPath);
    }

    if (resolution.keep === "incoming" && incomingPaths.length > 0) {
      for (const entry of resolution.existingEntries) {
        existingToDelete.set(entry.imageId, entry.path);
      }
      const keepIncomingPath = [...incomingPaths].sort((a, b) =>
        a.localeCompare(b),
      )[0];
      retainedIncomingPaths.add(keepIncomingPath);
      for (const incomingPath of incomingPaths) {
        if (incomingPath !== keepIncomingPath) {
          incomingToDelete.add(incomingPath);
        }
      }
      continue;
    }

    for (const incomingPath of incomingPaths) {
      incomingToDelete.add(incomingPath);
    }
  }

  for (const incomingPath of incomingToDelete) {
    try {
      await fs.promises.unlink(incomingPath);
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") throw e;
    }
  }

  const existingToDeleteIds = Array.from(existingToDelete.keys());
  const existingToDeleteRows = (await db.image.findMany({
    where: { id: { in: existingToDeleteIds } },
    select: { id: true, ...IMAGE_SEARCH_STAT_SOURCE_SELECT },
  })) as Array<{ id: number } & ImageSearchStatSource>;
  const existingToDeleteStatsMap = new Map(
    existingToDeleteRows.map((row) => [row.id, row]),
  );
  const deletedExistingRows: ImageSearchStatSource[] = [];

  for (const [existingImageId, existingPath] of existingToDelete.entries()) {
    try {
      await fs.promises.unlink(existingPath);
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") throw e;
    }
    try {
      await db.image.delete({ where: { id: existingImageId } });
      removedImageIds.push(existingImageId);
      const deletedStats = existingToDeleteStatsMap.get(existingImageId);
      if (deletedStats) deletedExistingRows.push(deletedStats);
    } catch (e: unknown) {
      // If already removed by watcher race, treat as resolved.
      const message = e instanceof Error ? e.message : String(e);
      if (!message.includes("Record to delete does not exist")) {
        throw e;
      }
    }
  }

  await registerIgnoredDuplicatePaths(Array.from(ignoredIncomingPaths));
  await decrementImageSearchStatsForRows(
    deletedExistingRows,
    onSearchStatsProgress,
  );
  if (removedImageIds.length > 0) {
    await deleteSimilarityCacheForImageIds(removedImageIds);
  }

  return {
    removedImageIds,
    retainedIncomingPaths: Array.from(retainedIncomingPaths),
    touchedIncomingPaths: Array.from(touchedIncomingPaths),
  };
}
export async function setImageFavorite(
  id: number,
  isFavorite: boolean,
): Promise<void> {
  await getDB().image.update({ where: { id }, data: { isFavorite } });
}

export type ScanPhase =
  | "loadingLibrary"
  | "scanningFiles"
  | "checkingDuplicates"
  | "syncing";

export type QuickVerifyResult = {
  changedFolderIds: number[];
  unchangedFolderIds: number[];
};

export async function quickVerifyFolders(
  signal?: CancelToken,
): Promise<QuickVerifyResult> {
  const db = getDB();
  const folders = await db.folder.findMany({
    select: { id: true, path: true, lastScanFileCount: true },
  });

  const results = await Promise.all(
    folders.map(async (folder) => {
      try {
        await fs.promises.access(folder.path);
      } catch {
        // folder inaccessible (NAS offline, deleted, permissions, etc.)
        // → skip to avoid purging DB rows for temporarily unreachable folders
        return { id: folder.id, changed: false };
      }
      try {
        const diskCount = await countImageFiles(folder.path, signal);
        const changed =
          folder.lastScanFileCount === null ||
          folder.lastScanFileCount !== diskCount;
        return { id: folder.id, changed };
      } catch {
        return { id: folder.id, changed: false };
      }
    }),
  );

  const changedFolderIds: number[] = [];
  const unchangedFolderIds: number[] = [];
  for (const r of results) {
    if (r.changed) changedFolderIds.push(r.id);
    else unchangedFolderIds.push(r.id);
  }

  console.info(
    `[image.quickVerifyFolders] total=${folders.length} changed=${changedFolderIds.length} unchanged=${unchangedFolderIds.length}`,
  );

  return { changedFolderIds, unchangedFolderIds };
}

export type SyncAllFoldersOptions = {
  onBatch: (images: ImageRow[]) => void;
  onProgress?: (done: number, total: number) => void;
  onFolderStart?: (folderId: number, folderName: string) => void;
  onFolderEnd?: (folderId: number) => void;
  signal?: CancelToken;
  onDuplicateGroup?: (group: FolderDuplicateGroup) => void;
  folderIds?: number[];
  orderedFolderIds?: number[];
  onSearchStatsProgress?: SearchStatsProgressCallback;
  onDupCheckProgress?: (done: number, total: number) => void;
  onPhase?: (phase: ScanPhase) => void;
  skipFolderIds?: number[];
};

export async function syncAllFolders(
  options: SyncAllFoldersOptions,
): Promise<void> {
  const {
    onBatch,
    onProgress,
    onFolderStart,
    onFolderEnd,
    signal,
    onDuplicateGroup,
    folderIds,
    orderedFolderIds,
    onSearchStatsProgress,
    onDupCheckProgress,
    onPhase,
    skipFolderIds,
  } = options;
  const startedAt = Date.now();
  let done = 0;
  let total = 0;
  let folderCount = 0;
  let skippedCount = 0;
  let success = false;
  let lastProgressAt = 0;
  const detectDuplicates = Boolean(onDuplicateGroup);
  const deletedSimilarityIds = new Set<number>();
  console.info(
    `[image.syncAllFolders] start detectDuplicates=${detectDuplicates}`,
  );

  try {
    onPhase?.("loadingLibrary");
    const rawFolders = await getFolders();
    const requestedFolderIds =
      folderIds && folderIds.length > 0 ? new Set(folderIds) : null;
    const candidateFolders = requestedFolderIds
      ? rawFolders.filter((folder) => requestedFolderIds.has(folder.id))
      : rawFolders;
    const folders =
      orderedFolderIds && orderedFolderIds.length > 0
        ? (() => {
            const folderMap = new Map(candidateFolders.map((f) => [f.id, f]));
            const ordered = orderedFolderIds
              .map((id) => folderMap.get(id))
              .filter(
                (f): f is (typeof candidateFolders)[0] => f !== undefined,
              );
            const orderedSet = new Set(orderedFolderIds);
            const remaining = candidateFolders.filter(
              (f) => !orderedSet.has(f.id),
            );
            return [...ordered, ...remaining];
          })()
        : candidateFolders;
    const skipSet =
      skipFolderIds && skipFolderIds.length > 0 ? new Set(skipFolderIds) : null;
    const foldersToScan = skipSet
      ? folders.filter((f) => !skipSet.has(f.id))
      : folders;
    folderCount = foldersToScan.length;
    skippedCount = folders.length - foldersToScan.length;
    if (skippedCount > 0) {
      console.info(
        `[image.syncAllFolders] skipping ${skippedCount} unchanged folders`,
      );
    }
    const db = getDB();

    const preScannedTotals = detectDuplicates;
    const duplicateIncomingPathSet = new Set<string>();

    if (onDuplicateGroup && !signal?.cancelled) {
      onPhase?.("scanningFiles");
      // Use a prepared statement for per-path existence checks instead of
      // loading all existing rows into memory.
      const rawDb = getRawDB();
      const existsStmt = rawDb.prepare(
        'SELECT 1 FROM "Image" WHERE path = ? LIMIT 1',
      );
      const incomingCandidates: string[] = [];

      for (const folder of foldersToScan) {
        if (signal?.cancelled) break;

        await withConcurrency(
          walkImageFiles(folder.path, signal),
          SIZE_SCAN_CONCURRENCY,
          async (incomingPath) => {
            total++;
            if (existsStmt.get(incomingPath)) return;
            if (await isIgnoredDuplicatePath(incomingPath)) return;
            incomingCandidates.push(incomingPath);
          },
          signal,
        );

        const now = Date.now();
        if (now - lastProgressAt >= 100) {
          lastProgressAt = now;
          onProgress?.(done, total);
        }
      }

      onProgress?.(done, total);

      if (!signal?.cancelled && incomingCandidates.length > 0) {
        onPhase?.("checkingDuplicates");
        // Build incoming size buckets first, then query only matching sizes
        // from existing images — avoids loading all existing rows.
        const incomingSizeBuckets = await buildIncomingSizeBuckets(
          incomingCandidates,
          signal,
        );
        if (signal?.cancelled) return;
        const incomingFileSizes = [...incomingSizeBuckets.keys()];
        const existingSizeBuckets = await buildExistingSizeBuckets(
          incomingFileSizes,
          signal,
        );
        if (signal?.cancelled) return;
        const candidateSizes = collectCandidateSizes(
          incomingSizeBuckets,
          existingSizeBuckets,
        );
        if (candidateSizes.length > 0) {
          const existingTargetCount = candidateSizes.reduce(
            (sum, size) => sum + (existingSizeBuckets.get(size)?.length ?? 0),
            0,
          );
          const incomingTargetCount = candidateSizes.reduce(
            (sum, size) => sum + (incomingSizeBuckets.get(size)?.length ?? 0),
            0,
          );
          const dupCheckTotal = existingTargetCount + incomingTargetCount;
          let dupCheckDone = 0;
          const onDupItemDone =
            onDupCheckProgress && dupCheckTotal > 0
              ? () => onDupCheckProgress(++dupCheckDone, dupCheckTotal)
              : undefined;

          const existingSignatureBuckets = await buildExistingSignatureBuckets(
            existingSizeBuckets,
            candidateSizes,
            signal,
            onDupItemDone,
          );
          if (signal?.cancelled) return;
          const incomingSignatureBuckets = await buildIncomingSignatureBuckets(
            incomingSizeBuckets,
            candidateSizes,
            signal,
            onDupItemDone,
          );
          if (signal?.cancelled) return;
          const duplicateGroups = buildDuplicateGroupsFromBuckets(
            incomingSignatureBuckets,
            existingSignatureBuckets,
            new Set(incomingCandidates),
          );
          for (const group of duplicateGroups) {
            onDuplicateGroup(group);
            for (const entry of group.incomingEntries) {
              duplicateIncomingPathSet.add(entry.path);
            }
          }
        }
      }
    }

    onPhase?.("syncing");

    // total이 미확정일 때(수동 재스캔 등) 빠른 카운트 패스로 확정
    if (!preScannedTotals && !signal?.cancelled) {
      for (const folder of foldersToScan) {
        if (signal?.cancelled) break;
        total += await countImageFiles(folder.path, signal);
      }
      onProgress?.(done, total);
    }

    for (const folder of foldersToScan) {
      if (signal?.cancelled) break;

      // Skip inaccessible folders (e.g. NAS offline) to avoid purging their DB rows
      try {
        await fs.promises.access(folder.path);
      } catch {
        console.info(
          `[image.syncAllFolders] skipping inaccessible folder: ${folder.path}`,
        );
        continue;
      }

      onFolderStart?.(folder.id, folder.name);
      try {
        const existing = await db.image.findMany({
          where: { folderId: folder.id },
          select: {
            id: true,
            path: true,
            fileModifiedAt: true,
            source: true,
          },
        });
        const existingMap = new Map(existing.map((e) => [e.path, e] as const));
        // 스트리밍 중 발견된 경로를 기록 → 완료 후 stale row 감지에 사용
        const discoveredPathSet = new Set<string>();
        // 기존 파일 중 mtime 변경되어 재처리가 필요한 항목은 스트리밍 후 2차 처리
        const deferredExisting: string[] = [];

        type DataEntry = {
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
        const pending: DataEntry[] = [];

        const flushBatch = async (): Promise<void> => {
          if (pending.length === 0) return;
          const batch = pending.splice(0);
          const batchPaths = batch.map((row) => row.path);
          const beforeRows = (await db.image.findMany({
            where: { path: { in: batchPaths } },
            select: { path: true, ...IMAGE_SEARCH_STAT_SOURCE_SELECT },
          })) as Array<{ path: string } & ImageSearchStatSource>;
          const beforeMap = new Map(beforeRows.map((row) => [row.path, row]));
          const images = await db.$transaction(
            batch.map((data) =>
              db.image.upsert({
                where: { path: data.path },
                update: data,
                create: data,
              }),
            ),
          );
          await applyImageSearchStatsMutations(
            batch.map((row) => ({
              before: beforeMap.get(row.path) ?? null,
              after: row,
            })),
            onSearchStatsProgress,
          );
          onBatch(images as unknown as ImageRow[]);
        };

        const processFile = async (filePath: string): Promise<void> => {
          try {
            if (duplicateIncomingPathSet.has(filePath)) return;
            if (await isIgnoredDuplicatePath(filePath)) return;

            const stat = await fs.promises.stat(filePath);
            const mtime = stat.mtime;

            const existingRow = existingMap.get(filePath);
            if (
              existingRow &&
              existingRow.fileModifiedAt.getTime() === mtime.getTime() &&
              existingRow.source !== "unknown"
            ) {
              return;
            }

            const meta = await naiPool.run(filePath);
            pending.push({
              path: filePath,
              folderId: folder.id,
              prompt: meta?.prompt ?? "",
              negativePrompt: meta?.negativePrompt ?? "",
              characterPrompts: JSON.stringify(meta?.characterPrompts ?? []),
              promptTokens: JSON.stringify(
                parsePromptTokens(meta?.prompt ?? ""),
              ),
              negativePromptTokens: JSON.stringify(
                parsePromptTokens(meta?.negativePrompt ?? ""),
              ),
              characterPromptTokens: JSON.stringify(
                (meta?.characterPrompts ?? []).flatMap(parsePromptTokens),
              ),
              source: meta?.source ?? "unknown",
              model: meta?.model ?? "",
              seed: Number.isFinite(meta?.seed) ? meta!.seed : 0,
              width: meta?.width ?? 0,
              height: meta?.height ?? 0,
              sampler: meta?.sampler ?? "",
              steps: meta?.steps ?? 0,
              cfgScale: meta?.cfgScale ?? 0,
              cfgRescale: meta?.cfgRescale ?? 0,
              noiseSchedule: meta?.noiseSchedule ?? "",
              varietyPlus: meta?.varietyPlus ?? false,
              fileSize: stat.size,
              fileModifiedAt: mtime,
            });
            if (pending.length >= BATCH_SIZE) await flushBatch();
          } catch {
            // skip unreadable or inaccessible files
          } finally {
            done++;
            const progressNow = Date.now();
            if (progressNow - lastProgressAt >= 100) {
              lastProgressAt = progressNow;
              onProgress?.(done, total);
            }
          }
        };

        // Phase 1: 스트리밍으로 신규 파일을 발견 즉시 처리, 기존 파일은 분류만
        await withConcurrency(
          walkImageFiles(folder.path, signal),
          SYNC_SCAN_CONCURRENCY,
          async (filePath) => {
            discoveredPathSet.add(filePath);
            const existingRow = existingMap.get(filePath);
            if (!existingRow) {
              // 신규 파일 → 즉시 처리
              await processFile(filePath);
            } else {
              // 기존 파일 → mtime 변경 여부 확인 후 재처리 대상만 기록
              if (
                existingRow.fileModifiedAt.getTime() !==
                  (await fs.promises
                    .stat(filePath)
                    .then((s) => s.mtime.getTime())
                    .catch(() => existingRow.fileModifiedAt.getTime())) ||
                existingRow.source === "unknown"
              ) {
                deferredExisting.push(filePath);
              } else {
                done++;
                const progressNow = Date.now();
                if (progressNow - lastProgressAt >= 100) {
                  lastProgressAt = progressNow;
                  onProgress?.(done, total);
                }
              }
            }
          },
          signal,
        );

        // Phase 2: 기존 파일 중 재처리 필요한 항목 처리
        if (deferredExisting.length > 0 && !signal?.cancelled) {
          await withConcurrency(
            deferredExisting,
            SYNC_SCAN_CONCURRENCY,
            processFile,
            signal,
          );
        }

        await flushBatch();

        // Phase 3: 디스크에서 사라진 stale row 정리
        const staleRows = existing.filter(
          (row) => !discoveredPathSet.has(row.path),
        );
        if (staleRows.length > 0) {
          for (let i = 0; i < staleRows.length; i += 400) {
            const chunk = staleRows.slice(i, i + 400);
            const chunkIds = chunk.map((row) => row.id);
            chunk.forEach((row) => deletedSimilarityIds.add(row.id));
            // Fetch search-stat fields only for the stale rows being deleted
            const statRows = (await db.image.findMany({
              where: { id: { in: chunkIds } },
              select: IMAGE_SEARCH_STAT_SOURCE_SELECT,
            })) as ImageSearchStatSource[];
            await db.image.deleteMany({
              where: { id: { in: chunkIds } },
            });
            await decrementImageSearchStatsForRows(
              statRows,
              onSearchStatsProgress,
            );
          }
        }
        // Update folder fingerprint after successful sync
        await db.folder.update({
          where: { id: folder.id },
          data: {
            lastScanFileCount: discoveredPathSet.size,
            lastScanFinishedAt: new Date(),
          },
        });
      } finally {
        onFolderEnd?.(folder.id);
      }
    }

    if (signal?.cancelled) return;

    if (deletedSimilarityIds.size > 0) {
      await deleteSimilarityCacheForImageIds([...deletedSimilarityIds]);
    }

    onProgress?.(done, total);
    success = true;
  } finally {
    const elapsedMs = Date.now() - startedAt;
    console.info(
      `[image.syncAllFolders] end elapsedMs=${elapsedMs} folders=${folderCount} skipped=${skippedCount} processed=${done}/${total} detectDuplicates=${detectDuplicates} cancelled=${signal?.cancelled === true} success=${success}`,
    );
  }
}

export async function refreshImagePrompts(
  onProgress?: (done: number, total: number) => void,
  onBatch?: (images: ImageRow[]) => void,
  signal?: CancelToken,
): Promise<number> {
  const db = getDB();
  const rows = await db.image.findMany({
    where: { source: "unknown" },
    select: { id: true, path: true },
  });

  if (rows.length === 0) return 0;

  const total = rows.length;
  let done = 0;
  let updated = 0;
  let lastProgressAt = 0;

  type DataEntry = {
    path: string;
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
  };
  const pending: DataEntry[] = [];

  const flushBatch = async (): Promise<void> => {
    if (pending.length === 0) return;
    const batch = pending.splice(0);
    const batchPaths = batch.map((row) => row.path);
    const beforeRows = (await db.image.findMany({
      where: { path: { in: batchPaths } },
      select: { path: true, ...IMAGE_SEARCH_STAT_SOURCE_SELECT },
    })) as Array<{ path: string } & ImageSearchStatSource>;
    const beforeMap = new Map(beforeRows.map((row) => [row.path, row]));
    const images = await db.$transaction(
      batch.map((data) =>
        db.image.update({
          where: { path: data.path },
          data,
        }),
      ),
    );
    await applyImageSearchStatsMutations(
      batch.map((row) => ({
        before: beforeMap.get(row.path) ?? null,
        after: row,
      })),
    );
    onBatch?.(images as unknown as ImageRow[]);
    updated += images.length;
  };

  await withConcurrency(
    rows.map((r) => r.path),
    SYNC_SCAN_CONCURRENCY,
    async (filePath) => {
      try {
        if (signal?.cancelled) return;

        const meta = await naiPool.run(filePath);
        if (!meta || meta.source === "unknown") return;

        pending.push({
          path: filePath,
          prompt: meta.prompt ?? "",
          negativePrompt: meta.negativePrompt ?? "",
          characterPrompts: JSON.stringify(meta.characterPrompts ?? []),
          promptTokens: JSON.stringify(parsePromptTokens(meta.prompt ?? "")),
          negativePromptTokens: JSON.stringify(
            parsePromptTokens(meta.negativePrompt ?? ""),
          ),
          characterPromptTokens: JSON.stringify(
            (meta.characterPrompts ?? []).flatMap(parsePromptTokens),
          ),
          source: meta.source,
          model: meta.model ?? "",
          seed: meta.seed ?? 0,
          width: meta.width ?? 0,
          height: meta.height ?? 0,
          sampler: meta.sampler ?? "",
          steps: meta.steps ?? 0,
          cfgScale: meta.cfgScale ?? 0,
          cfgRescale: meta.cfgRescale ?? 0,
          noiseSchedule: meta.noiseSchedule ?? "",
          varietyPlus: meta.varietyPlus ?? false,
        });
        if (pending.length >= BATCH_SIZE) await flushBatch();
      } catch {
        // skip unreadable files
      } finally {
        done++;
        const progressNow = Date.now();
        if (done === total || progressNow - lastProgressAt >= 100) {
          lastProgressAt = progressNow;
          onProgress?.(done, total);
        }
      }
    },
    signal,
  );

  await flushBatch();
  return updated;
}

export async function rescanAllMetadata(
  onProgress?: (done: number, total: number) => void,
  onBatch?: (images: ImageRow[]) => void,
  onSearchStatsProgress?: (done: number, total: number) => void,
  signal?: CancelToken,
): Promise<number> {
  const db = getDB();
  const rows = await db.image.findMany({
    select: { id: true, path: true },
  });

  if (rows.length === 0) return 0;

  const total = rows.length;
  let done = 0;
  let updated = 0;
  let lastProgressAt = 0;

  type DataEntry = {
    path: string;
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
  };
  const pending: DataEntry[] = [];

  const flushBatch = async (): Promise<void> => {
    if (pending.length === 0) return;
    const batch = pending.splice(0);
    const batchPaths = batch.map((row) => row.path);
    const beforeRows = (await db.image.findMany({
      where: { path: { in: batchPaths } },
      select: { path: true, ...IMAGE_SEARCH_STAT_SOURCE_SELECT },
    })) as Array<{ path: string } & ImageSearchStatSource>;
    const beforeMap = new Map(beforeRows.map((row) => [row.path, row]));
    await ensureImageSearchStatTable();
    const deltas = buildStatDeltasFromMutations(
      batch.map((row) => ({
        before: beforeMap.get(row.path) ?? null,
        after: row,
      })),
    );
    const images = await db.$transaction(async (tx) => {
      const results = await Promise.all(
        batch.map((data) =>
          tx.image.update({
            where: { path: data.path },
            data,
          }),
        ),
      );
      await applySearchStatDeltasInTx(tx, deltas, onSearchStatsProgress);
      return results;
    });
    onBatch?.(images as unknown as ImageRow[]);
    updated += images.length;
  };

  await withConcurrency(
    rows.map((r) => r.path),
    SYNC_SCAN_CONCURRENCY,
    async (filePath) => {
      try {
        if (signal?.cancelled) return;

        const meta = await naiPool.run(filePath);
        if (!meta) return;

        pending.push({
          path: filePath,
          prompt: meta.prompt ?? "",
          negativePrompt: meta.negativePrompt ?? "",
          characterPrompts: JSON.stringify(meta.characterPrompts ?? []),
          promptTokens: JSON.stringify(parsePromptTokens(meta.prompt ?? "")),
          negativePromptTokens: JSON.stringify(
            parsePromptTokens(meta.negativePrompt ?? ""),
          ),
          characterPromptTokens: JSON.stringify(
            (meta.characterPrompts ?? []).flatMap(parsePromptTokens),
          ),
          source: meta.source,
          model: meta.model ?? "",
          seed: Number.isFinite(meta.seed) ? meta.seed : 0,
          width: meta.width ?? 0,
          height: meta.height ?? 0,
          sampler: meta.sampler ?? "",
          steps: meta.steps ?? 0,
          cfgScale: meta.cfgScale ?? 0,
          cfgRescale: meta.cfgRescale ?? 0,
          noiseSchedule: meta.noiseSchedule ?? "",
          varietyPlus: meta.varietyPlus ?? false,
        });
        if (pending.length >= BATCH_SIZE) await flushBatch();
      } catch {
        // skip unreadable files
      } finally {
        done++;
        const progressNow = Date.now();
        if (done === total || progressNow - lastProgressAt >= 100) {
          lastProgressAt = progressNow;
          onProgress?.(done, total);
        }
      }
    },
    signal,
  );

  await flushBatch();
  return updated;
}

export async function rescanImageMetadata(
  paths: string[],
  onBatch?: (images: ImageRow[]) => void,
): Promise<number> {
  if (paths.length === 0) return 0;

  const db = getDB();
  let updated = 0;

  for (let i = 0; i < paths.length; i += BATCH_SIZE) {
    const chunk = paths.slice(i, i + BATCH_SIZE);
    type MetaEntry = {
      path: string;
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
    };
    const entries: MetaEntry[] = [];

    for (const filePath of chunk) {
      try {
        const meta = await naiPool.run(filePath);
        if (!meta) continue;
        entries.push({
          path: filePath,
          prompt: meta.prompt ?? "",
          negativePrompt: meta.negativePrompt ?? "",
          characterPrompts: JSON.stringify(meta.characterPrompts ?? []),
          promptTokens: JSON.stringify(parsePromptTokens(meta.prompt ?? "")),
          negativePromptTokens: JSON.stringify(
            parsePromptTokens(meta.negativePrompt ?? ""),
          ),
          characterPromptTokens: JSON.stringify(
            (meta.characterPrompts ?? []).flatMap(parsePromptTokens),
          ),
          source: meta.source,
          model: meta.model ?? "",
          seed: Number.isFinite(meta.seed) ? meta.seed : 0,
          width: meta.width ?? 0,
          height: meta.height ?? 0,
          sampler: meta.sampler ?? "",
          steps: meta.steps ?? 0,
          cfgScale: meta.cfgScale ?? 0,
          cfgRescale: meta.cfgRescale ?? 0,
          noiseSchedule: meta.noiseSchedule ?? "",
          varietyPlus: meta.varietyPlus ?? false,
        });
      } catch {
        // skip unreadable files
      }
    }

    if (entries.length === 0) continue;

    const batchPaths = entries.map((e) => e.path);
    const beforeRows = (await db.image.findMany({
      where: { path: { in: batchPaths } },
      select: { path: true, ...IMAGE_SEARCH_STAT_SOURCE_SELECT },
    })) as Array<{ path: string } & ImageSearchStatSource>;
    const beforeMap = new Map(beforeRows.map((r) => [r.path, r]));

    const images = await db.$transaction(
      entries.map((data) =>
        db.image.update({ where: { path: data.path }, data }),
      ),
    );
    await applyImageSearchStatsMutations(
      entries.map((row) => ({
        before: beforeMap.get(row.path) ?? null,
        after: row,
      })),
    );
    onBatch?.(images as unknown as ImageRow[]);
    updated += images.length;
  }

  return updated;
}
