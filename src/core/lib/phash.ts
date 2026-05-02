import os from "os";
import path from "path";
import { getDB, getRawDB, getDialect, insertIgnore } from "./db";
import { withConcurrency, type CancelToken } from "@core/lib/scanner";
import { WorkerPool } from "@core/lib/worker-pool";
import { computeAllPairs, type AllPairsInput, type AllPairsResult } from "@core/lib/konomi-image";
import {
  type SimilarityImage,
  type SimilarityCacheRow,
  hammingDistance,
  parseTokenSet,
  sumTokenWeights,
  computeTextScore,
  shouldPersistCachePair,
  getThresholdConfig,
  HYBRID_PHASH_WEIGHT,
  HYBRID_TEXT_WEIGHT,
  CONFLICT_PENALTY_WEIGHT,
  UI_THRESHOLD_MAX,
} from "@core/lib/similarity";
import {
  createSimilarityService,
  type SimilarityServiceDeps,
} from "@core/services/similarity-service";

const HASH_WRITE_BATCH_SIZE = 32;
const CACHE_DELETE_BATCH_SIZE = 400;
const SIMILARITY_REASON_QUERY_BATCH_SIZE = 400;

const SIMILARITY_CACHE_TABLE = "ImageSimilarityCache";
const SIMILARITY_CACHE_META_TABLE = "ImageSimilarityCacheMeta";

// Run pHash computations in worker threads to avoid blocking the main process.
const POOL_SIZE = Math.max(4, Math.min(os.availableParallelism() - 1, 8));
const WORKER_PATH = path.join(__dirname, "phash.worker.js");

export const pHashPool = new WorkerPool<string | null>({
  size: POOL_SIZE,
  workerPath: WORKER_PATH,
  eager: true,
  extractResult: (msg) => (msg.hash as string | null) ?? null,
});

type SimilaritySourceRow = {
  id: number;
  pHash: string;
  promptTokens: string;
  negativePromptTokens: string;
  characterPromptTokens: string;
};

export type { SimilarityReason, SimilarityReasonItem } from "@core/lib/similarity";
export type { SimilarGroup } from "@core/services/similarity-service";

const LOOSE_THRESHOLD_CONFIG = getThresholdConfig(UI_THRESHOLD_MAX);

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
    `${insertIgnore()} ${SIMILARITY_CACHE_META_TABLE}(id, primedAt) VALUES (1, NULL)`,
  );
}

async function markSimilarityCachePrimed(): Promise<void> {
  const db = getDB();
  await db.$executeRawUnsafe(
    `UPDATE ${SIMILARITY_CACHE_META_TABLE} SET primedAt = ${getDialect() === "mysql" ? "NOW()" : "datetime('now')"} WHERE id = 1`,
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

const SIMILARITY_SOURCE_SQL =
  "SELECT id, pHash, promptTokens, negativePromptTokens, characterPromptTokens FROM `Image`";

function buildIdfMapFromCursorSqlite(): {
  idfMap: Map<string, number>;
  imageCount: number;
  imageIdSet: Set<number>;
} {
  const rawDb = getRawDB();
  const stmt = rawDb.prepare(SIMILARITY_SOURCE_SQL);
  const docFrequency = new Map<string, number>();
  const seen = new Set<string>();
  const imageIdSet = new Set<number>();
  let imageCount = 0;

  for (const row of stmt.iterate()) {
    const { id, promptTokens, negativePromptTokens, characterPromptTokens } =
      row as SimilaritySourceRow;
    imageIdSet.add(id);
    imageCount++;

    seen.clear();
    for (const t of parseTokenSet(promptTokens)) seen.add(t);
    for (const t of parseTokenSet(characterPromptTokens)) seen.add(t);
    for (const t of parseTokenSet(negativePromptTokens)) seen.add(t);
    for (const token of seen) {
      docFrequency.set(token, (docFrequency.get(token) ?? 0) + 1);
    }
  }

  const totalDocs = Math.max(imageCount, 1);
  const idfMap = new Map<string, number>();
  for (const [token, df] of docFrequency) {
    idfMap.set(token, Math.log((totalDocs + 1) / (df + 1)) + 1);
  }
  return { idfMap, imageCount, imageIdSet };
}

async function buildIdfMapFromPrisma(): Promise<{
  idfMap: Map<string, number>;
  imageCount: number;
  imageIdSet: Set<number>;
}> {
  const rows = await getDB().$queryRawUnsafe<SimilaritySourceRow[]>(SIMILARITY_SOURCE_SQL);
  const docFrequency = new Map<string, number>();
  const seen = new Set<string>();
  const imageIdSet = new Set<number>();

  for (const row of rows) {
    imageIdSet.add(row.id);
    seen.clear();
    for (const t of parseTokenSet(row.promptTokens)) seen.add(t);
    for (const t of parseTokenSet(row.characterPromptTokens)) seen.add(t);
    for (const t of parseTokenSet(row.negativePromptTokens)) seen.add(t);
    for (const token of seen) {
      docFrequency.set(token, (docFrequency.get(token) ?? 0) + 1);
    }
  }

  const totalDocs = Math.max(rows.length, 1);
  const idfMap = new Map<string, number>();
  for (const [token, df] of docFrequency) {
    idfMap.set(token, Math.log((totalDocs + 1) / (df + 1)) + 1);
  }
  return { idfMap, imageCount: rows.length, imageIdSet };
}

async function buildIdfMap(): Promise<{
  idfMap: Map<string, number>;
  imageCount: number;
  imageIdSet: Set<number>;
}> {
  return getDialect() === "mysql" ? buildIdfMapFromPrisma() : buildIdfMapFromCursorSqlite();
}

function encodeSourceRows(
  idfMap: Map<string, number>,
  rows: SimilaritySourceRow[],
): AllPairsInput {
  const vocab = new Map<string, number>();
  for (const token of idfMap.keys()) vocab.set(token, vocab.size);

  const imageIdsList: number[] = [];
  const pHashHexList: string[] = [];
  const promptWtsList: number[] = [];
  const charWtsList: number[] = [];
  const negWtsList: number[] = [];
  const posWtsList: number[] = [];
  const hasPromptList: number[] = [];
  const hasCharList: number[] = [];

  const allPromptIds: number[] = [];
  const allCharIds: number[] = [];
  const allNegIds: number[] = [];
  const allPosIds: number[] = [];
  const promptOffsetsList: number[] = [0];
  const charOffsetsList: number[] = [0];
  const negOffsetsList: number[] = [0];
  const posOffsetsList: number[] = [0];

  for (const row of rows) {
    const { id, pHash, promptTokens, negativePromptTokens, characterPromptTokens } = row;

    const prompt = parseTokenSet(promptTokens);
    const character = parseTokenSet(characterPromptTokens);
    const negative = parseTokenSet(negativePromptTokens);
    const positive = new Set<string>(prompt);
    for (const t of character) positive.add(t);

    imageIdsList.push(id);
    pHashHexList.push(pHash?.length === 16 ? pHash : "");
    hasPromptList.push(prompt.size > 0 ? 1 : 0);
    hasCharList.push(character.size > 0 ? 1 : 0);

    promptWtsList.push(sumTokenWeights(prompt, idfMap));
    charWtsList.push(sumTokenWeights(character, idfMap));
    negWtsList.push(sumTokenWeights(negative, idfMap));
    posWtsList.push(sumTokenWeights(positive, idfMap));

    for (const t of prompt) { const vid = vocab.get(t); if (vid !== undefined) allPromptIds.push(vid); }
    promptOffsetsList.push(allPromptIds.length);
    for (const t of character) { const vid = vocab.get(t); if (vid !== undefined) allCharIds.push(vid); }
    charOffsetsList.push(allCharIds.length);
    for (const t of negative) { const vid = vocab.get(t); if (vid !== undefined) allNegIds.push(vid); }
    negOffsetsList.push(allNegIds.length);
    for (const t of positive) { const vid = vocab.get(t); if (vid !== undefined) allPosIds.push(vid); }
    posOffsetsList.push(allPosIds.length);
  }

  const vsz = vocab.size;
  const tokenWeights = new Float64Array(vsz);
  for (const [token, w] of idfMap) {
    const vid = vocab.get(token);
    if (vid !== undefined) tokenWeights[vid] = w;
  }

  return {
    imageIds: Int32Array.from(imageIdsList),
    pHashHex: pHashHexList,
    promptData: Uint32Array.from(allPromptIds),
    promptOffsets: Int32Array.from(promptOffsetsList),
    charData: Uint32Array.from(allCharIds),
    charOffsets: Int32Array.from(charOffsetsList),
    negData: Uint32Array.from(allNegIds),
    negOffsets: Int32Array.from(negOffsetsList),
    posData: Uint32Array.from(allPosIds),
    posOffsets: Int32Array.from(posOffsetsList),
    promptWts: Float64Array.from(promptWtsList),
    charWts: Float64Array.from(charWtsList),
    negWts: Float64Array.from(negWtsList),
    posWts: Float64Array.from(posWtsList),
    hasPrompt: Uint8Array.from(hasPromptList),
    hasChar: Uint8Array.from(hasCharList),
    tokenWeights,
    uiThresholdMax: UI_THRESHOLD_MAX,
    textThreshold: LOOSE_THRESHOLD_CONFIG.textLinkThreshold,
    hybridThreshold: LOOSE_THRESHOLD_CONFIG.hybridLinkThreshold,
    hybridPHashWeight: HYBRID_PHASH_WEIGHT,
    hybridTextWeight: HYBRID_TEXT_WEIGHT,
    conflictPenaltyWeight: CONFLICT_PENALTY_WEIGHT,
  };
}

function buildSimilarityImages(
  idfMap: Map<string, number>,
  rows: SimilaritySourceRow[],
): SimilarityImage[] {
  const images: SimilarityImage[] = [];

  for (const row of rows) {
    const { id, pHash, promptTokens, negativePromptTokens, characterPromptTokens } = row;

    const prompt = parseTokenSet(promptTokens);
    const character = parseTokenSet(characterPromptTokens);
    const negative = parseTokenSet(negativePromptTokens);
    const positive = new Set<string>(prompt);
    for (const t of character) positive.add(t);

    images.push({
      id,
      pHash,
      prompt,
      character,
      negative,
      positive,
      promptWeightSum: sumTokenWeights(prompt, idfMap),
      characterWeightSum: sumTokenWeights(character, idfMap),
      negativeWeightSum: sumTokenWeights(negative, idfMap),
      positiveWeightSum: sumTokenWeights(positive, idfMap),
    });
  }
  return images;
}

async function upsertSimilarityCacheRows(
  rows: SimilarityCacheRow[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  if (rows.length === 0) return;
  const db = getDB();

  const mysql = getDialect() === "mysql";
  const nowFn = mysql ? "NOW()" : "datetime('now')";
  const ROWS_PER_STMT = 2000;
  for (let i = 0; i < rows.length; i += ROWS_PER_STMT) {
    const chunk = rows.slice(i, i + ROWS_PER_STMT);
    const placeholders = chunk
      .map(() => `(?, ?, ?, ?, ${nowFn})`)
      .join(",");
    const params: unknown[] = [];
    for (const row of chunk) {
      params.push(row.imageAId, row.imageBId, row.phashDistance, row.textScore);
    }
    const sql = mysql
      ? `INSERT INTO ${SIMILARITY_CACHE_TABLE} (imageAId, imageBId, phashDistance, textScore, updatedAt)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           phashDistance = VALUES(phashDistance),
           textScore = VALUES(textScore),
           updatedAt = VALUES(updatedAt)`
      : `INSERT INTO ${SIMILARITY_CACHE_TABLE} (imageAId, imageBId, phashDistance, textScore, updatedAt)
         VALUES ${placeholders}
         ON CONFLICT(imageAId, imageBId) DO UPDATE SET
           phashDistance = excluded.phashDistance,
           textScore = excluded.textScore,
           updatedAt = excluded.updatedAt`;
    await db.$executeRawUnsafe(sql, ...params);
    onProgress?.(Math.min(i + ROWS_PER_STMT, rows.length), rows.length);
    await yieldToEventLoop();
  }
}

async function upsertSimilarityCacheFromArrays(
  result: AllPairsResult,
  onProgress?: (done: number, total: number) => void,
  signal?: CancelToken,
): Promise<void> {
  const count = result.imageAIds.length;
  if (count === 0) return;
  const db = getDB();
  const mysql = getDialect() === "mysql";
  const nowFn = mysql ? "NOW()" : "datetime('now')";

  const ROWS_PER_STMT = 2000;
  for (let i = 0; i < count; i += ROWS_PER_STMT) {
    if (signal?.cancelled) return;
    const end = Math.min(i + ROWS_PER_STMT, count);
    const chunkSize = end - i;
    const placeholders = Array.from(
      { length: chunkSize },
      () => `(?, ?, ?, ?, ${nowFn})`,
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
    const sql = mysql
      ? `INSERT INTO ${SIMILARITY_CACHE_TABLE} (imageAId, imageBId, phashDistance, textScore, updatedAt)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           phashDistance = VALUES(phashDistance),
           textScore = VALUES(textScore),
           updatedAt = VALUES(updatedAt)`
      : `INSERT INTO ${SIMILARITY_CACHE_TABLE} (imageAId, imageBId, phashDistance, textScore, updatedAt)
         VALUES ${placeholders}
         ON CONFLICT(imageAId, imageBId) DO UPDATE SET
           phashDistance = excluded.phashDistance,
           textScore = excluded.textScore,
           updatedAt = excluded.updatedAt`;
    await db.$executeRawUnsafe(sql, ...params);
    onProgress?.(Math.min(i + ROWS_PER_STMT, count), count);
    await yieldToEventLoop();
  }
}

export async function deleteSimilarityCacheForImageIds(
  imageIds: number[],
): Promise<void> {
  const ids = normalizeImageIds(imageIds);
  if (ids.length === 0) return;
  similarityService.evictGroupCacheForImages(ids);
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

export { hammingDistance };

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
  options?: { preserveExisting?: boolean; signal?: CancelToken },
): Promise<void> {
  const signal = options?.signal;
  const targetIds = normalizeImageIds(imageIds);
  if (targetIds.length === 0) return;

  await ensureSimilarityCacheTables();
  if (signal?.cancelled) return;
  if (!options?.preserveExisting) {
    await deleteSimilarityCacheForImageIds(targetIds);
  }
  if (signal?.cancelled) return;

  // Pass 1: build IDF map + collect image IDs
  const { idfMap, imageCount, imageIdSet } = await buildIdfMap();
  if (imageCount < 2) return;
  if (signal?.cancelled) return;

  const existingTargetIds = targetIds.filter((id) => imageIdSet.has(id));
  if (existingTargetIds.length === 0) return;
  const isFullCoverage = existingTargetIds.length === imageCount;

  // Fetch source rows (Prisma for MySQL, cursor for SQLite)
  const sourceRows = getDialect() === "mysql"
    ? await getDB().$queryRawUnsafe<SimilaritySourceRow[]>(SIMILARITY_SOURCE_SQL)
    : (() => { const rawDb = getRawDB(); return [...rawDb.prepare(SIMILARITY_SOURCE_SQL).iterate()] as SimilaritySourceRow[]; })();
  if (signal?.cancelled) return;

  // ── Native fast path ─────────────────────────────────────────────────────
  {
    const nativeInput = encodeSourceRows(idfMap, sourceRows);
    if (!isFullCoverage) {
      const targetIdSet = new Set(existingTargetIds);
      const indices: number[] = [];
      for (let i = 0; i < nativeInput.imageIds.length; i++) {
        if (targetIdSet.has(nativeInput.imageIds[i])) indices.push(i);
      }
      nativeInput.targetIndices = new Uint32Array(indices);
    }
    const nativeResult = computeAllPairs(nativeInput);
    if (nativeResult !== null) {
      await upsertSimilarityCacheFromArrays(nativeResult, onProgress, signal);
      if (signal?.cancelled) return;
      if (isFullCoverage) await markSimilarityCachePrimed();
      return;
    }
  }

  // ── JS fallback (cursor-based — only when native addon unavailable) ─────

  const fallbackImages = buildSimilarityImages(idfMap, sourceRows);
  const imageById = new Map(fallbackImages.map((img) => [img.id, img]));

  const targetIdSet = new Set(existingTargetIds);
  const pending: SimilarityCacheRow[] = [];
  const FLUSH_INTERVAL = 10000;
  const totalPairs = existingTargetIds.reduce((count, targetId) => {
    let next = count;
    for (const candidate of fallbackImages) {
      if (candidate.id === targetId) continue;
      if (targetIdSet.has(candidate.id) && candidate.id < targetId) continue;
      next += 1;
    }
    return next;
  }, 0);

  onProgress?.(0, totalPairs);
  let processedPairs = 0;
  for (const targetId of existingTargetIds) {
    if (signal?.cancelled) return;
    const target = imageById.get(targetId)!;
    for (const candidate of fallbackImages) {
      if (signal?.cancelled) return;
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
  signal?: CancelToken,
): Promise<void> {
  await ensureSimilarityCacheTables();
  if (await isSimilarityCachePrimed()) return;
  if (signal?.cancelled) return;

  const db = getDB();
  const ids = await db.image.findMany({ select: { id: true } });
  if (ids.length >= 2) {
    await refreshSimilarityCacheForImageIds(
      ids.map((row) => row.id),
      onProgress,
      { preserveExisting: true, signal },
    );
    if (signal?.cancelled) return;
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
  signal?: CancelToken,
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
  const pending: Array<{ id: number; hash: string }> = [];
  const allUpdatedIds: number[] = [];
  let flushing = false;

  async function flushPending(): Promise<void> {
    if (flushing || pending.length < HASH_WRITE_BATCH_SIZE) return;
    flushing = true;
    try {
      while (pending.length >= HASH_WRITE_BATCH_SIZE) {
        const chunk = pending.splice(0, HASH_WRITE_BATCH_SIZE);
        allUpdatedIds.push(...chunk.map((c) => c.id));
        await db.$transaction(
          chunk.map(({ id, hash }) =>
            db.image.updateMany({ where: { id }, data: { pHash: hash } }),
          ),
        );
      }
    } finally {
      flushing = false;
    }
  }

  console.info(`[phash.computeAllHashes] start targets=${total}`);
  try {
    await withConcurrency(
      images,
      POOL_SIZE * 2,
      async (img) => {
        if (signal?.cancelled) return;
        try {
          const hash = await pHashPool.run(img.path);
          if (hash) {
            pending.push({ id: img.id, hash });
            await flushPending();
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
      },
      signal,
    );

    if (pending.length > 0) {
      const chunk = pending.splice(0);
      allUpdatedIds.push(...chunk.map((c) => c.id));
      await db.$transaction(
        chunk.map(({ id, hash }) =>
          db.image.updateMany({ where: { id }, data: { pHash: hash } }),
        ),
      );
    }

    if (allUpdatedIds.length > 0 && !signal?.cancelled) {
      await refreshSimilarityCacheForImageIds(
        allUpdatedIds,
        onSimilarityProgress,
        { signal },
      );
    }

    success = true;
    return done;
  } finally {
    const elapsedMs = Date.now() - startedAt;
    console.info(
      `[phash.computeAllHashes] end elapsedMs=${elapsedMs} processed=${done}/${total} success=${success} cancelled=${signal?.cancelled === true}`,
    );
  }
}

// ── Similarity service (core) with infra adapter deps ─────────

const similarityServiceDeps: SimilarityServiceDeps = {
  ensureCachePrimed: ensureSimilarityCachePrimed,

  getAllImageIds(): number[] | Promise<number[]> {
    if (getDialect() === "mysql") {
      return getDB().$queryRawUnsafe<Array<{ id: number }>>("SELECT id FROM `Image`")
        .then((rows) => rows.map((r) => r.id));
    }
    const rawDb = getRawDB();
    return rawDb
      .prepare('SELECT id FROM "Image"')
      .pluck()
      .all() as number[];
  },

  iterateFilteredCachePairs(
    maxPhashDist: number,
    minTextScore: number,
  ): Iterable<SimilarityCacheRow> | Promise<SimilarityCacheRow[]> {
    if (getDialect() === "mysql") {
      return getDB().$queryRawUnsafe<SimilarityCacheRow[]>(
        `SELECT imageAId, imageBId, phashDistance, textScore FROM ${SIMILARITY_CACHE_TABLE} WHERE phashDistance <= ? OR textScore >= ?`,
        maxPhashDist,
        minTextScore,
      );
    }
    const rawDb = getRawDB();
    const stmt = rawDb.prepare(
      `SELECT imageAId, imageBId, phashDistance, textScore FROM ${SIMILARITY_CACHE_TABLE} WHERE phashDistance <= ? OR textScore >= ?`,
    );
    return stmt.iterate(maxPhashDist, minTextScore) as Iterable<SimilarityCacheRow>;
  },

  async queryCachePairsForImage(
    imageId: number,
    candidateIds: number[],
  ): Promise<SimilarityCacheRow[]> {
    const db = getDB();
    const results: SimilarityCacheRow[] = [];
    for (
      let i = 0;
      i < candidateIds.length;
      i += SIMILARITY_REASON_QUERY_BATCH_SIZE
    ) {
      const chunk = candidateIds.slice(i, i + SIMILARITY_REASON_QUERY_BATCH_SIZE);
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
      results.push(...rows);
      if (i + SIMILARITY_REASON_QUERY_BATCH_SIZE < candidateIds.length) {
        await yieldToEventLoop();
      }
    }
    return results;
  },
};

const similarityService = createSimilarityService(similarityServiceDeps);

export const getSimilarGroups = similarityService.getSimilarGroups;
export const getGroupForImage = similarityService.getGroupForImage;
export const getSimilarityReasons = similarityService.getSimilarityReasons;
