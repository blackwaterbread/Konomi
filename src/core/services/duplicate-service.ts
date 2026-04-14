import fs from "fs";
import path from "path";
import { scanImageFiles, withConcurrency } from "../lib/scanner";
import type { CancelToken } from "../lib/scanner";
import type { SearchStatMutation } from "../types/repository";
import type { ImageRepo } from "../lib/repositories/prisma-image-repo";

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

// ── Adapter interfaces ─────────────────────────────────────────

export interface IgnoredDuplicateAdapter {
  ensureLoaded(): Promise<void>;
  isIgnored(filePath: string): Promise<boolean>;
  register(paths: string[]): Promise<void>;
  forget(filePath: string): Promise<void>;
  list(): Promise<string[]>;
  clear(): Promise<number>;
}

export interface SearchStatsAdapter {
  applyMutations(
    mutations: SearchStatMutation[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<void>;
}

export interface SimilarityCacheAdapter {
  deleteForImageIds(ids: number[]): Promise<void>;
}

// ── Deps ───────────────────────────────────────────────────────

export type DuplicateServiceDeps = {
  imageRepo: ImageRepo;
  hashFile: (filePath: string) => Promise<string | null>;
  ignoredDuplicates: IgnoredDuplicateAdapter;
  searchStats?: SearchStatsAdapter;
  similarityCache?: SimilarityCacheAdapter;
};

// ── Pure helpers ───────────────────────────────────────────────

async function fileSize(filePath: string): Promise<number | null> {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

async function buildIncomingSizeBuckets(
  incomingPaths: string[],
  signal?: CancelToken,
): Promise<Map<number, FolderDuplicateIncomingEntry[]>> {
  const buckets = new Map<number, FolderDuplicateIncomingEntry[]>();
  await withConcurrency(
    incomingPaths,
    SIZE_SCAN_CONCURRENCY,
    async (incomingPath) => {
      const size = await fileSize(incomingPath);
      if (size === null) return;
      const bucket = buckets.get(size) ?? [];
      bucket.push({
        path: incomingPath,
        fileName: path.basename(incomingPath),
      });
      buckets.set(size, bucket);
    },
    signal,
  );
  return buckets;
}

function collectCandidateSizes(
  incomingSizeBuckets: Map<number, FolderDuplicateIncomingEntry[]>,
  existingSizeBuckets: Map<number, FolderDuplicateExistingEntry[]>,
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

async function buildSignatureBuckets<T>(
  sizeBuckets: Map<number, T[]>,
  candidateSizes: number[],
  getPath: (entry: T) => string,
  hashFile: (filePath: string) => Promise<string | null>,
  signal?: CancelToken,
): Promise<Map<string, T[]>> {
  const buckets = new Map<string, T[]>();
  const targets = candidateSizes.flatMap((size) =>
    (sizeBuckets.get(size) ?? []).map((entry) => ({ size, entry })),
  );
  await withConcurrency(
    targets,
    HASH_SCAN_CONCURRENCY,
    async ({ size, entry }) => {
      const hash = await hashFile(getPath(entry));
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

function buildDuplicateGroupsFromBuckets(
  incomingBuckets: Map<string, FolderDuplicateIncomingEntry[]>,
  existingBuckets: Map<string, FolderDuplicateExistingEntry[]>,
  incomingPathSet: Set<string>,
): FolderDuplicateGroup[] {
  const groups: FolderDuplicateGroup[] = [];
  for (const [signature, incomingEntries] of incomingBuckets.entries()) {
    const existingEntries = (existingBuckets.get(signature) ?? []).filter(
      (entry) => !incomingPathSet.has(entry.path),
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

// ── Factory ────────────────────────────────────────────────────

export function createDuplicateService(deps: DuplicateServiceDeps) {
  const { imageRepo, hashFile, ignoredDuplicates, searchStats, similarityCache } = deps;

  return {
    // ── Ignored duplicates ─────────────────────────────────

    ensureIgnoredLoaded(): Promise<void> {
      return ignoredDuplicates.ensureLoaded();
    },

    isIgnored(filePath: string): Promise<boolean> {
      return ignoredDuplicates.isIgnored(filePath);
    },

    listIgnored(): Promise<string[]> {
      return ignoredDuplicates.list();
    },

    clearIgnored(): Promise<number> {
      return ignoredDuplicates.clear();
    },

    // ── Detection ──────────────────────────────────────────

    async findDuplicates(
      folderPath: string,
      options?: { incomingPaths?: string[]; signal?: CancelToken },
    ): Promise<FolderDuplicateGroup[]> {
      await ignoredDuplicates.ensureLoaded();
      const rawPaths =
        options?.incomingPaths ??
        (await scanImageFiles(folderPath, options?.signal));
      const incomingPaths: string[] = [];
      for (const p of rawPaths) {
        if (!(await ignoredDuplicates.isIgnored(p))) incomingPaths.push(p);
      }
      if (incomingPaths.length === 0) return [];

      const incomingPathSet = new Set(incomingPaths);
      const incomingSizeBuckets = await buildIncomingSizeBuckets(
        incomingPaths,
        options?.signal,
      );

      // Query existing images matching candidate file sizes
      const incomingFileSizes = [...incomingSizeBuckets.keys()];
      const existingRows = await imageRepo.findByFileSize(incomingFileSizes);
      const existingSizeBuckets = new Map<number, FolderDuplicateExistingEntry[]>();
      for (const row of existingRows) {
        const bucket = existingSizeBuckets.get(row.fileSize) ?? [];
        bucket.push({
          imageId: row.id,
          path: row.path,
          fileName: path.basename(row.path),
        });
        existingSizeBuckets.set(row.fileSize, bucket);
      }

      const candidateSizes = collectCandidateSizes(
        incomingSizeBuckets,
        existingSizeBuckets,
      );
      if (candidateSizes.length === 0) return [];

      const existingSignatureBuckets = await buildSignatureBuckets(
        existingSizeBuckets,
        candidateSizes,
        (e) => e.path,
        hashFile,
        options?.signal,
      );
      const incomingSignatureBuckets = await buildSignatureBuckets(
        incomingSizeBuckets,
        candidateSizes,
        (e) => e.path,
        hashFile,
        options?.signal,
      );

      return buildDuplicateGroupsFromBuckets(
        incomingSignatureBuckets,
        existingSignatureBuckets,
        incomingPathSet,
      );
    },

    async findDuplicateForIncomingPath(
      incomingPath: string,
    ): Promise<FolderDuplicateGroup | null> {
      await ignoredDuplicates.ensureLoaded();
      if (await ignoredDuplicates.isIgnored(incomingPath)) return null;

      const incomingSize = await fileSize(incomingPath);
      if (incomingSize === null) return null;

      const candidates = await imageRepo.findByFileSizeExcludingPath(
        incomingSize,
        incomingPath,
      );
      if (candidates.length === 0) return null;

      const incomingHash = await hashFile(incomingPath);
      if (!incomingHash) return null;

      const existingEntries: FolderDuplicateExistingEntry[] = [];
      await withConcurrency(candidates, HASH_SCAN_CONCURRENCY, async (row) => {
        const hash = await hashFile(row.path);
        if (hash !== incomingHash) return;
        existingEntries.push({
          imageId: row.id,
          path: row.path,
          fileName: path.basename(row.path),
        });
      });

      if (existingEntries.length === 0) return null;

      return {
        id: `${incomingSize}:${incomingHash}`,
        hash: incomingHash,
        previewPath: existingEntries[0].path,
        previewFileName: existingEntries[0].fileName,
        existingEntries,
        incomingEntries: [
          { path: incomingPath, fileName: path.basename(incomingPath) },
        ],
      };
    },

    // ── Resolution ─────────────────────────────────────────

    async resolve(
      resolutions: FolderDuplicateGroupResolution[],
      onSearchStatsProgress?: (done: number, total: number) => void,
    ): Promise<{
      removedImageIds: number[];
      retainedIncomingPaths: string[];
      touchedIncomingPaths: string[];
    }> {
      const incomingToDelete = new Set<string>();
      const existingToDelete = new Map<number, string>();
      const removedImageIds: number[] = [];
      const retainedIncomingPaths = new Set<string>();
      const touchedIncomingPaths = new Set<string>();
      const ignoredIncomingPaths = new Set<string>();

      for (const resolution of resolutions) {
        const incomingPaths = Array.from(new Set(resolution.incomingPaths));
        for (const p of incomingPaths) touchedIncomingPaths.add(p);

        if (resolution.keep === "ignore") {
          for (const p of incomingPaths) ignoredIncomingPaths.add(p);
          continue;
        }

        for (const p of incomingPaths) {
          await ignoredDuplicates.forget(p);
        }

        if (resolution.keep === "incoming" && incomingPaths.length > 0) {
          for (const entry of resolution.existingEntries) {
            existingToDelete.set(entry.imageId, entry.path);
          }
          const keepPath = [...incomingPaths].sort((a, b) =>
            a.localeCompare(b),
          )[0];
          retainedIncomingPaths.add(keepPath);
          for (const p of incomingPaths) {
            if (p !== keepPath) incomingToDelete.add(p);
          }
          continue;
        }

        for (const p of incomingPaths) incomingToDelete.add(p);
      }

      // Delete incoming files
      for (const p of incomingToDelete) {
        try {
          await fs.promises.unlink(p);
        } catch (e: unknown) {
          const err = e as NodeJS.ErrnoException;
          if (err.code !== "ENOENT") throw e;
        }
      }

      // Get search stats before deleting existing
      const existingToDeleteIds = Array.from(existingToDelete.keys());
      const deletedStatRows = await imageRepo.findSearchStatSourcesByIds(
        existingToDeleteIds,
      );

      // Delete existing files and DB rows
      for (const [imageId, existingPath] of existingToDelete.entries()) {
        try {
          await fs.promises.unlink(existingPath);
        } catch (e: unknown) {
          const err = e as NodeJS.ErrnoException;
          if (err.code !== "ENOENT") throw e;
        }
        const deleted = await imageRepo.deleteById(imageId);
        if (deleted) removedImageIds.push(imageId);
      }

      // Post-delete cleanup
      await ignoredDuplicates.register(Array.from(ignoredIncomingPaths));
      if (searchStats && deletedStatRows.length > 0) {
        await searchStats.applyMutations(
          deletedStatRows.map((row) => ({ before: row, after: null })),
          onSearchStatsProgress,
        );
      }
      if (similarityCache && removedImageIds.length > 0) {
        await similarityCache.deleteForImageIds(removedImageIds);
      }

      return {
        removedImageIds,
        retainedIncomingPaths: Array.from(retainedIncomingPaths),
        touchedIncomingPaths: Array.from(touchedIncomingPaths),
      };
    },
  };
}

export type DuplicateService = ReturnType<typeof createDuplicateService>;
