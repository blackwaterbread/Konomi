import { readFileSync, openSync, readSync, closeSync } from "fs";
import { extname } from "path";
import type { ImageMeta } from "../types/image-meta";
import { readComfyuiMetaFromBuffer } from "./comfyui";
import { readMidjourneyMetaFromBuffer } from "./midjourney";
import {
  readNaiMetaFromBuffer,
  readNaiMetaFromPngText,
  readNaiMetaFromWebp,
} from "./nai";
import { readWebuiMetaFromBuffer } from "./webui";

function isWebp(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

export function readImageMetaFromBuffer(buf: Buffer): ImageMeta | null {
  if (isWebp(buf)) return readNaiMetaFromWebp(buf);
  return (
    readWebuiMetaFromBuffer(buf) ??
    readComfyuiMetaFromBuffer(buf) ??
    readMidjourneyMetaFromBuffer(buf) ??
    readNaiMetaFromBuffer(buf)
  );
}

/**
 * Read only the bytes before the first IDAT chunk (where all text metadata
 * lives in a PNG file).  Returns null when the initial read is too small
 * to contain all pre-IDAT chunks — caller should fall back to full read.
 */
function readPngHeaderBytes(filePath: string): Buffer | null {
  const INITIAL_READ = 65536; // 64 KB — covers virtually all metadata
  const fd = openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(INITIAL_READ);
    const bytesRead = readSync(fd, buf, 0, INITIAL_READ, 0);
    if (bytesRead < 8) return null;

    let off = 8;
    while (off + 12 <= bytesRead) {
      const len = buf.readUInt32BE(off);
      const type = buf.subarray(off + 4, off + 8).toString("ascii");
      if (type === "IDAT") {
        return buf.subarray(0, off);
      }
      const nextOff = off + 12 + len;
      if (nextOff > bytesRead) return null; // chunk extends beyond read
      off = nextOff;
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

/**
 * Try only text-chunk-based parsers (no LSB / pixel decode).
 * Safe to call with a truncated buffer containing just pre-IDAT bytes.
 */
function readPngTextMeta(buf: Buffer): ImageMeta | null {
  return (
    readWebuiMetaFromBuffer(buf) ??
    readComfyuiMetaFromBuffer(buf) ??
    readMidjourneyMetaFromBuffer(buf) ??
    readNaiMetaFromPngText(buf)
  );
}

export function readImageMeta(filePath: string): ImageMeta | null {
  try {
    // PNG fast path: read only the header for text-based metadata
    if (extname(filePath).toLowerCase() === ".png") {
      const headerBuf = readPngHeaderBytes(filePath);
      if (headerBuf) {
        const meta = readPngTextMeta(headerBuf);
        if (meta) return meta;
      }
      // No text metadata found — fall through to full read for LSB
    }

    const buf = readFileSync(filePath);
    return readImageMetaFromBuffer(buf);
  } catch {
    return null;
  }
}
