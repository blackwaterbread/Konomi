import fs from "fs";
import path from "path";

export type CancelToken = { cancelled: boolean };

export async function* walkPngFiles(
  rootDir: string,
  signal?: CancelToken,
): AsyncGenerator<string> {
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
        yield fullPath;
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
  for await (const filePath of walkPngFiles(dir, signal)) {
    results.push(filePath);
  }
  return results;
}

export async function countPngFiles(
  dir: string,
  signal?: CancelToken,
): Promise<number> {
  let count = 0;
  for await (const _ of walkPngFiles(dir, signal)) {
    count++;
  }
  return count;
}

export async function withConcurrency<T>(
  items: T[] | AsyncIterable<T>,
  limit: number,
  fn: (item: T) => Promise<void>,
  signal?: CancelToken,
): Promise<void> {
  const safeLimit = Math.max(1, Math.floor(limit));

  if (Array.isArray(items)) {
    if (items.length === 0) return;
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
    return;
  }

  // Async iterable path — pull items from the iterator and dispatch to workers.
  // AsyncGenerators are NOT reentrant: calling next() while a previous next()
  // is still pending throws. We serialise pulls through a promise chain so that
  // only one next() call is in flight at a time, while workers still run fn()
  // concurrently.
  const iterator = items[Symbol.asyncIterator]();
  let done = false;
  let pullChain: Promise<void> = Promise.resolve();

  const next = (): Promise<T | undefined> => {
    const ticket = pullChain.then(async () => {
      if (done || signal?.cancelled) return undefined;
      const result = await iterator.next();
      if (result.done) {
        done = true;
        return undefined;
      }
      return result.value;
    });
    // Subsequent callers wait for *this* pull to finish before starting theirs.
    pullChain = ticket.then(() => {}, () => {});
    return ticket;
  };

  const worker = async (): Promise<void> => {
    while (!done && !signal?.cancelled) {
      const item = await next();
      if (item === undefined) break;
      await fn(item);
    }
  };

  await Promise.all(Array.from({ length: safeLimit }, worker));
}
