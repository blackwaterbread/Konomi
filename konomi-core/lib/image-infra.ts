import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getDB } from "./db";
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

const ignoredDuplicatePaths = new Set<string>();
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
    rows.forEach((row) => ignoredDuplicatePaths.add(row.path));
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
  const newPaths = paths.filter((p) => !ignoredDuplicatePaths.has(p));
  if (newPaths.length === 0) return;
  for (const p of newPaths) ignoredDuplicatePaths.add(p);
  const db = getDB();
  const BATCH_SIZE = 500;
  for (let i = 0; i < newPaths.length; i += BATCH_SIZE) {
    const batch = newPaths.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => "(?)").join(", ");
    await db.$executeRawUnsafe(
      `INSERT OR IGNORE INTO IgnoredDuplicatePath (path) VALUES ${placeholders}`,
      ...batch,
    );
  }
}

export async function isIgnoredDuplicatePath(
  filePath: string,
): Promise<boolean> {
  await ensureIgnoredDuplicatePathsLoaded();
  return ignoredDuplicatePaths.has(filePath);
}

export async function forgetIgnoredDuplicatePath(
  filePath: string,
): Promise<void> {
  await ensureIgnoredDuplicatePathsLoaded();
  if (!ignoredDuplicatePaths.has(filePath)) return;
  ignoredDuplicatePaths.delete(filePath);
  await getDB().$executeRawUnsafe(
    "DELETE FROM IgnoredDuplicatePath WHERE path = ?",
    filePath,
  );
}

export async function listIgnoredDuplicatePaths(): Promise<string[]> {
  await ensureIgnoredDuplicatePathsLoaded();
  return Array.from(ignoredDuplicatePaths).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

export async function clearIgnoredDuplicatePaths(): Promise<number> {
  await ensureIgnoredDuplicatePathsLoaded();
  const count = ignoredDuplicatePaths.size;
  ignoredDuplicatePaths.clear();
  await getDB().$executeRawUnsafe("DELETE FROM IgnoredDuplicatePath");
  return count;
}
