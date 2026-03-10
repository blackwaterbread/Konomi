import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Worker } from "worker_threads";
import { getDB } from "./db";
import { getFolders } from "./folder";
import { scanPngFiles, withConcurrency } from "./scanner";
import type { CancelToken } from "./scanner";
import { parsePromptTokens } from "./token";
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
  try {
    const buf = await fs.promises.readFile(filePath);
    return crypto.createHash("sha1").update(buf).digest("hex");
  } catch {
    return null;
  }
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
    24,
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
    24,
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
    8,
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
    8,
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
    await db.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS IgnoredDuplicatePath (
        path TEXT PRIMARY KEY,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    );
    const rows = (await db.$queryRawUnsafe(
      "SELECT path FROM IgnoredDuplicatePath",
    )) as Array<{ path: string }>;
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

// ── Public API ────────────────────────────────────────────────

export async function listImages(): Promise<ImageRow[]> {
  return getDB().image.findMany({
    orderBy: { createdAt: "desc" },
  }) as unknown as Promise<ImageRow[]>;
}

type NormalizedImageListQuery = {
  page: number;
  pageSize: number;
  folderIds: number[];
  searchQuery: string;
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

function normalizeImageListQuery(
  query?: ImageListQuery,
): NormalizedImageListQuery {
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
    searchQuery: String(query?.searchQuery ?? "").trim(),
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

  if (query.searchQuery) {
    andConditions.push({
      OR: [
        { promptTokens: { contains: query.searchQuery } },
        { negativePromptTokens: { contains: query.searchQuery } },
        { characterPromptTokens: { contains: query.searchQuery } },
        { prompt: { contains: query.searchQuery } },
        { negativePrompt: { contains: query.searchQuery } },
        { characterPrompts: { contains: query.searchQuery } },
      ],
    });
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
    const sorted = [...candidates].sort((a, b) => {
      const rankA = randomRank(normalized.randomSeed, a);
      const rankB = randomRank(normalized.randomSeed, b);
      if (rankA !== rankB) return rankA - rankB;
      return a.id - b.id;
    });
    const totalCount = sorted.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / normalized.pageSize));
    const pageRows = sorted.slice(offset, offset + normalized.pageSize);
    if (pageRows.length === 0) {
      return {
        rows: [],
        totalCount,
        page: normalized.page,
        pageSize: normalized.pageSize,
        totalPages,
      };
    }
    const ids = pageRows.map((row) => row.id);
    const rows = (await db.image.findMany({
      where: { id: { in: ids } },
    })) as unknown as ImageRow[];
    const rowMap = new Map(rows.map((row) => [row.id, row]));
    const orderedRows = ids
      .map((id) => rowMap.get(id))
      .filter((row): row is ImageRow => row !== undefined);
    return {
      rows: orderedRows,
      totalCount,
      page: normalized.page,
      pageSize: normalized.pageSize,
      totalPages,
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
    options?.incomingPaths ?? (await scanPngFiles(folderPath))
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
  await withConcurrency(candidates, 8, async (row) => {
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
    } catch (e: unknown) {
      // If already removed by watcher race, treat as resolved.
      const message = e instanceof Error ? e.message : String(e);
      if (!message.includes("Record to delete does not exist")) {
        throw e;
      }
    }
  }

  await registerIgnoredDuplicatePaths(Array.from(ignoredIncomingPaths));

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
  // Re-process images that are in old string[] format (new format always contains '"text"')
  const images = await db.image.findMany({
    where: { NOT: { promptTokens: { contains: '"text"' } } },
    select: {
      id: true,
      prompt: true,
      negativePrompt: true,
      characterPrompts: true,
    },
  });
  for (const img of images) {
    const charPrompts = JSON.parse(img.characterPrompts) as string[];
    await db.image.update({
      where: { id: img.id },
      data: {
        promptTokens: JSON.stringify(parsePromptTokens(img.prompt)),
        negativePromptTokens: JSON.stringify(
          parsePromptTokens(img.negativePrompt),
        ),
        characterPromptTokens: JSON.stringify(
          charPrompts.flatMap(parsePromptTokens),
        ),
      },
    });
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
): Promise<void> {
  const startedAt = Date.now();
  let done = 0;
  let total = 0;
  let folderCount = 0;
  let success = false;
  let lastProgressAt = 0;
  const detectDuplicates = Boolean(onDuplicateGroup);
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

    // Pre-collect all file paths to know total count
    const folderFiles = await Promise.all(
      folders.map(async (folder) => ({
        folder,
        filePaths: await scanPngFiles(folder.path),
      })),
    );
    total = folderFiles.reduce(
      (sum, { filePaths }) => sum + filePaths.length,
      0,
    );
    onProgress?.(done, total);

    const duplicateIncomingPathSet = new Set<string>();
    if (onDuplicateGroup && !signal?.cancelled) {
      const incomingPaths = folderFiles.flatMap(({ filePaths }) => filePaths);
      const existingRows = await db.image.findMany({
        select: { id: true, path: true },
      });
      const existingPathSet = new Set(existingRows.map((row) => row.path));
      const incomingCandidates: string[] = [];
      await withConcurrency(
        incomingPaths,
        24,
        async (incomingPath) => {
          if (existingPathSet.has(incomingPath)) return;
          if (await isIgnoredDuplicatePath(incomingPath)) return;
          incomingCandidates.push(incomingPath);
        },
        signal,
      );

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

    await Promise.all(
      folderFiles.map(async ({ folder, filePaths }) => {
        if (signal?.cancelled) return;

        onFolderStart?.(folder.id, folder.name);
        try {
          const existing = await db.image.findMany({
            where: { folderId: folder.id },
            select: { path: true, fileModifiedAt: true },
          });
          const existingMap = new Map(
            existing.map((e) => [e.path, e.fileModifiedAt]),
          );

          // 신규 파일 먼저, 기존 파일은 최근 mtime 순으로 처리 — 첫 배치에 최신 이미지가 포함되도록
          const sortedFilePaths = [
            ...filePaths.filter((p) => !existingMap.has(p)),
            ...filePaths
              .filter((p) => existingMap.has(p))
              .sort(
                (a, b) =>
                  existingMap.get(b)!.getTime() - existingMap.get(a)!.getTime(),
              ),
          ];

          // I/O 결과를 모아 트랜잭션으로 일괄 쓰기 — 개별 upsert보다 10~100배 빠름
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
            const images = await db.$transaction(
              batch.map((data) =>
                db.image.upsert({
                  where: { path: data.path },
                  update: data,
                  create: data,
                }),
              ),
            );
            onBatch(images as unknown as ImageRow[]);
          };

          await withConcurrency(
            sortedFilePaths,
            20,
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
                )
                  return;

                const meta = await naiPool.run(filePath);
                pending.push({
                  path: filePath,
                  folderId: folder.id,
                  prompt: meta?.prompt ?? "",
                  negativePrompt: meta?.negativePrompt ?? "",
                  characterPrompts: JSON.stringify(
                    meta?.characterPrompts ?? [],
                  ),
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
      }),
    );
    success = true;
  } finally {
    const elapsedMs = Date.now() - startedAt;
    console.info(
      `[image.syncAllFolders] end elapsedMs=${elapsedMs} folders=${folderCount} processed=${done}/${total} detectDuplicates=${detectDuplicates} cancelled=${signal?.cancelled === true} success=${success}`,
    );
  }
}
