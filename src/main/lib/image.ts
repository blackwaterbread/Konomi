import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import { Worker } from "worker_threads";
import { getDB } from "./db";
import { getFolders } from "./folder";
import { scanPngFiles, withConcurrency } from "./scanner";
import type { CancelToken } from "./scanner";
import { parsePromptTokens } from "./token";
import {
  deleteSimilarityCacheForImageIds,
  refreshSimilarityCacheForImageIds,
} from "./phash";
import type { NovelAIMeta } from "@/types/nai";
import type { Prisma } from "../../generated/prisma/client";

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
  fileSize: number;
  fileModifiedAt: Date;
  createdAt: Date;
};

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
    resolve: (r: NovelAIMeta | null) => void;
  }> = [];
  private callbacks = new Map<number, (r: NovelAIMeta | null) => void>();
  private workerTask = new Map<Worker, number>();
  private seq = 0;

  constructor(size: number, workerPath: string) {
    for (let i = 0; i < size; i++) this.addWorker(workerPath);
  }

  private addWorker(workerPath: string): void {
    const w = new Worker(workerPath);
    w.on(
      "message",
      ({ id, result }: { id: number; result: NovelAIMeta | null }) => {
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

  run(filePath: string): Promise<NovelAIMeta | null> {
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
  rows: Array<{ id: number; path: string }>,
  signal?: CancelToken,
): Promise<ExistingSizeBuckets> {
  const buckets: ExistingSizeBuckets = new Map();
  await withConcurrency(
    rows,
    SIZE_SCAN_CONCURRENCY,
    async (row) => {
      const size = await fileSize(row.path);
      if (size === null) return;
      const bucket = buckets.get(size) ?? [];
      bucket.push({
        imageId: row.id,
        path: row.path,
        fileName: path.basename(row.path),
      });
      buckets.set(size, bucket);
    },
    signal,
  );
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

async function ensureIgnoredDuplicatePathsLoaded(): Promise<void> {
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
  const db = getDB();
  for (const filePath of paths) {
    if (ignoredDuplicatePaths.has(filePath)) continue;
    ignoredDuplicatePaths.add(filePath);
    await db.$executeRawUnsafe(
      "INSERT OR IGNORE INTO IgnoredDuplicatePath (path) VALUES (?)",
      filePath,
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

export type ImageSearchStatSource = Pick<
  ImageRow,
  | "width"
  | "height"
  | "model"
  | "promptTokens"
  | "negativePromptTokens"
  | "characterPromptTokens"
>;

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

async function applyImageSearchStatDeltas(
  deltas: ImageSearchStatDelta[],
  onProgress?: SearchStatsProgressCallback,
): Promise<void> {
  if (deltas.length === 0) return;
  await ensureImageSearchStatTable();
  const db = getDB();
  const total = deltas.length;
  let done = 0;
  let lastProgressAt = 0;
  onProgress?.(done, total);
  await db.$transaction(async (tx) => {
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

function buildTagStatRows(
  rows: SearchStatTokenSourceRow[],
): Array<{ key: string; tag: string; count: number }> {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const row of rows) {
    for (const field of TOKEN_TEXT_FIELDS) {
      const tokenTexts = extractTokenTexts(row[field]);
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
  }
  return Array.from(counts.entries()).map(([key, value]) => ({
    key,
    tag: value.tag,
    count: value.count,
  }));
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
  const tokenSourceRows = (await db.image.findMany({
    select: IMAGE_SEARCH_STAT_SOURCE_SELECT,
  })) as SearchStatTokenSourceRow[];
  const tagRows = buildTagStatRows(tokenSourceRows);
  imageSearchTagStatsBackfillAttempted = true;

  const total = 1 + resolutionRows.length + modelRows.length + tagRows.length;
  let done = 0;
  let lastProgressAt = 0;
  onProgress?.(done, total);

  await db.$executeRawUnsafe("DELETE FROM ImageSearchStat");
  done++;
  onProgress?.(done, total);

  for (const row of resolutionRows) {
    if (!Number.isInteger(row.width) || !Number.isInteger(row.height)) continue;
    await db.$executeRawUnsafe(
      `INSERT INTO ImageSearchStat (kind, key, width, height, model, count, updatedAt)
       VALUES (?, ?, ?, ?, NULL, ?, CURRENT_TIMESTAMP)`,
      "resolution",
      `${row.width}x${row.height}`,
      row.width,
      row.height,
      row.count,
    );
    done++;
    const now = Date.now();
    if (done === total || now - lastProgressAt >= 100) {
      lastProgressAt = now;
      onProgress?.(done, total);
    }
  }
  for (const row of modelRows) {
    await db.$executeRawUnsafe(
      `INSERT INTO ImageSearchStat (kind, key, width, height, model, count, updatedAt)
       VALUES (?, ?, NULL, NULL, ?, ?, CURRENT_TIMESTAMP)`,
      "model",
      row.model ?? "",
      row.model ?? "",
      row.count,
    );
    done++;
    const now = Date.now();
    if (done === total || now - lastProgressAt >= 100) {
      lastProgressAt = now;
      onProgress?.(done, total);
    }
  }
  for (const row of tagRows) {
    await db.$executeRawUnsafe(
      `INSERT INTO ImageSearchStat (kind, key, width, height, model, count, updatedAt)
       VALUES (?, ?, NULL, NULL, ?, ?, CURRENT_TIMESTAMP)`,
      "tag",
      row.key,
      row.tag,
      row.count,
    );
    done++;
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
    .toLowerCase();
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
    "LOWER(REPLACE(REPLACE(REPLACE(REPLACE(key, '[', ''), ']', ''), '{', ''), '}', ''))";
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
      const key = tag.toLowerCase();
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

export async function listImages(): Promise<ImageRow[]> {
  return getDB().image.findMany({
    orderBy: { createdAt: "desc" },
  }) as unknown as Promise<ImageRow[]>;
}

export async function listImageIdsForFolder(
  folderId: number,
): Promise<number[]> {
  const rows = await getDB().image.findMany({
    where: { folderId },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

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

      const dedupeKey = term.toLowerCase();
      if (seenTerms.has(dedupeKey)) continue;
      seenTerms.add(dedupeKey);
      groupTerms.push(term);
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
  };
}

function buildImageWhereInput(
  query: NormalizedImageListQuery,
): Prisma.ImageWhereInput {
  const andConditions: Prisma.ImageWhereInput[] = [];

  andConditions.push({ folderId: { in: query.folderIds } });

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

function hashStringToUint32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function randomRank(seed: number, row: { id: number; path: string }): number {
  return hashStringToUint32(`${seed}:${row.id}:${row.path}`);
}

function compareRandomCandidates(
  seed: number,
  a: { id: number; path: string },
  b: { id: number; path: string },
): number {
  const rankA = randomRank(seed, a);
  const rankB = randomRank(seed, b);
  if (rankA !== rankB) return rankA - rankB;
  return a.id - b.id;
}

function pickRandomCandidates(
  seed: number,
  candidates: Array<{ id: number; path: string }>,
  limit: number,
): number[] {
  if (limit <= 0 || candidates.length === 0) return [];

  const picked: Array<{ id: number; path: string }> = [];
  for (const candidate of candidates) {
    if (picked.length < limit) {
      picked.push(candidate);
      continue;
    }

    let worstIndex = 0;
    for (let i = 1; i < picked.length; i++) {
      if (compareRandomCandidates(seed, picked[worstIndex], picked[i]) < 0) {
        worstIndex = i;
      }
    }

    if (compareRandomCandidates(seed, candidate, picked[worstIndex]) < 0) {
      picked[worstIndex] = candidate;
    }
  }

  picked.sort((a, b) => compareRandomCandidates(seed, a, b));
  return picked.map((row) => row.id);
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
  const where = buildImageWhereInput(normalized);

  if (normalized.builtinCategory === "random") {
    const candidates = await db.image.findMany({
      where,
      select: { id: true, path: true },
    });
    const ids = pickRandomCandidates(
      normalized.randomSeed,
      candidates,
      normalized.pageSize,
    );
    if (ids.length === 0) {
      return {
        rows: [],
        totalCount: 0,
        page: normalized.page,
        pageSize: normalized.pageSize,
        totalPages: 1,
      };
    }
    const rows = (await db.image.findMany({
      where: { id: { in: ids } },
    })) as unknown as ImageRow[];
    const rowMap = new Map(rows.map((row) => [row.id, row]));
    const orderedRows = ids
      .map((id) => rowMap.get(id))
      .filter((row): row is ImageRow => row !== undefined);
    return {
      rows: orderedRows,
      totalCount: ids.length,
      page: normalized.page,
      pageSize: normalized.pageSize,
      totalPages: 1,
    };
  }

  const totalCount = await db.image.count({ where });
  const rows = (await db.image.findMany({
    where,
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
  const db = getDB();
  const incomingPaths = (
    options?.incomingPaths ?? (await scanPngFiles(folderPath, options?.signal))
  ).filter((filePath) => !ignoredDuplicatePaths.has(filePath));
  if (incomingPaths.length === 0) return [];

  const incomingPathSet = new Set(incomingPaths);
  const existingRows = await db.image.findMany({
    select: { id: true, path: true },
  });
  const existingSizeBuckets = await buildExistingSizeBuckets(
    existingRows,
    options?.signal,
  );
  const incomingSizeBuckets = await buildIncomingSizeBuckets(
    incomingPaths,
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

export async function backfillPromptTokens(): Promise<void> {
  const db = getDB();
  const touchedImageIds: number[] = [];
  // Re-process images that are in old string[] format (new format always contains '"text"')
  const images = await db.image.findMany({
    where: { NOT: { promptTokens: { contains: '"text"' } } },
    select: {
      id: true,
      width: true,
      height: true,
      model: true,
      prompt: true,
      negativePrompt: true,
      characterPrompts: true,
      promptTokens: true,
      negativePromptTokens: true,
      characterPromptTokens: true,
    },
  });
  for (const img of images) {
    const charPrompts = JSON.parse(img.characterPrompts) as string[];
    const nextPromptTokens = JSON.stringify(parsePromptTokens(img.prompt));
    const nextNegativePromptTokens = JSON.stringify(
      parsePromptTokens(img.negativePrompt),
    );
    const nextCharacterPromptTokens = JSON.stringify(
      charPrompts.flatMap(parsePromptTokens),
    );
    if (
      img.promptTokens === nextPromptTokens &&
      img.negativePromptTokens === nextNegativePromptTokens &&
      img.characterPromptTokens === nextCharacterPromptTokens
    ) {
      continue;
    }
    await db.image.update({
      where: { id: img.id },
      data: {
        promptTokens: nextPromptTokens,
        negativePromptTokens: nextNegativePromptTokens,
        characterPromptTokens: nextCharacterPromptTokens,
      },
    });
    touchedImageIds.push(img.id);
    await applyImageSearchStatsMutation(img, {
      ...img,
      promptTokens: nextPromptTokens,
      negativePromptTokens: nextNegativePromptTokens,
      characterPromptTokens: nextCharacterPromptTokens,
    });
  }
  if (touchedImageIds.length > 0) {
    await refreshSimilarityCacheForImageIds(touchedImageIds);
  }
}

export async function syncAllFolders(
  onBatch: (images: ImageRow[]) => void,
  onProgress?: (done: number, total: number) => void,
  onFolderStart?: (folderId: number, folderName: string) => void,
  onFolderEnd?: (folderId: number) => void,
  signal?: CancelToken,
  onDuplicateGroup?: (group: FolderDuplicateGroup) => void,
  orderedFolderIds?: number[],
  onSearchStatsProgress?: SearchStatsProgressCallback,
): Promise<void> {
  const startedAt = Date.now();
  let done = 0;
  let total = 0;
  let folderCount = 0;
  let success = false;
  let lastProgressAt = 0;
  const detectDuplicates = Boolean(onDuplicateGroup);
  const deletedSimilarityIds = new Set<number>();
  const upsertedSimilarityIds = new Set<number>();
  console.info(
    `[image.syncAllFolders] start detectDuplicates=${detectDuplicates}`,
  );

  try {
    const rawFolders = await getFolders();
    const folders =
      orderedFolderIds && orderedFolderIds.length > 0
        ? (() => {
            const folderMap = new Map(rawFolders.map((f) => [f.id, f]));
            const ordered = orderedFolderIds
              .map((id) => folderMap.get(id))
              .filter((f): f is (typeof rawFolders)[0] => f !== undefined);
            const orderedSet = new Set(orderedFolderIds);
            const remaining = rawFolders.filter((f) => !orderedSet.has(f.id));
            return [...ordered, ...remaining];
          })()
        : rawFolders;
    folderCount = folders.length;
    const db = getDB();

    const preScannedTotals = detectDuplicates;
    const duplicateIncomingPathSet = new Set<string>();

    if (onDuplicateGroup && !signal?.cancelled) {
      const existingRows = await db.image.findMany({
        select: { id: true, path: true },
      });
      const existingPathSet = new Set(existingRows.map((row) => row.path));
      const incomingCandidates: string[] = [];

      for (const folder of folders) {
        if (signal?.cancelled) break;

        const folderPaths = await scanPngFiles(folder.path, signal);
        total += folderPaths.length;

        await withConcurrency(
          folderPaths,
          SIZE_SCAN_CONCURRENCY,
          async (incomingPath) => {
            if (existingPathSet.has(incomingPath)) return;
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
        const existingSizeBuckets = await buildExistingSizeBuckets(
          existingRows,
          signal,
        );
        if (signal?.cancelled) return;
        const incomingSizeBuckets = await buildIncomingSizeBuckets(
          incomingCandidates,
          signal,
        );
        if (signal?.cancelled) return;
        const candidateSizes = collectCandidateSizes(
          incomingSizeBuckets,
          existingSizeBuckets,
        );
        if (candidateSizes.length > 0) {
          const existingSignatureBuckets = await buildExistingSignatureBuckets(
            existingSizeBuckets,
            candidateSizes,
            signal,
          );
          if (signal?.cancelled) return;
          const incomingSignatureBuckets = await buildIncomingSignatureBuckets(
            incomingSizeBuckets,
            candidateSizes,
            signal,
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

    for (const folder of folders) {
      if (signal?.cancelled) break;

      const filePaths = await scanPngFiles(folder.path, signal);
      if (!preScannedTotals) {
        total += filePaths.length;
        onProgress?.(done, total);
      }

      onFolderStart?.(folder.id, folder.name);
      try {
        const existing = await db.image.findMany({
          where: { folderId: folder.id },
          select: {
            id: true,
            path: true,
            fileModifiedAt: true,
            ...IMAGE_SEARCH_STAT_SOURCE_SELECT,
          },
        });
        const existingMap = new Map(
          existing.map((e) => [e.path, e.fileModifiedAt]),
        );
        const currentPathSet = new Set(filePaths);
        const staleRows = existing.filter(
          (row) => !currentPathSet.has(row.path),
        );
        if (staleRows.length > 0) {
          // SQLite bind parameter limits require chunked deletes for large sets.
          for (let i = 0; i < staleRows.length; i += 400) {
            const chunk = staleRows.slice(i, i + 400);
            chunk.forEach((row) => deletedSimilarityIds.add(row.id));
            await db.image.deleteMany({
              where: { id: { in: chunk.map((row) => row.id) } },
            });
            await decrementImageSearchStatsForRows(
              chunk,
              onSearchStatsProgress,
            );
          }
        }

        // 신규 파일 먼저, 기존 파일은 최근 mtime 순으로 처리 → 첫 배치에 최신 이미지가 포함되도록
        const sortedFilePaths = [
          ...filePaths.filter((p) => !existingMap.has(p)),
          ...filePaths
            .filter((p) => existingMap.has(p))
            .sort(
              (a, b) =>
                existingMap.get(b)!.getTime() - existingMap.get(a)!.getTime(),
            ),
        ];

        // I/O 결과를 모아 트랜잭션으로 묶어 쓰기 → 개별 upsert보다 10~100배 빠름
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
          for (const image of images) {
            upsertedSimilarityIds.add(image.id);
          }
          await applyImageSearchStatsMutations(
            batch.map((row) => ({
              before: beforeMap.get(row.path) ?? null,
              after: row,
            })),
            onSearchStatsProgress,
          );
          onBatch(images as unknown as ImageRow[]);
        };

        await withConcurrency(
          sortedFilePaths,
          SYNC_SCAN_CONCURRENCY,
          async (filePath) => {
            try {
              if (duplicateIncomingPathSet.has(filePath)) return;
              if (await isIgnoredDuplicatePath(filePath)) return;

              const stat = await fs.promises.stat(filePath);
              const mtime = stat.mtime;

              const existingMtime = existingMap.get(filePath);
              if (
                existingMtime &&
                existingMtime.getTime() === mtime.getTime()
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
                seed: meta?.seed ?? 0,
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
              if (done === total || progressNow - lastProgressAt >= 100) {
                lastProgressAt = progressNow;
                onProgress?.(done, total);
              }
            }
          },
          signal,
        );

        await flushBatch();
      } finally {
        onFolderEnd?.(folder.id);
      }
    }

    if (signal?.cancelled) return;

    if (deletedSimilarityIds.size > 0) {
      await deleteSimilarityCacheForImageIds([...deletedSimilarityIds]);
    }
    if (upsertedSimilarityIds.size > 0) {
      await refreshSimilarityCacheForImageIds([...upsertedSimilarityIds]);
    }
    success = true;
  } finally {
    const elapsedMs = Date.now() - startedAt;
    console.info(
      `[image.syncAllFolders] end elapsedMs=${elapsedMs} folders=${folderCount} processed=${done}/${total} detectDuplicates=${detectDuplicates} cancelled=${signal?.cancelled === true} success=${success}`,
    );
  }
}
