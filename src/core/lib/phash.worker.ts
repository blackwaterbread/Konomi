import { parentPort } from "worker_threads";
import { readFileSync } from "fs";
import { inflateSync } from "zlib";
import { computePHash as computePHashNative } from "@core/lib/konomi-image";
import { decodeWebpRgb } from "@core/lib/webp-alpha";

const HASH_SIZE = 8;
const DCT_SIZE = 32;

// ── PNG decoder (pure Node.js, no Electron API) ───────────────────────────────
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

// ── Bilinear resize → grayscale grid ─────────────────────────────────────────
function toGrayscaleGrid(
  px: Buffer,
  srcW: number,
  srcH: number,
  ch: number,
  dstW: number,
  dstH: number,
): number[][] {
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;
  const grid: number[][] = Array.from({ length: dstH }, () => new Array(dstW));
  for (let dy = 0; dy < dstH; dy++) {
    for (let dx = 0; dx < dstW; dx++) {
      const sx = dx * xRatio,
        sy = dy * yRatio;
      const x0 = Math.floor(sx),
        y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, srcW - 1),
        y1 = Math.min(y0 + 1, srcH - 1);
      const xf = sx - x0,
        yf = sy - y0;
      const gray = (x: number, y: number): number => {
        const i = (y * srcW + x) * ch;
        return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      };
      grid[dy][dx] =
        gray(x0, y0) * (1 - xf) * (1 - yf) +
        gray(x1, y0) * xf * (1 - yf) +
        gray(x0, y1) * (1 - xf) * yf +
        gray(x1, y1) * xf * yf;
    }
  }
  return grid;
}

// ── 1D DCT-II ────────────────────────────────────────────────────────────────
function dct1d(arr: number[]): number[] {
  const N = arr.length;
  const out: number[] = new Array(N);
  for (let k = 0; k < N; k++) {
    let sum = 0;
    for (let n = 0; n < N; n++) {
      sum += arr[n] * Math.cos((Math.PI * (2 * n + 1) * k) / (2 * N));
    }
    out[k] = k === 0 ? sum / Math.sqrt(N) : sum * Math.sqrt(2 / N);
  }
  return out;
}

function isWebp(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

// ── pHash (synchronous, runs in worker thread) ────────────────────────────────
function computePHashSync(filePath: string): string {
  const buf = readFileSync(filePath);

  // Try native addon first (libpng + C++ DCT — significantly faster)
  const nativeHash = computePHashNative(buf);
  if (nativeHash !== null) return nativeHash;

  // WebP: decode via native webp-alpha addon, then JS DCT
  let px: Buffer, w: number, h: number, ch: number;
  if (isWebp(buf)) {
    const webp = decodeWebpRgb(buf);
    if (!webp) throw new Error("WebP decode failed");
    px = webp.rgb;
    w = webp.width;
    h = webp.height;
    ch = 3;
  } else {
    ({ px, w, h, ch } = decodePng(buf));
  }

  // JS fallback: grayscale → DCT → hash
  const pixels = toGrayscaleGrid(px, w, h, ch, DCT_SIZE, DCT_SIZE);

  const rowDct = pixels.map(dct1d);
  const colDct: number[][] = Array.from(
    { length: DCT_SIZE },
    () => new Array(DCT_SIZE),
  );
  for (let x = 0; x < DCT_SIZE; x++) {
    const colResult = dct1d(rowDct.map((row) => row[x]));
    for (let y = 0; y < DCT_SIZE; y++) colDct[y][x] = colResult[y];
  }

  const sub: number[] = [];
  for (let y = 0; y < HASH_SIZE; y++)
    for (let x = 0; x < HASH_SIZE; x++) sub.push(colDct[y][x]);

  const sorted = [...sub].sort((a, b) => a - b);
  const median = (sorted[31] + sorted[32]) / 2;
  let hash = 0n;
  for (const v of sub) hash = (hash << 1n) | (v > median ? 1n : 0n);
  return hash.toString(16).padStart(16, "0");
}

parentPort!.on(
  "message",
  ({ id, filePath }: { id: number; filePath: string }) => {
    try {
      parentPort!.postMessage({ id, hash: computePHashSync(filePath) });
    } catch {
      parentPort!.postMessage({ id, hash: null });
    }
  },
);
