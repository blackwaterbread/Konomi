import { inflateSync } from "zlib";

function readPlainTextChunk(
  data: Buffer,
): { key: string; value: string } | null {
  const nullIdx = data.indexOf(0);
  if (nullIdx === -1) return null;
  return {
    key: data.subarray(0, nullIdx).toString("latin1"),
    value: data.subarray(nullIdx + 1).toString("latin1"),
  };
}

function readCompressedTextChunk(
  data: Buffer,
): { key: string; value: string } | null {
  const nullIdx = data.indexOf(0);
  if (nullIdx === -1 || nullIdx + 2 > data.length) return null;
  if (data[nullIdx + 1] !== 0) return null;
  try {
    return {
      key: data.subarray(0, nullIdx).toString("latin1"),
      value: inflateSync(data.subarray(nullIdx + 2)).toString("latin1"),
    };
  } catch {
    return null;
  }
}

function readInternationalTextChunk(
  data: Buffer,
): { key: string; value: string } | null {
  const keywordEnd = data.indexOf(0);
  if (keywordEnd === -1 || keywordEnd + 5 > data.length) return null;

  const compressionFlag = data[keywordEnd + 1];
  const compressionMethod = data[keywordEnd + 2];
  if (compressionFlag === 1 && compressionMethod !== 0) return null;

  const languageEnd = data.indexOf(0, keywordEnd + 3);
  if (languageEnd === -1) return null;

  const translatedEnd = data.indexOf(0, languageEnd + 1);
  if (translatedEnd === -1) return null;

  const textData = data.subarray(translatedEnd + 1);
  try {
    return {
      key: data.subarray(0, keywordEnd).toString("latin1"),
      value:
        compressionFlag === 1
          ? inflateSync(textData).toString("utf8")
          : textData.toString("utf8"),
    };
  } catch {
    return null;
  }
}

export function readPngTextChunks(buf: Buffer): Record<string, string> {
  const chunks: Record<string, string> = {};
  let off = 8;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString("ascii");
    const data = buf.subarray(off + 8, off + 8 + len);
    const parsed =
      type === "tEXt"
        ? readPlainTextChunk(data)
        : type === "zTXt"
          ? readCompressedTextChunk(data)
          : type === "iTXt"
            ? readInternationalTextChunk(data)
            : null;
    if (parsed) {
      chunks[parsed.key] = parsed.value;
    }
    if (type === "IEND") break;
    off += 12 + len;
  }
  return chunks;
}

export function readPngSize(buf: Buffer): { width: number; height: number } {
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}
