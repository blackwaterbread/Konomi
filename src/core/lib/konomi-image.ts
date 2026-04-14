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
  targetIndices?: Uint32Array;
}

export interface AllPairsResult {
  imageAIds: Int32Array;
  imageBIds: Int32Array;
  phashDistances: Int32Array; // -1 = null
  textScores: Float64Array;
}

interface ResizePngResult {
  data: Buffer;
  width: number;
  height: number;
}

interface KonomiImageNative {
  computePHash(buf: Buffer): string | null;
  extractNaiLsb(buf: Buffer): NaiLsbResult | null;
  computeAllPairs(input: AllPairsInput): AllPairsResult;
  resizePng(buf: Buffer, maxWidth: number): ResizePngResult | null;
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
 * Compute similarity pair scores using inverted token index + pHash pass.
 * When targetIndices is set, only pairs involving at least one target are computed.
 * Returns flat typed arrays (phashDistances uses -1 for null).
 * Returns null if the native addon is unavailable.
 */
export function computeAllPairs(input: AllPairsInput): AllPairsResult | null {
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

/**
 * Decode a PNG buffer, bilinear-resize to maxWidth (keeping aspect ratio),
 * and return raw BGRA pixel data + dimensions.
 * Returns null if native addon unavailable, decode fails, or image already <= maxWidth.
 */
export function resizePng(
  buf: Buffer,
  maxWidth: number,
): ResizePngResult | null {
  return getNative()?.resizePng(buf, maxWidth) ?? null;
}

export type { ResizePngResult };
