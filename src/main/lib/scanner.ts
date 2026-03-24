import fs from "fs";
import path from "path";

export type CancelToken = { cancelled: boolean };

async function walkPngFiles(
  rootDir: string,
  onFile: (filePath: string) => void,
  signal?: CancelToken,
): Promise<void> {
  const stack = [rootDir];
  while (stack.length > 0 && !signal?.cancelled) {
    const currentDir = stack.pop()!;
    let handle: fs.Dir | null = null;
    try {
      handle = await fs.promises.opendir(currentDir);
      for await (const entry of handle) {
        if (signal?.cancelled) break;
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        if (![".png", ".webp"].includes(path.extname(entry.name).toLowerCase()))
          continue;
        onFile(fullPath);
      }
    } catch {
      // folder not accessible
    } finally {
      if (handle) {
        await handle.close().catch(() => {
          // ignore close errors
        });
      }
    }
  }
}

export async function scanPngFiles(
  dir: string,
  signal?: CancelToken,
): Promise<string[]> {
  const results: string[] = [];
  await walkPngFiles(dir, (filePath) => results.push(filePath), signal);
  return results;
}

export async function countPngFiles(
  dir: string,
  signal?: CancelToken,
): Promise<number> {
  let count = 0;
  await walkPngFiles(
    dir,
    () => {
      count++;
    },
    signal,
  );
  return count;
}

export async function withConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
  signal?: CancelToken,
): Promise<void> {
  if (items.length === 0) return;
  const safeLimit = Math.max(1, Math.floor(limit));
  let index = 0;
  const worker = async (): Promise<void> => {
    while (index < items.length && !signal?.cancelled) {
      const item = items[index++];
      await fn(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(safeLimit, items.length) }, worker),
  );
}
