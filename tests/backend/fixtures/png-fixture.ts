import { deflateSync, gzipSync } from "zlib";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function createChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const chunkType = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  return Buffer.concat([len, chunkType, data, crc]);
}

export function createPngTextChunk(key: string, value: string): Buffer {
  return createChunk(
    "tEXt",
    Buffer.concat([
      Buffer.from(key, "latin1"),
      Buffer.from([0]),
      Buffer.from(value, "latin1"),
    ]),
  );
}

/**
 * Creates a minimal RGBA PNG with NAI steganographic metadata encoded in the
 * alpha-channel LSBs, matching the format that readNaiMetaFromBuffer expects.
 *
 * The steganography layout (column-major, 1 bit per alpha pixel):
 *   [15-byte magic "stealth_pngcomp"] [32-bit data-bit-count] [gzip-compressed JSON]
 */
export function createNaiPngBuffer(raw: Record<string, unknown>): Buffer {
  const W = 100;
  const H = 100;

  // Build steganography bits
  const compressed = gzipSync(Buffer.from(JSON.stringify(raw), "utf8"));
  const dataBitCount = compressed.length * 8;

  const bits: number[] = [];

  // Magic (15 bytes, MSB first)
  const magic = "stealth_pngcomp";
  for (let i = 0; i < 15; i++) {
    const b = magic.charCodeAt(i);
    for (let j = 7; j >= 0; j--) bits.push((b >> j) & 1);
  }

  // 32-bit length (MSB first)
  for (let i = 31; i >= 0; i--) bits.push((dataBitCount >> i) & 1);

  // Compressed data (MSB first per byte)
  for (let i = 0; i < compressed.length; i++) {
    for (let j = 7; j >= 0; j--) bits.push((compressed[i] >> j) & 1);
  }

  if (bits.length > W * H) {
    throw new Error(
      `createNaiPngBuffer: metadata too large (${bits.length} bits > ${W * H} pixels)`,
    );
  }

  // Encode bits into alpha LSBs, column-major (x outer, y inner)
  const px = Buffer.alloc(W * H * 4, 0xff);
  for (let k = 0; k < bits.length; k++) {
    const x = Math.floor(k / H);
    const y = k % H;
    const idx = (y * W + x) * 4 + 3;
    px[idx] = (px[idx] & 0xfe) | bits[k];
  }

  // Build raw PNG row data (filter byte 0 = None, then RGBA pixels per row)
  const rowStride = W * 4;
  const raw2 = Buffer.alloc(H * (rowStride + 1));
  for (let y = 0; y < H; y++) {
    raw2[y * (rowStride + 1)] = 0;
    px.copy(raw2, y * (rowStride + 1) + 1, y * rowStride, (y + 1) * rowStride);
  }

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(W, 0);
  ihdrData.writeUInt32BE(H, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  return Buffer.concat([
    PNG_SIGNATURE,
    createChunk("IHDR", ihdrData),
    createChunk("IDAT", deflateSync(raw2)),
    createChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function createPngBuffer(options?: {
  width?: number;
  height?: number;
  chunks?: Buffer[];
}): Buffer {
  const width = options?.width ?? 1024;
  const height = options?.height ?? 768;
  const chunks = options?.chunks ?? [];

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  return Buffer.concat([
    PNG_SIGNATURE,
    createChunk("IHDR", ihdrData),
    ...chunks,
    createChunk("IEND", Buffer.alloc(0)),
  ]);
}
