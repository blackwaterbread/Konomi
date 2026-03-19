export function readPngTextChunks(buf: Buffer): Record<string, string> {
  const chunks: Record<string, string> = {};
  let off = 8;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString("ascii");
    if (type === "tEXt") {
      const data = buf.subarray(off + 8, off + 8 + len);
      const nullIdx = data.indexOf(0);
      if (nullIdx !== -1) {
        const key = data.subarray(0, nullIdx).toString("latin1");
        const value = data.subarray(nullIdx + 1).toString("latin1");
        chunks[key] = value;
      }
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
