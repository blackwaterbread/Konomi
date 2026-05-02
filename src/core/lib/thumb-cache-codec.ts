import fs from "fs";
import path from "path";

export const THUMB_CACHE_EXT = ".bin";

// Why XOR with a fixed key: prevents OS file managers, search indexers, and
// cloud sync tools from recognizing cached thumbnails as JPEG images. Not
// cryptographic — the key lives in the binary — but enough to defeat magic
// byte detection (FF D8 FF) and image preview generation.
const KEY = Buffer.from([
  0x4b, 0x6f, 0x6e, 0x6f, 0x6d, 0x69, 0x54, 0x68,
  0x75, 0x6d, 0x62, 0x43, 0x61, 0x63, 0x68, 0x65,
  0x76, 0x31, 0x21, 0x40, 0x23, 0x24, 0x25, 0x5e,
  0x26, 0x2a, 0x28, 0x29, 0x5f, 0x2b, 0x3d, 0x7e,
]);

export function scrambleThumb(input: Buffer): Buffer {
  const out = Buffer.allocUnsafe(input.length);
  const keyLen = KEY.length;
  for (let i = 0; i < input.length; i++) {
    out[i] = input[i] ^ KEY[i % keyLen];
  }
  return out;
}

export const unscrambleThumb = scrambleThumb;

// Removes legacy `.jpg` cache files left behind by versions that wrote
// thumbnails in plaintext. Safe to run on every startup — once the directory
// is clean it becomes a no-op.
export async function cleanLegacyThumbCache(dir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((name) => name.toLowerCase().endsWith(".jpg"))
      .map((name) =>
        fs.promises.unlink(path.join(dir, name)).catch(() => {}),
      ),
  );
}
