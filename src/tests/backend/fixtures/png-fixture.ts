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
