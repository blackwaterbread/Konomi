import path from "path";

interface NaiLsbResult {
  rgb: Buffer;
  alpha: Buffer | null;
}

export interface AllPairsInput {
  imageIds: Int32Array;
  pHashHex: string[];
  promptData: Uint32Array;
  promptOffsets: Int32Array;
  charData: Uint32Array;
  charOffsets: Int32Array;
  negData: Uint32Array;
  negOffsets: Int32Array;
  posData: Uint32Array;
  posOffsets: Int32Array;
  promptWts: Float64Array;
  charWts: Float64Array;
  negWts: Float64Array;
  posWts: Float64Array;
  hasPrompt: Uint8Array;
  hasChar: Uint8Array;
  tokenWeights: Float64Array;
  uiThresholdMax: number;
  textThreshold: number;
  hybridThreshold: number;
  hybridPHashWeight: number;
  hybridTextWeight: number;
  conflictPenaltyWeight: number;
}

export interface AllPairsRow {
  imageAId: number;
  imageBId: number;
  phashDistance: number | null;
  textScore: number;
}

interface KonomiImageNative {
  computePHash(buf: Buffer): string | null;
  extractNaiLsb(buf: Buffer): NaiLsbResult | null;
  computeAllPairs(input: AllPairsInput): AllPairsRow[];
}

let _native: KonomiImageNative | null | undefined = undefined;

function getNative(): KonomiImageNative | null {
  if (_native !== undefined) return _native;
  try {
    const platform = `${process.platform}-${process.arch}`;
    const prebuildsRoot =
      process.env.KONOMI_PREBUILDS_PATH ??
      path.join(__dirname, "..", "..", "..", "prebuilds");
    const addonPath = path.join(prebuildsRoot, platform, "konomi-image.node");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _native = require(addonPath) as KonomiImageNative;
  } catch {
    _native = null;
  }
  return _native;
}

/**
 * Compute perceptual hash of a PNG image buffer.
 * Returns a 16-char lowercase hex string, or null if unavailable/failed.
 */
export function computePHash(buf: Buffer): string | null {
  return getNative()?.computePHash(buf) ?? null;
}

/**
 * Compute all similarity pair scores using inverted token index + pHash pass.
 * Returns only pairs that pass the loose persistence threshold.
 * Returns null if the native addon is unavailable.
 */
export function computeAllPairs(input: AllPairsInput): AllPairsRow[] | null {
  return getNative()?.computeAllPairs(input) ?? null;
}

/**
 * Decode a PNG buffer and extract NAI steganography LSBs.
 * Returns bit arrays (each byte is 0 or 1), column-major order.
 * Returns null if the native addon is unavailable or decode failed.
 */
export function extractNaiLsb(buf: Buffer): NaiLsbResult | null {
  return getNative()?.extractNaiLsb(buf) ?? null;
}
