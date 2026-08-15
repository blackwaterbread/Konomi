// ---------------------------------------------------------------------------
// Duplicate detection primitives
// ---------------------------------------------------------------------------
// Shared by `duplicate-service.findDuplicates` (one directory, on demand) and
// `scan-service`'s pre-scan (many subtrees, mid-scan, with progress). Both do
// the same three-phase work — bucket by size, hash only the sizes that can
// collide, group by signature — and keeping two copies meant every fix to the
// path-comparison rules had to be found and applied twice.

import fs from "fs";
import path from "path";
import { withConcurrency } from "./scanner";
import { normalizePathKey } from "./path-key";
import type { CancelToken } from "./scanner";

const SIZE_SCAN_CONCURRENCY = 32;
const HASH_SCAN_CONCURRENCY = 12;

// ── Types ──────────────────────────────────────────────────────

export type FolderDuplicateExistingEntry = {
  imageId: number;
  path: string;
  fileName: string;
};

export type FolderDuplicateIncomingEntry = {
  path: string;
  fileName: string;
};

export type FolderDuplicateGroup = {
  id: string;
  hash: string;
  previewPath: string;
  previewFileName: string;
  existingEntries: FolderDuplicateExistingEntry[];
  incomingEntries: FolderDuplicateIncomingEntry[];
};

export type FolderDuplicateGroupResolution = {
  id: string;
  hash: string;
  keep: "existing" | "incoming" | "ignore";
  existingEntries: Array<{ imageId: number; path: string }>;
  incomingPaths: string[];
};

export type ExistingSizeBuckets = Map<number, FolderDuplicateExistingEntry[]>;
export type IncomingSizeBuckets = Map<number, FolderDuplicateIncomingEntry[]>;

export type HashFile = (filePath: string) => Promise<string | null>;

// ── Bucketing ──────────────────────────────────────────────────

export async function fileSize(filePath: string): Promise<number | null> {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

export async function buildIncomingSizeBuckets(
  incomingPaths: string[],
  signal?: CancelToken,
): Promise<IncomingSizeBuckets> {
  const buckets: IncomingSizeBuckets = new Map();
  await withConcurrency(
    incomingPaths,
    SIZE_SCAN_CONCURRENCY,
    async (incomingPath) => {
      const size = await fileSize(incomingPath);
      if (size === null) return;
      const bucket = buckets.get(size) ?? [];
      bucket.push({ path: incomingPath, fileName: path.basename(incomingPath) });
      buckets.set(size, bucket);
    },
    signal,
  );
  return buckets;
}

export function buildExistingSizeBuckets(
  rows: Array<{ id: number; path: string; fileSize: number }>,
): ExistingSizeBuckets {
  const buckets: ExistingSizeBuckets = new Map();
  for (const row of rows) {
    const bucket = buckets.get(row.fileSize) ?? [];
    bucket.push({
      imageId: row.id,
      path: row.path,
      fileName: path.basename(row.path),
    });
    buckets.set(row.fileSize, bucket);
  }
  return buckets;
}

/** Sizes where a collision is possible at all — the only ones worth hashing. */
export function collectCandidateSizes(
  incomingSizeBuckets: IncomingSizeBuckets,
  existingSizeBuckets: ExistingSizeBuckets,
): number[] {
  const sizes: number[] = [];
  for (const [size, incomingEntries] of incomingSizeBuckets.entries()) {
    const existingEntries = existingSizeBuckets.get(size) ?? [];
    if (incomingEntries.length > 1 || existingEntries.length > 0) {
      sizes.push(size);
    }
  }
  return sizes;
}

export function countEntriesForSizes<T>(
  buckets: Map<number, T[]>,
  sizes: number[],
): number {
  return sizes.reduce((sum, size) => sum + (buckets.get(size)?.length ?? 0), 0);
}

export async function buildSignatureBuckets<T extends { path: string }>(
  sizeBuckets: Map<number, T[]>,
  candidateSizes: number[],
  hashFile: HashFile,
  signal?: CancelToken,
  onItemDone?: () => void,
): Promise<Map<string, T[]>> {
  const buckets = new Map<string, T[]>();
  const targets = candidateSizes.flatMap((size) =>
    (sizeBuckets.get(size) ?? []).map((entry) => ({ size, entry })),
  );
  await withConcurrency(
    targets,
    HASH_SCAN_CONCURRENCY,
    async ({ size, entry }) => {
      const hash = await hashFile(entry.path);
      onItemDone?.();
      if (!hash) return;
      const signature = `${size}:${hash}`;
      const bucket = buckets.get(signature) ?? [];
      bucket.push(entry);
      buckets.set(signature, bucket);
    },
    signal,
  );
  return buckets;
}

// ── Grouping ───────────────────────────────────────────────────

/**
 * `incomingPathSet` answers "is this existing row the very same file I just
 * walked?", so it must hold `normalizePathKey` keys — an exact compare would
 * report a file reached under different casing as a duplicate of itself, and
 * resolving that group unlinks the one physical file.
 */
export function buildDuplicateGroupsFromBuckets(
  incomingBuckets: Map<string, FolderDuplicateIncomingEntry[]>,
  existingBuckets: Map<string, FolderDuplicateExistingEntry[]>,
  incomingPathSet: Set<string>,
): FolderDuplicateGroup[] {
  const groups: FolderDuplicateGroup[] = [];
  for (const [signature, incomingEntries] of incomingBuckets.entries()) {
    const existingEntries = (existingBuckets.get(signature) ?? []).filter(
      (entry) => !incomingPathSet.has(normalizePathKey(entry.path)),
    );
    const hasCrossDuplicate =
      existingEntries.length > 0 && incomingEntries.length > 0;
    const hasIncomingOnlyDuplicate = incomingEntries.length > 1;
    if (!hasCrossDuplicate && !hasIncomingOnlyDuplicate) continue;

    const hash = signature.split(":")[1] ?? signature;
    const previewEntry = existingEntries[0] ?? incomingEntries[0];
    if (!previewEntry) continue;

    groups.push({
      id: signature,
      hash,
      previewPath: previewEntry.path,
      previewFileName: previewEntry.fileName,
      existingEntries,
      incomingEntries,
    });
  }
  return groups;
}
