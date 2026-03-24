import { describe, expect, it } from "vitest";
import { deflateSync } from "zlib";
import { readPngSize, readPngTextChunks } from "../../../main/lib/png-meta";

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

function createIHDR(width: number, height: number): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = 2;
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return createChunk("IHDR", data);
}

function createTextChunk(key: string, value: string): Buffer {
  return createChunk(
    "tEXt",
    Buffer.concat([
      Buffer.from(key, "latin1"),
      Buffer.from([0]),
      Buffer.from(value, "latin1"),
    ]),
  );
}

function createCompressedTextChunk(key: string, value: string): Buffer {
  return createChunk(
    "zTXt",
    Buffer.concat([
      Buffer.from(key, "latin1"),
      Buffer.from([0, 0]),
      deflateSync(Buffer.from(value, "latin1")),
    ]),
  );
}

function createInternationalTextChunk(key: string, value: string): Buffer {
  return createChunk(
    "iTXt",
    Buffer.concat([
      Buffer.from(key, "latin1"),
      Buffer.from([0]),
      Buffer.from([0, 0]),
      Buffer.from([0]),
      Buffer.from([0]),
      Buffer.from(value, "utf8"),
    ]),
  );
}

function createPng(options?: {
  width?: number;
  height?: number;
  chunks?: Buffer[];
}): Buffer {
  const width = options?.width ?? 1024;
  const height = options?.height ?? 768;
  const chunks = options?.chunks ?? [];
  return Buffer.concat([
    PNG_SIGNATURE,
    createIHDR(width, height),
    ...chunks,
    createChunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("png-meta", () => {
  it("reads width and height from the IHDR chunk", () => {
    const buf = createPng({ width: 832, height: 1216 });

    expect(readPngSize(buf)).toEqual({ width: 832, height: 1216 });
  });

  it("collects PNG tEXt chunks into a key/value map", () => {
    const buf = createPng({
      chunks: [
        createTextChunk("Comment", "hello"),
        createTextChunk("Software", "Konomi"),
      ],
    });

    expect(readPngTextChunks(buf)).toEqual({
      Comment: "hello",
      Software: "Konomi",
    });
  });

  it("collects PNG zTXt and iTXt chunks into a key/value map", () => {
    const buf = createPng({
      chunks: [
        createCompressedTextChunk("Comment", "compressed"),
        createInternationalTextChunk(
          "Source",
          "NovelAI Diffusion V4.5 1229B44F",
        ),
      ],
    });

    expect(readPngTextChunks(buf)).toEqual({
      Comment: "compressed",
      Source: "NovelAI Diffusion V4.5 1229B44F",
    });
  });

  it("ignores malformed text chunks and stops reading after IEND", () => {
    const malformedText = createChunk(
      "tEXt",
      Buffer.from("badchunk", "latin1"),
    );
    const textAfterEnd = createTextChunk("Hidden", "ignored");
    const buf = Buffer.concat([
      PNG_SIGNATURE,
      createIHDR(640, 480),
      malformedText,
      createChunk("IEND", Buffer.alloc(0)),
      textAfterEnd,
    ]);

    expect(readPngTextChunks(buf)).toEqual({});
  });
});
