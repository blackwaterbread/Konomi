import fs from "fs/promises";
import path from "path";
import { bridge } from "../bridge";
import { createLogger } from "./logger";

type FolderRow = {
  id: number;
  name: string;
  path: string;
};

const ROOT_CACHE_TTL_MS = 5000;
const TRANSIENT_PATH_TTL_MS = 15 * 60 * 1000;
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
};

const log = createLogger("main/path-guard");
const transientPaths = new Map<string, number>();
let cachedRoots: string[] = [];
let rootsLoadedAt = 0;
let pendingRootsLoad: Promise<string[]> | null = null;

function normalizePathForCompare(filePath: string): string {
  const normalized = path.normalize(filePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function resolvePathForCompare(
  candidatePath: string,
): Promise<string | null> {
  if (typeof candidatePath !== "string") return null;
  const trimmed = candidatePath.trim();
  if (!trimmed) return null;

  const resolved = path.resolve(trimmed);
  if (!path.isAbsolute(resolved)) return null;
  try {
    return normalizePathForCompare(await fs.realpath(resolved));
  } catch {
    return normalizePathForCompare(resolved);
  }
}

function isSubPath(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function pruneExpiredTransientPaths(now = Date.now()): void {
  for (const [filePath, expiresAt] of transientPaths.entries()) {
    if (expiresAt <= now) transientPaths.delete(filePath);
  }
}

async function readRootsFromUtility(): Promise<string[]> {
  try {
    const rows = await bridge.request<FolderRow[]>("folder:list");
    const roots: string[] = [];
    for (const row of rows) {
      const resolved = await resolvePathForCompare(row.path);
      if (resolved) roots.push(resolved);
    }
    return [...new Set(roots)];
  } catch (error) {
    log.warn("Failed to read folder roots for path guard", {
      error: error instanceof Error ? error.message : String(error),
    });
    return cachedRoots;
  }
}

async function getAllowedRoots(forceRefresh = false): Promise<string[]> {
  const now = Date.now();
  if (
    !forceRefresh &&
    cachedRoots.length > 0 &&
    now - rootsLoadedAt < ROOT_CACHE_TTL_MS
  ) {
    return cachedRoots;
  }

  if (pendingRootsLoad) {
    return pendingRootsLoad;
  }

  pendingRootsLoad = readRootsFromUtility()
    .then((roots) => {
      cachedRoots = roots;
      rootsLoadedAt = Date.now();
      return roots;
    })
    .finally(() => {
      pendingRootsLoad = null;
    });

  return pendingRootsLoad;
}

export async function warmManagedRootsCache(): Promise<void> {
  const roots = await getAllowedRoots(false);
  log.info("Managed roots cache warmed", { count: roots.length });
}

export async function registerTransientPath(filePath: string): Promise<void> {
  const normalized = await resolvePathForCompare(filePath);
  if (!normalized) return;
  pruneExpiredTransientPaths();
  transientPaths.set(normalized, Date.now() + TRANSIENT_PATH_TTL_MS);
}

export function isSupportedImagePath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_CONTENT_TYPES[ext] !== undefined;
}

export function getImageContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_CONTENT_TYPES[ext] ?? "application/octet-stream";
}

export async function isManagedImagePath(filePath: string): Promise<boolean> {
  const normalized = await resolvePathForCompare(filePath);
  if (!normalized) return false;
  if (!isSupportedImagePath(normalized)) return false;

  const now = Date.now();
  pruneExpiredTransientPaths(now);
  const expiresAt = transientPaths.get(normalized);
  if (expiresAt && expiresAt > now) return true;

  const isAllowedByRoots = (roots: string[]) =>
    roots.some((root) => isSubPath(normalized, root));

  const roots = await getAllowedRoots(false);
  if (isAllowedByRoots(roots)) return true;

  // Force-refresh once to avoid stale cache right after folder changes.
  const refreshedRoots = await getAllowedRoots(true);
  return isAllowedByRoots(refreshedRoots);
}
