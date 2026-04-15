// ---------------------------------------------------------------------------
// Similarity service — union-find clustering, group cache, reason assembly
// Pure business logic; all DB/native operations delegated to adapter deps.
// ---------------------------------------------------------------------------

import type {
  SimilarityCacheRow,
  SimilarityReason,
  SimilarityReasonItem,
  SimilarityThresholdConfig,
} from "../lib/similarity";
import {
  resolveThresholdConfig,
  shouldLinkAtThreshold,
  classifyReasonAtThreshold,
  computeHybridScore,
  HYBRID_PHASH_WEIGHT,
  HYBRID_TEXT_WEIGHT,
} from "../lib/similarity";

// ── Types ──────────────────────────────────────────────────────

export type SimilarGroup = {
  id: string;
  name: string;
  imageIds: number[];
};

type ProgressCallback = (done: number, total: number) => void;

// ── Adapter interfaces ─────────────────────────────────────────

export interface SimilarityServiceDeps {
  /** Ensure the similarity cache is fully primed (tables exist, all pairs computed) */
  ensureCachePrimed(onProgress?: ProgressCallback): Promise<void>;

  /** Return all image IDs (synchronous, cursor-based) */
  getAllImageIds(): number[];

  /** Iterate cache rows passing the pre-filter (phashDistance <= max OR textScore >= min) */
  iterateFilteredCachePairs(
    maxPhashDist: number,
    minTextScore: number,
  ): Iterable<SimilarityCacheRow>;

  /**
   * Query cache rows involving a specific image and a set of candidate IDs.
   * Implementations should handle internal batching for large candidate sets.
   */
  queryCachePairsForImage(
    imageId: number,
    candidateIds: number[],
  ): Promise<SimilarityCacheRow[]>;
}

// ── Service ────────────────────────────────────────────────────

export interface SimilarityService {
  getSimilarGroups(
    threshold?: number,
    jaccardThreshold?: number,
    onProgress?: ProgressCallback,
  ): Promise<SimilarGroup[]>;

  getGroupForImage(imageId: number): SimilarGroup | null;

  evictGroupCacheForImages(imageIds: number[]): void;

  getSimilarityReasons(
    imageId: number,
    candidateImageIds: number[],
    threshold?: number,
    jaccardThreshold?: number,
  ): Promise<SimilarityReasonItem[]>;
}

export type { SimilarityReasonItem, SimilarityReason };

// ── Helpers ────────────────────────────────────────────────────

const SIMILARITY_THRESHOLD = 10;

function normalizeImageIds(imageIds: number[]): number[] {
  return [
    ...new Set(imageIds.filter((id) => Number.isInteger(id) && id > 0)),
  ].sort((a, b) => a - b);
}

/**
 * Compute the maximum pHash distance that could pass the hybrid check
 * when textScore = 1.0.
 *
 * hybridScore = HYBRID_PHASH_WEIGHT * (1 - d/64) + HYBRID_TEXT_WEIGHT * textScore
 * Solving for d: d <= 64 * (1 - (hybridThreshold - HYBRID_TEXT_WEIGHT) / HYBRID_PHASH_WEIGHT)
 */
function computeMaxPhashDistForHybrid(
  config: SimilarityThresholdConfig,
): number {
  return Math.floor(
    64 *
      (1 -
        (config.hybridLinkThreshold - HYBRID_TEXT_WEIGHT) /
          HYBRID_PHASH_WEIGHT),
  );
}

// ── Union-find ─────────────────────────────────────────────────

function buildGroupsFromUnionFind(
  imageIds: number[],
  pairs: Iterable<SimilarityCacheRow>,
  threshold: number,
  config: SimilarityThresholdConfig,
): SimilarGroup[] {
  if (imageIds.length < 2) return [];

  const idToIndex = new Map<number, number>();
  for (let i = 0; i < imageIds.length; i++) {
    idToIndex.set(imageIds[i], i);
  }

  const parent = Array.from({ length: imageIds.length }, (_, i) => i);
  const rank = new Uint8Array(imageIds.length);

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

  for (const row of pairs) {
    const aIndex = idToIndex.get(row.imageAId);
    const bIndex = idToIndex.get(row.imageBId);
    if (aIndex === undefined || bIndex === undefined) continue;

    if (shouldLinkAtThreshold(row.phashDistance, row.textScore, threshold, config)) {
      union(aIndex, bIndex);
    }
  }

  const groupMap = new Map<number, number[]>();
  for (let i = 0; i < imageIds.length; i++) {
    const root = find(i);
    const arr = groupMap.get(root);
    if (arr) arr.push(imageIds[i]);
    else groupMap.set(root, [imageIds[i]]);
  }

  return [...groupMap.values()]
    .filter((ids) => ids.length >= 2)
    .sort((a, b) => b.length - a.length)
    .map((ids, i) => ({
      id: String(ids[0]),
      name: `유사 그룹 ${i + 1}`,
      imageIds: ids,
    }));
}

// ── Reason assembly ────────────────────────────────────────────

function assembleReasonResults(
  candidates: number[],
  cacheRows: SimilarityCacheRow[],
  imageId: number,
  threshold: number,
  config: SimilarityThresholdConfig,
): SimilarityReasonItem[] {
  const resultMap = new Map<
    number,
    { reason: SimilarityReason; score: number }
  >();

  for (const row of cacheRows) {
    const otherId = row.imageAId === imageId ? row.imageBId : row.imageAId;
    const reason = classifyReasonAtThreshold(row, threshold, config);
    if (!reason) continue;
    const score =
      row.phashDistance !== null
        ? computeHybridScore(row.phashDistance, row.textScore)
        : row.textScore;
    resultMap.set(otherId, { reason, score });
  }

  return candidates
    .filter((id) => resultMap.has(id))
    .map((id) => ({
      imageId: id,
      reason: resultMap.get(id)!.reason,
      score: resultMap.get(id)!.score,
    }));
}

// ── Factory ────────────────────────────────────────────────────

export function createSimilarityService(
  deps: SimilarityServiceDeps,
): SimilarityService {
  const cachedImageToGroup = new Map<number, SimilarGroup>();

  return {
    async getSimilarGroups(
      threshold = SIMILARITY_THRESHOLD,
      jaccardThreshold?: number,
      onProgress?: ProgressCallback,
    ): Promise<SimilarGroup[]> {
      await deps.ensureCachePrimed(onProgress);

      const imageIds = deps.getAllImageIds();
      if (imageIds.length < 2) return [];

      const config = resolveThresholdConfig(threshold, jaccardThreshold);
      const maxPhashDist = computeMaxPhashDistForHybrid(config);
      const minTextScore = config.textLinkThreshold;

      const pairs = deps.iterateFilteredCachePairs(maxPhashDist, minTextScore);
      const groups = buildGroupsFromUnionFind(imageIds, pairs, threshold, config);

      // Populate group cache
      cachedImageToGroup.clear();
      for (const group of groups) {
        for (const id of group.imageIds) {
          cachedImageToGroup.set(id, group);
        }
      }

      return groups;
    },

    getGroupForImage(imageId: number): SimilarGroup | null {
      return cachedImageToGroup.get(imageId) ?? null;
    },

    evictGroupCacheForImages(imageIds: number[]): void {
      for (const id of imageIds) cachedImageToGroup.delete(id);
    },

    async getSimilarityReasons(
      imageId: number,
      candidateImageIds: number[],
      threshold = SIMILARITY_THRESHOLD,
      jaccardThreshold?: number,
    ): Promise<SimilarityReasonItem[]> {
      await deps.ensureCachePrimed();
      const candidates = normalizeImageIds(candidateImageIds).filter(
        (id) => id !== imageId,
      );
      if (candidates.length === 0) return [];

      const config = resolveThresholdConfig(threshold, jaccardThreshold);
      const cacheRows = await deps.queryCachePairsForImage(imageId, candidates);
      return assembleReasonResults(candidates, cacheRows, imageId, threshold, config);
    },
  };
}
