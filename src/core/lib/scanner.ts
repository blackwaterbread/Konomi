import fs from "fs";
import path from "path";
import { createLogger } from "./logger";

const log = createLogger("scanner");

export type CancelToken = { cancelled: boolean };

const IMAGE_EXTS = new Set([".png", ".webp"]);

// OS / NAS / cloud-sync metadata directories. These are created automatically
// next to user files (Synology's @eaDir contains thumbnails like
// SYNOPHOTO_THUMB_*.png that would otherwise be picked up as user images and
// inflate the DB).
const SKIP_DIR_NAMES = new Set([
  "@eaDir",
  "#recycle",
  "@Recycle",
  ".AppleDouble",
  ".DS_Store",
  ".Spotlight-V100",
  ".Trashes",
  ".fseventsd",
  ".TemporaryItems",
  "__MACOSX",
  "$RECYCLE.BIN",
  "System Volume Information",
  "Thumbs.db",
  ".thumbnails",
  ".cache",
]);

function shouldSkipDir(name: string): boolean {
  // Dotfile dirs (.git, .svn, etc.) are scan noise.
  if (name.startsWith(".")) return true;
  return SKIP_DIR_NAMES.has(name);
}

// Some filesystems (Synology FUSE shares, NFS, certain SMB mounts) return
// DT_UNKNOWN from getdents, leaving Dirent.isFile()/isDirectory() both false.
// In that case we have to stat the entry to learn what it is. The result is
// cached per directory iteration so each entry is stat'd at most once.
async function classifyDirent(
  fullPath: string,
  entry: fs.Dirent,
): Promise<"file" | "directory" | "other"> {
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  if (
    entry.isSymbolicLink() ||
    entry.isBlockDevice() ||
    entry.isCharacterDevice() ||
    entry.isFIFO() ||
    entry.isSocket()
  ) {
    // Real non-file/dir type — fall through to stat in case it's a symlink to
    // a file/directory we want to follow.
  }
  try {
    const stat = await fs.promises.stat(fullPath);
    if (stat.isDirectory()) return "directory";
    if (stat.isFile()) return "file";
    return "other";
  } catch (err) {
    log.warn(`stat fallback failed for ${fullPath}`, err);
    return "other";
  }
}

export async function* walkImageFiles(
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
        const kind = await classifyDirent(fullPath, entry);
        if (kind === "directory") {
          if (shouldSkipDir(entry.name)) continue;
          stack.push(fullPath);
          continue;
        }
        if (kind !== "file") continue;
        if (!IMAGE_EXTS.has(path.extname(entry.name).toLowerCase())) continue;
        yield fullPath;
      }
    } catch (err) {
      log.warn(`failed to read directory ${currentDir}`, err);
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch {
          /* ignore close errors */
        }
      }
    }
  }
}

export async function scanImageFiles(
  dir: string,
  signal?: CancelToken,
): Promise<string[]> {
  const results: string[] = [];
  for await (const filePath of walkImageFiles(dir, signal)) {
    results.push(filePath);
  }
  return results;
}

export async function countImageFiles(
  dir: string,
  signal?: CancelToken,
): Promise<number> {
  let count = 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _ of walkImageFiles(dir, signal)) {
    count++;
  }
  return count;
}

/**
 * Counts image files and collects the max directory mtime in a single walk.
 * Directory mtime changes when direct children are added/deleted, so checking
 * every directory in the tree detects structural changes at any depth without
 * stat-ing individual files.
 */
export async function verifyImageFolder(
  rootDir: string,
  signal?: CancelToken,
): Promise<{ fileCount: number; maxDirMtimeMs: number }> {
  let fileCount = 0;
  let maxDirMtimeMs = 0;

  const stack = [rootDir];
  while (stack.length > 0 && !signal?.cancelled) {
    const currentDir = stack.pop()!;
    let handle: fs.Dir | null = null;
    try {
      const dirStat = await fs.promises.stat(currentDir);
      if (dirStat.mtimeMs > maxDirMtimeMs) {
        maxDirMtimeMs = dirStat.mtimeMs;
      }
      handle = await fs.promises.opendir(currentDir);
      for await (const entry of handle) {
        if (signal?.cancelled) break;
        const fullPath = path.join(currentDir, entry.name);
        const kind = await classifyDirent(fullPath, entry);
        if (kind === "directory") {
          if (shouldSkipDir(entry.name)) continue;
          stack.push(fullPath);
          continue;
        }
        if (kind !== "file") continue;
        if (!IMAGE_EXTS.has(path.extname(entry.name).toLowerCase())) continue;
        fileCount++;
      }
    } catch (err) {
      log.warn(`failed to read directory ${currentDir}`, err);
    } finally {
      if (handle) {
        await handle.close().catch(() => {});
      }
    }
  }

  return { fileCount, maxDirMtimeMs };
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
    pullChain = ticket.then(
      () => {},
      () => {},
    );
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
