import path from "path";

interface NaiLsbResult {
  rgb: Buffer;
  alpha: Buffer | null;
}

interface KonomiImageNative {
  computePHash(buf: Buffer): string | null;
  extractNaiLsb(buf: Buffer): NaiLsbResult | null;
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
 * Decode a PNG buffer and extract NAI steganography LSBs.
 * Returns bit arrays (each byte is 0 or 1), column-major order.
 * Returns null if the native addon is unavailable or decode failed.
 */
export function extractNaiLsb(buf: Buffer): NaiLsbResult | null {
  return getNative()?.extractNaiLsb(buf) ?? null;
}
