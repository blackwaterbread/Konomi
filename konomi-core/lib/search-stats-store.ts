import { getDB } from "./db";
import type { Prisma } from "../../generated/prisma/client";
import type { SearchStatSource } from "@core/types/repository";
import {
  buildStatDeltasFromMutations,
  extractTokenTexts,
  normalizeSuggestLimit,
  normalizeExcludedTagKeys,
  mergeAndSortTagSuggestions,
  MIN_TAG_CONTAINS_QUERY_LENGTH,
} from "@core/lib/search-stats";
import type { SearchStatDelta } from "@core/lib/search-stats";

// ── Types ──────────────────────────────────────────────────────

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

export type ImageSearchStatSource = SearchStatSource;

type SearchStatsProgressCallback = (done: number, total: number) => void;

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

const IMAGE_SEARCH_STAT_SOURCE_SELECT = {
  width: true,
  height: true,
  model: true,
  promptTokens: true,
  negativePromptTokens: true,
  characterPromptTokens: true,
} as const satisfies Prisma.ImageSelect;

const TOKEN_TEXT_FIELDS = [
  "promptTokens",
  "negativePromptTokens",
  "characterPromptTokens",
] as const;

const MAX_TAG_SUGGEST_QUERY_ROWS = 160;
const STAT_DELTA_BATCH_SIZE = 200;

// ── Table readiness ────────────────────────────────────────────

let imageSearchStatTableReady = false;
let imageSearchTagStatsBackfillAttempted = false;

async function ensureImageSearchStatTable(): Promise<void> {
  if (imageSearchStatTableReady) return;
  const db = getDB();
  await db.imageSearchStat.findFirst({
    select: { kind: true, key: true },
  });
  imageSearchStatTableReady = true;
}

// ── Delta application ──────────────────────────────────────────

async function applySearchStatDeltasInTx(
  tx: Pick<ReturnType<typeof getDB>, "$executeRawUnsafe">,
  deltas: SearchStatDelta[],
  onProgress?: SearchStatsProgressCallback,
): Promise<void> {
  const total = deltas.length;
  let done = 0;
  let lastProgressAt = 0;
  onProgress?.(done, total);

  const positives = deltas.filter((d) => d.delta > 0);
  for (let i = 0; i < positives.length; i += STAT_DELTA_BATCH_SIZE) {
    const chunk = positives.slice(i, i + STAT_DELTA_BATCH_SIZE);
    const placeholders = chunk
      .map(() => "(?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)")
      .join(", ");
    const params: unknown[] = [];
    for (const delta of chunk) {
      params.push(
        delta.kind,
        delta.key,
        delta.width,
        delta.height,
        delta.model,
        delta.delta,
      );
    }
    await tx.$executeRawUnsafe(
      `INSERT INTO ImageSearchStat (kind, key, width, height, model, count, updatedAt)
         VALUES ${placeholders}
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
      ...params,
    );
    done += chunk.length;
    const now = Date.now();
    if (done === total || now - lastProgressAt >= 100) {
      lastProgressAt = now;
      onProgress?.(done, total);
    }
  }

  const negatives = deltas.filter((d) => d.delta <= 0);
  for (let i = 0; i < negatives.length; i += STAT_DELTA_BATCH_SIZE) {
    const chunk = negatives.slice(i, i + STAT_DELTA_BATCH_SIZE);
    const whenClauses = chunk
      .map(() => "WHEN kind = ? AND key = ? THEN count + ?")
      .join(" ");
    const whereClauses = chunk.map(() => "(kind = ? AND key = ?)").join(" OR ");
    const updateParams: unknown[] = [];
    for (const delta of chunk) {
      updateParams.push(delta.kind, delta.key, delta.delta);
    }
    const whereParams: unknown[] = [];
    for (const delta of chunk) {
      whereParams.push(delta.kind, delta.key);
    }
    await tx.$executeRawUnsafe(
      `UPDATE ImageSearchStat
         SET count = CASE ${whenClauses} ELSE count END,
             updatedAt = CURRENT_TIMESTAMP
         WHERE ${whereClauses}`,
      ...updateParams,
      ...whereParams,
    );
    await tx.$executeRawUnsafe(`DELETE FROM ImageSearchStat WHERE count <= 0`);
    done += chunk.length;
    const now = Date.now();
    if (done === total || now - lastProgressAt >= 100) {
      lastProgressAt = now;
      onProgress?.(done, total);
    }
  }
}

async function applyImageSearchStatDeltas(
  deltas: SearchStatDelta[],
  onProgress?: SearchStatsProgressCallback,
): Promise<void> {
  if (deltas.length === 0) return;
  await ensureImageSearchStatTable();
  const db = getDB();
  await db.$transaction(async (tx) => {
    await applySearchStatDeltasInTx(tx, deltas, onProgress);
  });
}

// ── Public mutation API ────────────────────────────────────────

export async function applyImageSearchStatsMutations(
  mutations: Array<{ before: SearchStatSource | null; after: SearchStatSource | null }>,
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

// ── Preset stats ───────────────────────────────────────────────

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

// ── Tag suggestion ─────────────────────────────────────────────

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

  return mergeAndSortTagSuggestions(rows, prefix, excludedSet, limit);
}
