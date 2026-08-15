import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getDB, insertIgnore } from "./db";
import { normalizePathKey } from "./path-key";
import { WorkerPool } from "@core/lib/worker-pool";
import type { ImageMeta } from "@core/types/image-meta";

// ── Types ──────────────────────────────────────────────────────

export type ImageRow = {
  id: number;
  path: string;
  folderId: number;
  prompt: string;
  negativePrompt: string;
  characterPrompts: string;
  promptTokens?: string;
  negativePromptTokens?: string;
  characterPromptTokens?: string;
  source: string;
  model: string;
  seed: string;
  width: number;
  height: number;
  sampler: string;
  steps: number;
  cfgScale: number;
  cfgRescale: number;
  noiseSchedule: string;
  varietyPlus: boolean;
  isFavorite: boolean;
  pHash: string;
  fileSize: number;
  fileModifiedAt: Date;
  createdAt: Date;
};

// ── Worker pool ───────────────────────────────────────────────

const POOL_SIZE = 4;
const WORKER_PATH = path.join(__dirname, "nai.worker.js");

export const naiPool = new WorkerPool<ImageMeta | null>({
  size: POOL_SIZE,
  workerPath: WORKER_PATH,
  idleTimeoutMs: 10_000,
  extractResult: (msg) => (msg.result as ImageMeta | null) ?? null,
});

// ── File hash ─────────────────────────────────────────────────

export async function fileHash(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finalize = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const hash = crypto.createHash("sha1");
    const stream = fs.createReadStream(filePath);
    stream.on("error", () => finalize(null));
    stream.on("data", (chunk: string | Buffer) => {
      hash.update(chunk);
    });
    stream.on("end", () => {
      try {
        finalize(hash.digest("hex"));
      } catch {
        finalize(null);
      }
    });
  });
}

// ── Ignored duplicate paths ───────────────────────────────────

/**
 * Keyed by `normalizePathKey`; the value keeps every spelling the DB holds for
 * that file.
 *
 * A subtree-scoped scan can reach a file under different casing than the row
 * that recorded it, and an exact compare would then miss the entry — the
 * duplicate the user chose to ignore reappears on every rescan, one Apply away
 * from being deleted. Rows written before that fold landed can spell one file
 * several ways, so forgetting it has to delete all of them: leave one behind
 * and the next process start loads the entry straight back.
 */
const ignoredDuplicatePaths = new Map<string, string[]>();
let ignoredDuplicatePathsLoaded = false;
let ignoredDuplicatePathsLoading: Promise<void> | null = null;

export async function ensureIgnoredDuplicatePathsLoaded(): Promise<void> {
  if (ignoredDuplicatePathsLoaded) return;
  if (ignoredDuplicatePathsLoading) {
    await ignoredDuplicatePathsLoading;
    return;
  }

  const db = getDB();
  ignoredDuplicatePathsLoading = (async () => {
    const rows = await db.ignoredDuplicatePath.findMany({
      select: { path: true },
    });
    rows.forEach((row) => {
      const key = normalizePathKey(row.path);
      const stored = ignoredDuplicatePaths.get(key);
      if (stored) stored.push(row.path);
      else ignoredDuplicatePaths.set(key, [row.path]);
    });
    ignoredDuplicatePathsLoaded = true;
  })();

  try {
    await ignoredDuplicatePathsLoading;
  } finally {
    ignoredDuplicatePathsLoading = null;
  }
}

export async function registerIgnoredDuplicatePaths(
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;
  await ensureIgnoredDuplicatePathsLoaded();
  const newPaths: string[] = [];
  for (const p of paths) {
    const key = normalizePathKey(p);
    if (ignoredDuplicatePaths.has(key)) continue;
    ignoredDuplicatePaths.set(key, [p]);
    newPaths.push(p);
  }
  if (newPaths.length === 0) return;
  const db = getDB();
  const BATCH_SIZE = 500;
  for (let i = 0; i < newPaths.length; i += BATCH_SIZE) {
    const batch = newPaths.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => "(?)").join(", ");
    await db.$executeRawUnsafe(
      `${insertIgnore()} IgnoredDuplicatePath (path) VALUES ${placeholders}`,
      ...batch,
    );
  }
}

export async function isIgnoredDuplicatePath(
  filePath: string,
): Promise<boolean> {
  await ensureIgnoredDuplicatePathsLoaded();
  return ignoredDuplicatePaths.has(normalizePathKey(filePath));
}

export async function forgetIgnoredDuplicatePath(
  filePath: string,
): Promise<void> {
  await ensureIgnoredDuplicatePathsLoaded();
  const key = normalizePathKey(filePath);
  const storedPaths = ignoredDuplicatePaths.get(key);
  if (storedPaths === undefined) return;
  ignoredDuplicatePaths.delete(key);
  const placeholders = storedPaths.map(() => "?").join(", ");
  await getDB().$executeRawUnsafe(
    `DELETE FROM IgnoredDuplicatePath WHERE path IN (${placeholders})`,
    ...storedPaths,
  );
}

export async function listIgnoredDuplicatePaths(): Promise<string[]> {
  await ensureIgnoredDuplicatePathsLoaded();
  // One entry per file, not per stored spelling.
  return Array.from(ignoredDuplicatePaths.values())
    .map((paths) => paths[0])
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export async function clearIgnoredDuplicatePaths(): Promise<number> {
  await ensureIgnoredDuplicatePathsLoaded();
  // Counted per file, like `listIgnoredDuplicatePaths` reports them — the
  // number answers "how many ignored duplicates did I just clear?", and a row
  // count would exceed the list the caller was looking at whenever one file is
  // stored under several spellings.
  const count = ignoredDuplicatePaths.size;
  ignoredDuplicatePaths.clear();
  await getDB().$executeRawUnsafe("DELETE FROM IgnoredDuplicatePath");
  return count;
}
