// ---------------------------------------------------------------------------
// Pure similarity scoring algorithms — no DB, no native addon, no worker deps
// ---------------------------------------------------------------------------

// ── Constants ───────────────────────────────────────────────

const STRICT_COMMON_TOKEN_RATIO = 0.15;
const LOOSE_COMMON_TOKEN_RATIO = 0.25;
const MIN_SHARED_POSITIVE_TOKENS_STRICT = 3;
const MIN_SHARED_POSITIVE_TOKENS_LOOSE = 2;
const TEXT_LINK_THRESHOLD_STRICT = 0.64;
const TEXT_LINK_THRESHOLD_LOOSE = 0.54;
const HYBRID_LINK_THRESHOLD_STRICT = 0.74;
const HYBRID_LINK_THRESHOLD_LOOSE = 0.66;
export const HYBRID_PHASH_WEIGHT = 0.72;
export const HYBRID_TEXT_WEIGHT = 0.28;
const HYBRID_TEXT_THRESHOLD_OFFSET = 0.1;
export const CONFLICT_PENALTY_WEIGHT = 0.25;
export const UI_THRESHOLD_MIN = 8;
export const UI_THRESHOLD_MAX = 16;

const POPCOUNT4 = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

// ── Types ───────────────────────────────────────────────────

export type SimilarityThresholdConfig = {
  looseness: number;
  maxCommonTokenRatio: number;
  minSharedPositiveTokens: number;
  textLinkThreshold: number;
  hybridLinkThreshold: number;
};

export type SimilarityImage = {
  id: number;
  pHash: string;
  prompt: Set<string>;
  character: Set<string>;
  negative: Set<string>;
  positive: Set<string>;
  promptWeightSum: number;
  characterWeightSum: number;
  negativeWeightSum: number;
  positiveWeightSum: number;
};

export type SimilarityCacheRow = {
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

// ── Utility ─────────────────────────────────────────────────

export function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

// ── Threshold config ────────────────────────────────────────

export function getThresholdConfig(
  threshold: number,
): SimilarityThresholdConfig {
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

export function resolveThresholdConfig(
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

// ── Hamming distance ────────────────────────────────────────

export function hammingDistance(a: string, b: string): number {
  let dist = 0;
  for (let i = 0; i < 16; i++) {
    dist += POPCOUNT4[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  }
  return dist;
}

// ── Token parsing ───────────────────────────────────────────

function normalizeTokenText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

export function parseTokenSet(raw: string): Set<string> {
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

// ── Weighted Jaccard ────────────────────────────────────────

export function sumTokenWeights(
  tokens: Set<string>,
  idfMap: Map<string, number>,
): number {
  let total = 0;
  for (const token of tokens) total += idfMap.get(token) ?? 1;
  return total;
}

export function weightedIntersection(
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

export function weightedJaccardFromIntersection(
  interWeight: number,
  sumA: number,
  sumB: number,
): number {
  const unionWeight = sumA + sumB - interWeight;
  if (unionWeight <= 0) return 0;
  return interWeight / unionWeight;
}

// ── Scoring ─────────────────────────────────────────────────

export function computeTextScore(
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

  const characterInter = weightedIntersection(
    a.character,
    b.character,
    idfMap,
  );
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

  const conflictABInter = weightedIntersection(
    a.positive,
    b.negative,
    idfMap,
  );
  const conflictAB = weightedJaccardFromIntersection(
    conflictABInter,
    a.positiveWeightSum,
    b.negativeWeightSum,
  );
  const conflictBAInter = weightedIntersection(
    b.positive,
    a.negative,
    idfMap,
  );
  const conflictBA = weightedJaccardFromIntersection(
    conflictBAInter,
    b.positiveWeightSum,
    a.negativeWeightSum,
  );
  const conflictPenalty = Math.max(conflictAB, conflictBA);

  return clamp01(base - conflictPenalty * CONFLICT_PENALTY_WEIGHT);
}

export function computeHybridScore(
  phashDistance: number,
  textScore: number,
): number {
  const phashScore = clamp01(1 - phashDistance / 64);
  return clamp01(
    HYBRID_PHASH_WEIGHT * phashScore + HYBRID_TEXT_WEIGHT * textScore,
  );
}

// ── Link / persist decisions ────────────────────────────────

export function shouldPersistCachePair(
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

export function shouldLinkAtThreshold(
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

export function classifyReasonAtThreshold(
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
