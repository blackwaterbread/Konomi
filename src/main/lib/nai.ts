import { readFileSync } from "fs";
import { inflateSync, gunzipSync } from "zlib";
import type { ImageMeta } from "@/types/image-meta";
import { readPngTextChunks } from "./png-meta";
import { decodeWebpAlpha } from "./webp-alpha";
import { extractNaiLsb } from "./konomi-image";

const PAETH = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

function decodePng(buf: Buffer): {
  px: Buffer;
  w: number;
  h: number;
  ch: number;
} {
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const colorType = buf[25];
  const ch = colorType === 6 ? 4 : 3;

  const parts: Buffer[] = [];
  let off = 8;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString("ascii");
    if (type === "IDAT") parts.push(buf.subarray(off + 8, off + 8 + len));
    if (type === "IEND") break;
    off += 12 + len;
  }

  const raw = inflateSync(Buffer.concat(parts));
  const stride = w * ch;
  const px = Buffer.alloc(h * stride);

  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const s = y * (stride + 1) + 1;
    const d = y * stride;
    const p = (y - 1) * stride;

    for (let x = 0; x < stride; x++) {
      const v = raw[s + x];
      const a = x >= ch ? px[d + x - ch] : 0;
      const b = y > 0 ? px[p + x] : 0;
      const c = x >= ch && y > 0 ? px[p + x - ch] : 0;
      px[d + x] =
        (f === 0
          ? v
          : f === 1
            ? v + a
            : f === 2
              ? v + b
              : f === 3
                ? v + ((a + b) >> 1)
                : v + PAETH(a, b, c)) & 0xff;
    }
  }

  return { px, w, h, ch };
}

function decodeNaiStealth(
  px: Buffer,
  w: number,
  h: number,
  ch: number,
): Record<string, unknown> | null {
  const hasAlpha = ch === 4;
  const MAGIC_BITS = 15 * 8;
  const MAX_RGB_BITS = MAGIC_BITS + 32 + 2_000_000;

  const bA: number[] = [];
  const bRgb: number[] = [];
  let done = false;

  for (let x = 0; x < w && !done; x++) {
    for (let y = 0; y < h && !done; y++) {
      const base = (y * w + x) * ch;
      if (hasAlpha) bA.push(px[base + 3] & 1);
      bRgb.push(px[base] & 1);
      bRgb.push(px[base + 1] & 1);
      bRgb.push(px[base + 2] & 1);
      if (bRgb.length >= MAX_RGB_BITS) done = true;
    }
  }

  return tryDecode(bA) ?? tryDecode(bRgb);
}

function tryDecode(bits: ArrayLike<number>): Record<string, unknown> | null {
  const MAGIC_BITS = 15 * 8;
  if (bits.length < MAGIC_BITS + 32) return null;

  const sigChars: number[] = [];
  for (let i = 0; i < 15; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i * 8 + j];
    sigChars.push(byte);
  }
  const sig = Buffer.from(sigChars).toString("ascii");
  if (sig !== "stealth_pngcomp" && sig !== "stealth_pnginfo") return null;

  let paramLen = 0;
  for (let i = 0; i < 32; i++) paramLen = paramLen * 2 + bits[MAGIC_BITS + i];

  const dataStart = MAGIC_BITS + 32;
  if (bits.length < dataStart + paramLen) return null;

  const dataBytes = Buffer.alloc(Math.ceil(paramLen / 8));
  for (let i = 0; i < paramLen; i++) {
    if (bits[dataStart + i]) dataBytes[i >> 3] |= 0x80 >> (i & 7);
  }

  try {
    const jsonStr =
      sig === "stealth_pngcomp"
        ? gunzipSync(dataBytes).toString("utf8")
        : dataBytes.toString("utf8");
    return JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isNovelAI(raw: Record<string, unknown>): boolean {
  return (
    raw["Software"] === "NovelAI" ||
    (typeof raw["Source"] === "string" && raw["Source"].startsWith("NovelAI"))
  );
}

const SOURCE_TO_MODEL: Record<string, string> = {
  "NovelAI Diffusion V4.5 4BDE2A90": "nai-diffusion-4-5-full",
  "NovelAI Diffusion V4.5 1229B44F": "nai-diffusion-4-5-full",
  "NovelAI Diffusion V4.5 C02D4F98": "nai-diffusion-4-5-curated",
  "NovelAI Diffusion V4 37442FCA": "nai-diffusion-4-full-preview",
  "NovelAI Diffusion V4 7ABFFA2A": "nai-diffusion-4-curated-preview",
  "Stable Diffusion XL 7BCCAA2C": "nai-diffusion-3",
  "Stable Diffusion XL 37C2B166": "nai-diffusion-furry-3",
};

function parseNaiComment(raw: Record<string, unknown>): ImageMeta | null {
  if (typeof raw["Comment"] !== "string") return null;

  let comment: Record<string, unknown>;
  try {
    comment = JSON.parse(raw["Comment"]) as Record<string, unknown>;
  } catch {
    return null;
  }

  interface CharCaption {
    char_caption: string;
    centers?: { x: number; y: number }[];
  }
  interface V4Caption {
    caption: { base_caption: string; char_captions?: CharCaption[] };
    use_coords?: boolean;
  }

  const colRevMap: Record<string, string> = {
    "0.1": "A",
    "0.3": "B",
    "0.5": "C",
    "0.7": "D",
    "0.9": "E",
  };
  const rowRevMap: Record<string, string> = {
    "0.1": "1",
    "0.3": "2",
    "0.5": "3",
    "0.7": "4",
    "0.9": "5",
  };
  function centerToPosition(
    center: { x: number; y: number } | undefined,
  ): string {
    if (!center) return "global";
    const col = colRevMap[String(center.x)];
    const row = rowRevMap[String(center.y)];
    return col && row ? `${col}${row}` : "global";
  }

  const v4Prompt = comment["v4_prompt"] as V4Caption | undefined;
  const prompt =
    v4Prompt?.caption?.base_caption ??
    (typeof comment["prompt"] === "string"
      ? comment["prompt"]
      : typeof raw["Description"] === "string"
        ? raw["Description"]
        : "");

  const v4Negative = (comment["v4_negative_prompt"] as V4Caption | undefined)
    ?.caption?.base_caption;
  const negativePrompt =
    v4Negative ?? (typeof comment["uc"] === "string" ? comment["uc"] : "");

  const characterPrompts: string[] =
    v4Prompt?.caption?.char_captions
      ?.map((c) => c.char_caption)
      .filter(Boolean) ?? [];

  const v4NegativeCaption = comment["v4_negative_prompt"] as
    | V4Caption
    | undefined;
  const characterNegativePrompts: string[] =
    v4NegativeCaption?.caption?.char_captions?.map((c) => c.char_caption) ?? [];

  const useCoords = v4Prompt?.use_coords ?? false;
  const characterPositions: string[] =
    v4Prompt?.caption?.char_captions?.map((c) =>
      useCoords ? centerToPosition(c.centers?.[0]) : "global",
    ) ?? [];

  const source = typeof raw["Source"] === "string" ? raw["Source"] : "";
  const model = SOURCE_TO_MODEL[source] ?? "";

  return {
    source: "nai",
    prompt,
    negativePrompt,
    characterPrompts,
    characterNegativePrompts,
    characterPositions,
    seed: Number(comment["seed"] ?? 0),
    model,
    sampler: String(comment["sampler"] ?? ""),
    steps: Number(comment["steps"] ?? 0),
    cfgScale: Number(comment["scale"] ?? comment["cfg_scale"] ?? 0),
    cfgRescale: Number(comment["cfg_rescale"] ?? 0),
    noiseSchedule: String(comment["noise_schedule"] ?? ""),
    varietyPlus: Boolean(comment["dynamic_thresholding"] ?? false),
    width: Number(comment["width"] ?? 0),
    height: Number(comment["height"] ?? 0),
    raw,
  };
}

export function readNaiMeta(filePath: string): ImageMeta | null {
  try {
    const buf = readFileSync(filePath);
    return readNaiMetaFromBuffer(buf);
  } catch {
    return null;
  }
}

export function readNaiMetaFromPngText(buf: Buffer): ImageMeta | null {
  try {
    const chunks = readPngTextChunks(buf);
    if (!isNovelAI(chunks)) return null;
    return parseNaiComment(chunks);
  } catch {
    return null;
  }
}

function readNaiMetaFromLsb(buf: Buffer): ImageMeta | null {
  try {
    // Try native path first (libpng decode + C++ LSB extraction)
    const lsb = extractNaiLsb(buf);
    if (lsb !== null) {
      const raw =
        tryDecode(lsb.alpha ?? new Uint8Array(0)) ?? tryDecode(lsb.rgb);
      if (!raw || !isNovelAI(raw)) return null;
      return parseNaiComment(raw);
    }

    // Fallback: pure JS implementation
    const { px, w, h, ch } = decodePng(buf);
    const raw = decodeNaiStealth(px, w, h, ch);
    if (!raw || !isNovelAI(raw)) return null;
    return parseNaiComment(raw);
  } catch {
    return null;
  }
}

export function readNaiMetaFromBuffer(buf: Buffer): ImageMeta | null {
  return readNaiMetaFromPngText(buf) ?? readNaiMetaFromLsb(buf);
}

export function readNaiMetaFromWebp(buf: Buffer): ImageMeta | null {
  try {
    const decoded = decodeWebpAlpha(buf);
    if (!decoded) return null;
    const { alpha, width, height } = decoded;
    const MAX_BITS = 15 * 8 + 32 + 2_000_000;
    const bA: number[] = [];
    let done = false;
    for (let x = 0; x < width && !done; x++) {
      for (let y = 0; y < height && !done; y++) {
        bA.push(alpha[y * width + x] & 1);
        if (bA.length >= MAX_BITS) done = true;
      }
    }
    const raw = tryDecode(bA);
    if (!raw || !isNovelAI(raw)) return null;
    return parseNaiComment(raw);
  } catch {
    return null;
  }
}
