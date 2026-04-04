import os from "os";
import path from "path";
import { Worker } from "worker_threads";
import { getDB } from "./db";
import { withConcurrency } from "./scanner";
import { computeAllPairs, type AllPairsInput, type AllPairsResult } from "./konomi-image";

const SIMILARITY_THRESHOLD = 10;
const HASH_WRITE_BATCH_SIZE = 32;
const CACHE_DELETE_BATCH_SIZE = 400;
const SIMILARITY_REASON_QUERY_BATCH_SIZE = 400;

const STRICT_COMMON_TOKEN_RATIO = 0.15;
const LOOSE_COMMON_TOKEN_RATIO = 0.25;
const MIN_SHARED_POSITIVE_TOKENS_STRICT = 3;
const MIN_SHARED_POSITIVE_TOKENS_LOOSE = 2;
const TEXT_LINK_THRESHOLD_STRICT = 0.64;
const TEXT_LINK_THRESHOLD_LOOSE = 0.54;
const HYBRID_LINK_THRESHOLD_STRICT = 0.74;
const HYBRID_LINK_THRESHOLD_LOOSE = 0.66;
const HYBRID_PHASH_WEIGHT = 0.72;
const HYBRID_TEXT_WEIGHT = 0.28;
const HYBRID_TEXT_THRESHOLD_OFFSET = 0.1;
const CONFLICT_PENALTY_WEIGHT = 0.25;
const UI_THRESHOLD_MIN = 8;
const UI_THRESHOLD_MAX = 16;

const POPCOUNT4 = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

const SIMILARITY_CACHE_TABLE = "ImageSimilarityCache";
const SIMILARITY_CACHE_META_TABLE = "ImageSimilarityCacheMeta";

// Run pHash computations in worker threads to avoid blocking the main process.
const POOL_SIZE = Math.max(4, Math.min(os.availableParallelism() - 1, 8));
const WORKER_PATH = path.join(__dirname, "phash.worker.js");

class PHashPool {
  private idle: Worker[] = [];
  private queue: Array<{
    filePath: string;
    resolve: (h: string | null) => void;
  }> = [];
  private callbacks = new Map<number, (h: string | null) => void>();
  private workerTask = new Map<Worker, number>();
  private seq = 0;

  constructor(size: number, workerPath: string) {
    for (let i = 0; i < size; i++) this.addWorker(workerPath);
  }

  private addWorker(workerPath: string): void {
    const w = new Worker(workerPath);
    w.on("message", ({ id, hash }: { id: number; hash: string | null }) => {
      this.workerTask.delete(w);
      this.callbacks.get(id)?.(hash);
      this.callbacks.delete(id);
      this.dispatch(w);
    });
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

  run(filePath: string): Promise<string | null> {
    return new Promise((resolve) => {
      this.queue.push({ filePath, resolve });
      this.flush();
    });
  }
}

const pHashPool = new PHashPool(POOL_SIZE, WORKER_PATH);

type SimilarityThresholdConfig = {
  looseness: number;
  maxCommonTokenRatio: number;
  minSharedPositiveTokens: number;
  textLinkThreshold: number;
  hybridLinkThreshold: number;
};

type SimilaritySourceRow = {
  id: number;
  pHash: string;
  promptTokens: string;
  negativePromptTokens: string;
  characterPromptTokens: string;
};

type ParsedImageRow = {
  id: number;
  pHash: string;
  prompt: Set<string>;
  character: Set<string>;
  negative: Set<string>;
  positive: Set<string>;
};

type SimilarityImage = ParsedImageRow & {
  promptWeightSum: number;
  characterWeightSum: number;
  negativeWeightSum: number;
  positiveWeightSum: number;
};

type SimilarityCacheRow = {
  imageAId: number;
  imageBId: number;
  phashDistance: number | null;
  textScore: number;
};

export type SimilarityReason = "visual" | "prompt" | "both";
export type SimilarityReasonItem = {
  imageId: number;
  reason: SimilarityReason;
  score: number;
};

export type SimilarGroup = {
  id: string;
  name: string;
  imageIds: number[];
};

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function getThresholdConfig(threshold: number): SimilarityThresholdConfig {
  const span = UI_THRESHOLD_MAX - UI_THRESHOLD_MIN;
  const looseness =
    span <= 0 ? 0.5 : clamp01((threshold - UI_THRESHOLD_MIN) / span);
  return {
    looseness,
    maxCommonTokenRatio: lerp(
      STRICT_COMMON_TOKEN_RATIO,
      LOOSE_COMMON_TOKEN_RATIO,
      looseness,
    ),
    minSharedPositiveTokens:
      looseness < 0.35
        ? MIN_SHARED_POSITIVE_TOKENS_STRICT
        : MIN_SHARED_POSITIVE_TOKENS_LOOSE,
    textLinkThreshold: lerp(
      TEXT_LINK_THRESHOLD_STRICT,
      TEXT_LINK_THRESHOLD_LOOSE,
      looseness,
    ),
    hybridLinkThreshold: lerp(
      HYBRID_LINK_THRESHOLD_STRICT,
      HYBRID_LINK_THRESHOLD_LOOSE,
      looseness,
    ),
  };
}

const LOOSE_THRESHOLD_CONFIG = getThresholdConfig(UI_THRESHOLD_MAX);

function resolveThresholdConfig(
  threshold: number,
  jaccardThreshold?: number,
): SimilarityThresholdConfig {
  const base = getThresholdConfig(threshold);
  if (
    typeof jaccardThreshold !== "number" ||
    !Number.isFinite(jaccardThreshold)
  )
    return base;

  const textLinkThreshold = clamp01(jaccardThreshold);
  return {
    ...base,
    textLinkThreshold,
    hybridLinkThreshold: clamp01(
      textLinkThreshold + HYBRID_TEXT_THRESHOLD_OFFSET,
    ),
  };
}

function normalizeTokenText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function parseTokenSet(raw: string): Set<string> {
  if (!raw) return new Set<string>();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set<string>();
    const result = new Set<string>();
    for (const item of parsed) {
      const token =
        typeof item === "string"
          ? normalizeTokenText(item)
          : normalizeTokenText(
              item && typeof item === "object"
                ? (item as { text?: unknown }).text
                : undefined,
            );
      if (token) result.add(token);
    }
    return result;
  } catch {
    return new Set<string>();
  }
}

function toParsedRows(rows: SimilaritySourceRow[]): ParsedImageRow[] {
  return rows.map((row) => {
    const prompt = parseTokenSet(row.promptTokens);
    const character = parseTokenSet(row.characterPromptTokens);
    const negative = parseTokenSet(row.negativePromptTokens);
    const positive = new Set<string>([...prompt, ...character]);
    return {
      id: row.id,
      pHash: row.pHash,
      prompt,
      character,
      negative,
      positive,
    };
  });
}

function buildIdfMap(rows: ParsedImageRow[]): Map<string, number> {
  const docFrequency = new Map<string, number>();
  for (const row of rows) {
    const seen = new Set<string>([
      ...row.prompt,
      ...row.character,
      ...row.negative,
    ]);
    for (const token of seen) {
      docFrequency.set(token, (docFrequency.get(token) ?? 0) + 1);
    }
  }
  const totalDocs = Math.max(rows.length, 1);
  const result = new Map<string, number>();
  for (const [token, df] of docFrequency) {
    result.set(token, Math.log((totalDocs + 1) / (df + 1)) + 1);
  }
  return result;
}

function sumTokenWeights(
  tokens: Set<string>,
  idfMap: Map<string, number>,
): number {
  let total = 0;
  for (const token of tokens) total += idfMap.get(token) ?? 1;
  return total;
}

function weightedIntersection(
  a: Set<string>,
  b: Set<string>,
  idfMap: Map<string, number>,
): number {
  if (a.size === 0 || b.size === 0) return 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  let total = 0;
  for (const token of smaller) {
    if (larger.has(token)) total += idfMap.get(token) ?? 1;
  }
  return total;
}

function weightedJaccardFromIntersection(
  interWeight: number,
  sumA: number,
  sumB: number,
): number {
  const unionWeight = sumA + sumB - interWeight;
  if (unionWeight <= 0) return 0;
  return interWeight / unionWeight;
}

function computeTextScore(
  a: SimilarityImage,
  b: SimilarityImage,
  idfMap: Map<string, number>,
): number {
  const promptInter = weightedIntersection(a.prompt, b.prompt, idfMap);
  const promptSim = weightedJaccardFromIntersection(
    promptInter,
    a.promptWeightSum,
    b.promptWeightSum,
  );

  const characterInter = weightedIntersection(a.character, b.character, idfMap);
  const characterSim = weightedJaccardFromIntersection(
    characterInter,
    a.characterWeightSum,
    b.characterWeightSum,
  );

  const positiveInter = weightedIntersection(a.positive, b.positive, idfMap);
  const positiveSim = weightedJaccardFromIntersection(
    positiveInter,
    a.positiveWeightSum,
    b.positiveWeightSum,
  );

  const hasPrompt = a.prompt.size > 0 || b.prompt.size > 0;
  const hasCharacter = a.character.size > 0 || b.character.size > 0;
  const promptWeight = hasPrompt ? 0.55 : 0;
  const characterWeight = hasCharacter ? 0.25 : 0;
  const positiveWeight = 1 - promptWeight - characterWeight;
  const base =
    promptWeight * promptSim +
    characterWeight * characterSim +
    positiveWeight * positiveSim;

  const conflictABInter = weightedIntersection(a.positive, b.negative, idfMap);
  const conflictAB = weightedJaccardFromIntersection(
    conflictABInter,
    a.positiveWeightSum,
    b.negativeWeightSum,
  );
  const conflictBAInter = weightedIntersection(b.positive, a.negative, idfMap);
  const conflictBA = weightedJaccardFromIntersection(
    conflictBAInter,
    b.positiveWeightSum,
    a.negativeWeightSum,
  );
  const conflictPenalty = Math.max(conflictAB, conflictBA);

  return clamp01(base - conflictPenalty * CONFLICT_PENALTY_WEIGHT);
}

function computeHybridScore(phashDistance: number, textScore: number): number {
  const phashScore = clamp01(1 - phashDistance / 64);
  return clamp01(
    HYBRID_PHASH_WEIGHT * phashScore + HYBRID_TEXT_WEIGHT * textScore,
  );
}

function shouldPersistCachePair(
  phashDistance: number | null,
  textScore: number,
): boolean {
  if (phashDistance !== null && phashDistance <= UI_THRESHOLD_MAX) return true;
  if (textScore >= LOOSE_THRESHOLD_CONFIG.textLinkThreshold) return true;
  if (phashDistance === null) return false;
  return (
    computeHybridScore(phashDistance, textScore) >=
    LOOSE_THRESHOLD_CONFIG.hybridLinkThreshold
  );
}

function shouldLinkAtThreshold(
  phashDistance: number | null,
  textScore: number,
  threshold: number,
  config: SimilarityThresholdConfig,
): boolean {
  if (phashDistance !== null && phashDistance <= threshold) return true;
  if (textScore >= config.textLinkThreshold) return true;
  if (phashDistance === null) return false;
  return (
    computeHybridScore(phashDistance, textScore) >= config.hybridLinkThreshold
  );
}

function classifyReasonAtThreshold(
  row: SimilarityCacheRow,
  threshold: number,
  config: SimilarityThresholdConfig,
): SimilarityReason | null {
  const visualSignal =
    row.phashDistance !== null && row.phashDistance <= threshold;
  const promptSignal = row.textScore >= config.textLinkThreshold;
  const hybridSignal =
    row.phashDistance !== null &&
    computeHybridScore(row.phashDistance, row.textScore) >=
      config.hybridLinkThreshold;

  if (!(visualSignal || promptSignal || hybridSignal)) return null;
  if (visualSignal && promptSignal) return "both";
  if (!visualSignal && !promptSignal && hybridSignal) return "both";
  if (visualSignal) return "visual";
  return "prompt";
}

function buildSimilarityImages(rows: SimilaritySourceRow[]): {
  images: SimilarityImage[];
  idfMap: Map<string, number>;
} {
  const parsedRows = toParsedRows(rows);
  const idfMap = buildIdfMap(parsedRows);
  const images = parsedRows.map((row) => ({
    ...row,
    promptWeightSum: sumTokenWeights(row.prompt, idfMap),
    characterWeightSum: sumTokenWeights(row.character, idfMap),
    negativeWeightSum: sumTokenWeights(row.negative, idfMap),
    positiveWeightSum: sumTokenWeights(row.positive, idfMap),
  }));
  return { images, idfMap };
}

// Encode SimilarityImage[] into flat typed arrays for the native addon.
function encodeImagesForNative(
  images: SimilarityImage[],
  idfMap: Map<string, number>,
): AllPairsInput {
  const vocab = new Map<string, number>();
  for (const token of idfMap.keys()) vocab.set(token, vocab.size);
  const vsz = vocab.size;
  const N = images.length;

  const imageIds = new Int32Array(N);
  const pHashHex: string[] = new Array(N);
  const promptWts = new Float64Array(N);
  const charWts = new Float64Array(N);
  const negWts = new Float64Array(N);
  const posWts = new Float64Array(N);
  const hasPrompt = new Uint8Array(N);
  const hasChar = new Uint8Array(N);

  let tp = 0,
    tc = 0,
    tn = 0,
    tx = 0;
  for (const img of images) {
    tp += img.prompt.size;
    tc += img.character.size;
    tn += img.negative.size;
    tx += img.positive.size;
  }

  const promptData = new Uint32Array(tp);
  const promptOffsets = new Int32Array(N + 1);
  const charData = new Uint32Array(tc);
  const charOffsets = new Int32Array(N + 1);
  const negData = new Uint32Array(tn);
  const negOffsets = new Int32Array(N + 1);
  const posData = new Uint32Array(tx);
  const posOffsets = new Int32Array(N + 1);

  let pi = 0,
    ci = 0,
    ni = 0,
    xi = 0;
  for (let i = 0; i < N; i++) {
    const img = images[i];
    imageIds[i] = img.id;
    pHashHex[i] = img.pHash?.length === 16 ? img.pHash : "";
    promptWts[i] = img.promptWeightSum;
    charWts[i] = img.characterWeightSum;
    negWts[i] = img.negativeWeightSum;
    posWts[i] = img.positiveWeightSum;
    hasPrompt[i] = img.prompt.size > 0 ? 1 : 0;
    hasChar[i] = img.character.size > 0 ? 1 : 0;

    promptOffsets[i] = pi;
    for (const t of img.prompt) {
      const id = vocab.get(t);
      if (id !== undefined) promptData[pi++] = id;
    }
    charOffsets[i] = ci;
    for (const t of img.character) {
      const id = vocab.get(t);
      if (id !== undefined) charData[ci++] = id;
    }
    negOffsets[i] = ni;
    for (const t of img.negative) {
      const id = vocab.get(t);
      if (id !== undefined) negData[ni++] = id;
    }
    posOffsets[i] = xi;
    for (const t of img.positive) {
      const id = vocab.get(t);
      if (id !== undefined) posData[xi++] = id;
    }
  }
  promptOffsets[N] = pi;
  charOffsets[N] = ci;
  negOffsets[N] = ni;
  posOffsets[N] = xi;

  const tokenWeights = new Float64Array(vsz);
  for (const [token, w] of idfMap) {
    const id = vocab.get(token);
    if (id !== undefined) tokenWeights[id] = w;
  }

  return {
    imageIds,
    pHashHex,
    promptData,
    promptOffsets,
    charData,
    charOffsets,
    negData,
    negOffsets,
    posData,
    posOffsets,
    promptWts,
    charWts,
    negWts,
    posWts,
    hasPrompt,
    hasChar,
    tokenWeights,
    uiThresholdMax: UI_THRESHOLD_MAX,
    textThreshold: LOOSE_THRESHOLD_CONFIG.textLinkThreshold,
    hybridThreshold: LOOSE_THRESHOLD_CONFIG.hybridLinkThreshold,
    hybridPHashWeight: HYBRID_PHASH_WEIGHT,
    hybridTextWeight: HYBRID_TEXT_WEIGHT,
    conflictPenaltyWeight: CONFLICT_PENALTY_WEIGHT,
  };
}

function normalizeImageIds(imageIds: number[]): number[] {
  return [
    ...new Set(imageIds.filter((id) => Number.isInteger(id) && id > 0)),
  ].sort((a, b) => a - b);
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function ensureSimilarityCacheTables(): Promise<void> {
  const db = getDB();
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${SIMILARITY_CACHE_TABLE} (
      imageAId INTEGER NOT NULL,
      imageBId INTEGER NOT NULL,
      phashDistance INTEGER,
      textScore REAL NOT NULL DEFAULT 0,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (imageAId, imageBId),
      CHECK (imageAId < imageBId)
    )
  `);
  await db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_${SIMILARITY_CACHE_TABLE}_a ON ${SIMILARITY_CACHE_TABLE}(imageAId)`,
  );
  await db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_${SIMILARITY_CACHE_TABLE}_b ON ${SIMILARITY_CACHE_TABLE}(imageBId)`,
  );
  await db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_${SIMILARITY_CACHE_TABLE}_d ON ${SIMILARITY_CACHE_TABLE}(phashDistance)`,
  );
  await db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_${SIMILARITY_CACHE_TABLE}_t ON ${SIMILARITY_CACHE_TABLE}(textScore)`,
  );

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${SIMILARITY_CACHE_META_TABLE} (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      primedAt DATETIME
    )
  `);
  await db.$executeRawUnsafe(
    `INSERT OR IGNORE INTO ${SIMILARITY_CACHE_META_TABLE}(id, primedAt) VALUES (1, NULL)`,
  );
}

async function markSimilarityCachePrimed(): Promise<void> {
  const db = getDB();
  await db.$executeRawUnsafe(
    `UPDATE ${SIMILARITY_CACHE_META_TABLE} SET primedAt = datetime('now') WHERE id = 1`,
  );
}

async function markSimilarityCacheUnprimed(): Promise<void> {
  const db = getDB();
  await db.$executeRawUnsafe(
    `UPDATE ${SIMILARITY_CACHE_META_TABLE} SET primedAt = NULL WHERE id = 1`,
  );
}

async function isSimilarityCachePrimed(): Promise<boolean> {
  const db = getDB();
  const rows = await db.$queryRawUnsafe<Array<{ primedAt: string | null }>>(
    `SELECT primedAt FROM ${SIMILARITY_CACHE_META_TABLE} WHERE id = 1 LIMIT 1`,
  );
  return rows[0]?.primedAt != null;
}

async function clearSimilarityCache(): Promise<void> {
  const db = getDB();
  await ensureSimilarityCacheTables();
  await db.$executeRawUnsafe(`DELETE FROM ${SIMILARITY_CACHE_TABLE}`);
  await markSimilarityCacheUnprimed();
}

async function readSimilaritySourceRows(): Promise<SimilaritySourceRow[]> {
  const db = getDB();
  return db.image.findMany({
    select: {
      id: true,
      pHash: true,
      promptTokens: true,
      negativePromptTokens: true,
      characterPromptTokens: true,
    },
  });
}

async function upsertSimilarityCacheRows(
  rows: SimilarityCacheRow[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  if (rows.length === 0) return;
  const db = getDB();

  // Multi-row INSERT: 4 params per row; keep well under SQLite's 32766 param limit
  const ROWS_PER_STMT = 2000;
  for (let i = 0; i < rows.length; i += ROWS_PER_STMT) {
    const chunk = rows.slice(i, i + ROWS_PER_STMT);
    const placeholders = chunk
      .map(() => `(?, ?, ?, ?, datetime('now'))`)
      .join(",");
    const params: unknown[] = [];
    for (const row of chunk) {
      params.push(row.imageAId, row.imageBId, row.phashDistance, row.textScore);
    }
    await db.$executeRawUnsafe(
      `INSERT INTO ${SIMILARITY_CACHE_TABLE} (imageAId, imageBId, phashDistance, textScore, updatedAt)
       VALUES ${placeholders}
       ON CONFLICT(imageAId, imageBId) DO UPDATE SET
         phashDistance = excluded.phashDistance,
         textScore = excluded.textScore,
         updatedAt = excluded.updatedAt`,
      ...params,
    );
    onProgress?.(Math.min(i + ROWS_PER_STMT, rows.length), rows.length);
    await yieldToEventLoop();
  }
}

async function upsertSimilarityCacheFromArrays(
  result: AllPairsResult,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const count = result.imageAIds.length;
  if (count === 0) return;
  const db = getDB();

  const ROWS_PER_STMT = 2000;
  for (let i = 0; i < count; i += ROWS_PER_STMT) {
    const end = Math.min(i + ROWS_PER_STMT, count);
    const chunkSize = end - i;
    const placeholders = Array.from(
      { length: chunkSize },
      () => `(?, ?, ?, ?, datetime('now'))`,
    ).join(",");
    const params: unknown[] = [];
    for (let j = i; j < end; j++) {
      params.push(
        result.imageAIds[j],
        result.imageBIds[j],
        result.phashDistances[j] === -1 ? null : result.phashDistances[j],
        result.textScores[j],
      );
    }
    await db.$executeRawUnsafe(
      `INSERT INTO ${SIMILARITY_CACHE_TABLE} (imageAId, imageBId, phashDistance, textScore, updatedAt)
       VALUES ${placeholders}
       ON CONFLICT(imageAId, imageBId) DO UPDATE SET
         phashDistance = excluded.phashDistance,
         textScore = excluded.textScore,
         updatedAt = excluded.updatedAt`,
      ...params,
    );
    onProgress?.(Math.min(i + ROWS_PER_STMT, count), count);
    await yieldToEventLoop();
  }
}

export async function deleteSimilarityCacheForImageIds(
  imageIds: number[],
): Promise<void> {
  const ids = normalizeImageIds(imageIds);
  if (ids.length === 0) return;
  await ensureSimilarityCacheTables();
  const db = getDB();

  for (let i = 0; i < ids.length; i += CACHE_DELETE_BATCH_SIZE) {
    const chunk = ids.slice(i, i + CACHE_DELETE_BATCH_SIZE);
    const placeholders = chunk.map(() => "?").join(", ");
    await db.$executeRawUnsafe(
      `DELETE FROM ${SIMILARITY_CACHE_TABLE}
       WHERE imageAId IN (${placeholders}) OR imageBId IN (${placeholders})`,
      ...chunk,
      ...chunk,
    );
  }
}

export function hammingDistance(a: string, b: string): number {
  let dist = 0;
  for (let i = 0; i < 16; i++) {
    dist += POPCOUNT4[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  }
  return dist;
}

function computePairCacheRow(
  a: SimilarityImage,
  b: SimilarityImage,
  idfMap: Map<string, number>,
): SimilarityCacheRow | null {
  const phashDistance =
    a.pHash && b.pHash ? hammingDistance(a.pHash, b.pHash) : null;
  const textScore = computeTextScore(a, b, idfMap);
  if (!shouldPersistCachePair(phashDistance, textScore)) return null;

  const imageAId = Math.min(a.id, b.id);
  const imageBId = Math.max(a.id, b.id);
  return {
    imageAId,
    imageBId,
    phashDistance,
    textScore,
  };
}

export async function refreshSimilarityCacheForImageIds(
  imageIds: number[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const targetIds = normalizeImageIds(imageIds);
  if (targetIds.length === 0) return;

  await ensureSimilarityCacheTables();
  await deleteSimilarityCacheForImageIds(targetIds);

  const sourceRows = await readSimilaritySourceRows();
  if (sourceRows.length < 2) return;

  const { images, idfMap } = buildSimilarityImages(sourceRows);
  const imageById = new Map(images.map((img) => [img.id, img]));
  const existingTargetIds = targetIds.filter((id) => imageById.has(id));
  if (existingTargetIds.length === 0) return;
  const isFullCoverage = existingTargetIds.length === sourceRows.length;

  // ── Native fast path ─────────────────────────────────────────────────────
  // Uses C++ inverted token index + pHash pass, significantly faster than
  // the O(N²) JS loop. Supports both full and partial (target-filtered) mode.
  {
    const nativeInput = encodeImagesForNative(images, idfMap);
    if (!isFullCoverage) {
      const targetIdSet = new Set(existingTargetIds);
      const indices: number[] = [];
      for (let i = 0; i < images.length; i++) {
        if (targetIdSet.has(images[i].id)) indices.push(i);
      }
      nativeInput.targetIndices = new Uint32Array(indices);
    }
    const nativeResult = computeAllPairs(nativeInput);
    if (nativeResult !== null) {
      await upsertSimilarityCacheFromArrays(nativeResult, onProgress);
      if (isFullCoverage) await markSimilarityCachePrimed();
      return;
    }
  }

  // ── JS fallback ───────────────────────────────────────────────────────────

  const targetIdSet = new Set(existingTargetIds);
  const pending: SimilarityCacheRow[] = [];
  const FLUSH_INTERVAL = 10000;
  const totalPairs = existingTargetIds.reduce((count, targetId) => {
    let next = count;
    for (const candidate of images) {
      if (candidate.id === targetId) continue;
      if (targetIdSet.has(candidate.id) && candidate.id < targetId) continue;
      next += 1;
    }
    return next;
  }, 0);

  onProgress?.(0, totalPairs);
  let processedPairs = 0;
  for (const targetId of existingTargetIds) {
    const target = imageById.get(targetId)!;
    for (const candidate of images) {
      if (candidate.id === targetId) continue;
      if (targetIdSet.has(candidate.id) && candidate.id < targetId) continue;

      const row = computePairCacheRow(target, candidate, idfMap);
      if (row) pending.push(row);

      processedPairs++;
      if (processedPairs % 256 === 0) {
        onProgress?.(processedPairs, totalPairs);
        await yieldToEventLoop();
      }
      if (pending.length >= FLUSH_INTERVAL) {
        await upsertSimilarityCacheRows(pending);
        pending.length = 0;
      }
    }
  }

  if (pending.length > 0) {
    await upsertSimilarityCacheRows(pending);
  }
  onProgress?.(totalPairs, totalPairs);
  if (isFullCoverage) {
    await markSimilarityCachePrimed();
  }
}

async function ensureSimilarityCachePrimed(
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  await ensureSimilarityCacheTables();
  if (await isSimilarityCachePrimed()) return;

  const db = getDB();
  const ids = await db.image.findMany({ select: { id: true } });
  if (ids.length >= 2) {
    await refreshSimilarityCacheForImageIds(
      ids.map((row) => row.id),
      onProgress,
    );
  }
  await markSimilarityCachePrimed();
}

export async function resetAllHashes(): Promise<void> {
  const db = getDB();
  await db.image.updateMany({ data: { pHash: "" } });
  await clearSimilarityCache();
}

export async function computeAllHashes(
  onHashProgress?: (done: number, total: number) => void,
  onSimilarityProgress?: (done: number, total: number) => void,
): Promise<number> {
  const startedAt = Date.now();
  const db = getDB();
  const images = await db.image.findMany({
    select: { id: true, path: true },
    where: { pHash: "" },
  });
  const total = images.length;

  let done = 0;
  let lastProgressAt = 0;
  let success = false;
  const updates: Array<{ id: number; hash: string }> = [];
  console.info(`[phash.computeAllHashes] start targets=${total}`);
  try {
    await withConcurrency(images, POOL_SIZE * 2, async (img) => {
      try {
        const hash = await pHashPool.run(img.path);
        if (hash) {
          updates.push({ id: img.id, hash });
        }
      } catch {
        // Skip unreadable files.
      }
      done++;
      const progressNow = Date.now();
      if (done === total || progressNow - lastProgressAt >= 100) {
        lastProgressAt = progressNow;
        onHashProgress?.(done, total);
      }
      if (done % 32 === 0) {
        await yieldToEventLoop();
      }
    });

    for (let i = 0; i < updates.length; i += HASH_WRITE_BATCH_SIZE) {
      const chunk = updates.slice(i, i + HASH_WRITE_BATCH_SIZE);
      await db.$transaction(
        chunk.map(({ id, hash }) =>
          db.image.updateMany({ where: { id }, data: { pHash: hash } }),
        ),
      );
      await yieldToEventLoop();
    }

    if (updates.length > 0) {
      await refreshSimilarityCacheForImageIds(
        updates.map((update) => update.id),
        onSimilarityProgress,
      );
    }

    success = true;
    return done;
  } finally {
    const elapsedMs = Date.now() - startedAt;
    console.info(
      `[phash.computeAllHashes] end elapsedMs=${elapsedMs} processed=${done}/${total} success=${success}`,
    );
  }
}

export async function getSimilarGroups(
  threshold = SIMILARITY_THRESHOLD,
  jaccardThreshold?: number,
  onSimilarityProgress?: (done: number, total: number) => void,
): Promise<SimilarGroup[]> {
  await ensureSimilarityCachePrimed(onSimilarityProgress);

  const db = getDB();
  const imageRows = await db.image.findMany({ select: { id: true } });
  if (imageRows.length < 2) return [];

  const idToIndex = new Map<number, number>();
  const indexToId: number[] = [];
  for (const row of imageRows) {
    idToIndex.set(row.id, indexToId.length);
    indexToId.push(row.id);
  }

  const cacheRows = await db.$queryRawUnsafe<SimilarityCacheRow[]>(
    `SELECT imageAId, imageBId, phashDistance, textScore FROM ${SIMILARITY_CACHE_TABLE}`,
  );

  const parent = Array.from({ length: indexToId.length }, (_, i) => i);
  const rank = new Uint8Array(indexToId.length);

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }

  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (rank[ra] < rank[rb]) parent[ra] = rb;
    else if (rank[ra] > rank[rb]) parent[rb] = ra;
    else {
      parent[rb] = ra;
      rank[ra]++;
    }
  }

  const config = resolveThresholdConfig(threshold, jaccardThreshold);
  for (let i = 0; i < cacheRows.length; i++) {
    const row = cacheRows[i];
    const aIndex = idToIndex.get(row.imageAId);
    const bIndex = idToIndex.get(row.imageBId);
    if (aIndex === undefined || bIndex === undefined) continue;

    if (
      shouldLinkAtThreshold(row.phashDistance, row.textScore, threshold, config)
    ) {
      union(aIndex, bIndex);
    }

    if (i % 1024 === 0) {
      await yieldToEventLoop();
    }
  }

  const groupMap = new Map<number, number[]>();
  for (let i = 0; i < indexToId.length; i++) {
    const root = find(i);
    const arr = groupMap.get(root);
    if (arr) arr.push(indexToId[i]);
    else groupMap.set(root, [indexToId[i]]);
  }

  return [...groupMap.values()]
    .filter((ids) => ids.length >= 2)
    .sort((a, b) => b.length - a.length)
    .map((imageIds, i) => ({
      id: String(imageIds[0]),
      name: `유사 그룹 ${i + 1}`,
      imageIds,
    }));
}

export async function getSimilarityReasons(
  imageId: number,
  candidateImageIds: number[],
  threshold = SIMILARITY_THRESHOLD,
  jaccardThreshold?: number,
): Promise<SimilarityReasonItem[]> {
  await ensureSimilarityCachePrimed();
  const candidates = normalizeImageIds(candidateImageIds).filter(
    (id) => id !== imageId,
  );
  if (candidates.length === 0) return [];

  const db = getDB();
  const config = resolveThresholdConfig(threshold, jaccardThreshold);
  const resultMap = new Map<
    number,
    { reason: SimilarityReason; score: number }
  >();
  for (
    let i = 0;
    i < candidates.length;
    i += SIMILARITY_REASON_QUERY_BATCH_SIZE
  ) {
    const chunk = candidates.slice(i, i + SIMILARITY_REASON_QUERY_BATCH_SIZE);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = await db.$queryRawUnsafe<SimilarityCacheRow[]>(
      `SELECT imageAId, imageBId, phashDistance, textScore
         FROM ${SIMILARITY_CACHE_TABLE}
        WHERE (imageAId = ? AND imageBId IN (${placeholders}))
           OR (imageBId = ? AND imageAId IN (${placeholders}))`,
      imageId,
      ...chunk,
      imageId,
      ...chunk,
    );

    for (const row of rows) {
      const otherId = row.imageAId === imageId ? row.imageBId : row.imageAId;
      const reason = classifyReasonAtThreshold(row, threshold, config);
      if (!reason) continue;
      const score =
        row.phashDistance !== null
          ? computeHybridScore(row.phashDistance, row.textScore)
          : row.textScore;
      resultMap.set(otherId, { reason, score });
    }

    if (i + SIMILARITY_REASON_QUERY_BATCH_SIZE < candidates.length) {
      await yieldToEventLoop();
    }
  }

  return candidates.map((id) => ({
    imageId: id,
    reason: resultMap.get(id)?.reason ?? "both",
    score: resultMap.get(id)?.score ?? 0,
  }));
}
