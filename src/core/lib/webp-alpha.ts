import path from "path";

interface WebpAlphaResult {
  alpha: Buffer;
  width: number;
  height: number;
}

interface WebpRgbResult {
  rgb: Buffer;
  width: number;
  height: number;
}

interface WebpResizeResult {
  data: Buffer;
  width: number;
  height: number;
}

interface WebpAlphaNative {
  decodeAlpha(buf: Buffer): WebpAlphaResult | null;
  decodeRgb(buf: Buffer): WebpRgbResult | null;
  resizeWebp(buf: Buffer, maxWidth: number): WebpResizeResult | null;
}

let _native: WebpAlphaNative | null | undefined = undefined;

function getNative(): WebpAlphaNative | null {
  if (_native !== undefined) return _native;
  try {
    const platform = `${process.platform}-${process.arch}`;
    const prebuildsRoot =
      process.env.KONOMI_PREBUILDS_PATH ??
      path.join(__dirname, "..", "..", "..", "prebuilds");
    const addonPath = path.join(prebuildsRoot, platform, "webp-alpha.node");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _native = require(addonPath) as WebpAlphaNative;
  } catch {
    _native = null;
  }
  return _native;
}

export function decodeWebpAlpha(buf: Buffer): WebpAlphaResult | null {
  return getNative()?.decodeAlpha(buf) ?? null;
}

export function decodeWebpRgb(buf: Buffer): WebpRgbResult | null {
  return getNative()?.decodeRgb(buf) ?? null;
}

/**
 * Decode a WebP buffer, bilinear-resize to maxWidth (keeping aspect ratio),
 * and return raw BGRA pixel data + dimensions.
 * Returns null if native addon unavailable, decode fails, or image already <= maxWidth.
 */
export function resizeWebp(
  buf: Buffer,
  maxWidth: number,
): WebpResizeResult | null {
  return getNative()?.resizeWebp(buf, maxWidth) ?? null;
}

export type { WebpResizeResult };
