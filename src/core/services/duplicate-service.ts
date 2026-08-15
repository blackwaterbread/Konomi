import fs from "fs";
import { scanImageFiles } from "../lib/scanner";
import { normalizePathKey } from "../lib/path-key";
import {
  buildDuplicateGroupsFromBuckets,
  buildExistingSizeBuckets,
  buildIncomingSizeBuckets,
  buildSignatureBuckets,
  collectCandidateSizes,
} from "../lib/duplicate-detect";
import type { CancelToken } from "../lib/scanner";
import type {
  FolderDuplicateGroup,
  FolderDuplicateGroupResolution,
  HashFile,
} from "../lib/duplicate-detect";
import type { ImageRepo } from "../lib/repositories/prisma-image-repo";
import type {
  IgnoredDuplicateAdapter,
  SearchStatsAdapter,
  SimilarityCacheAdapter,
} from "../types/adapters";

export type {
  FolderDuplicateExistingEntry,
  FolderDuplicateIncomingEntry,
  FolderDuplicateGroup,
  FolderDuplicateGroupResolution,
} from "../lib/duplicate-detect";

// ── Deps ───────────────────────────────────────────────────────

export type DuplicateServiceDeps = {
  imageRepo: ImageRepo;
  hashFile: HashFile;
  ignoredDuplicates: IgnoredDuplicateAdapter;
  searchStats?: SearchStatsAdapter;
  similarityCache?: SimilarityCacheAdapter;
};

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

      const incomingSizeBuckets = await buildIncomingSizeBuckets(
        incomingPaths,
        options?.signal,
      );

      // Query existing images matching candidate file sizes
      const incomingFileSizes = [...incomingSizeBuckets.keys()];
      const existingRows = await imageRepo.findByFileSize(incomingFileSizes);
      const existingSizeBuckets = buildExistingSizeBuckets(existingRows);

      // "Incoming" means a file the library does not hold yet. On a rescan the
      // walk re-reports every indexed file in the tree, and leaving those in
      // makes each one a candidate against its own row — the whole subtree gets
      // hashed twice on every rescan to conclude nothing changed. An indexed
      // file always has a row of its own size, so `existingRows` is enough to
      // recognise them. `scanService`'s pre-scan drops them the same way.
      const indexedKeys = new Set(
        existingRows.map((row) => normalizePathKey(row.path)),
      );
      for (const [size, entries] of [...incomingSizeBuckets.entries()]) {
        const kept = entries.filter(
          (entry) => !indexedKeys.has(normalizePathKey(entry.path)),
        );
        if (kept.length === 0) incomingSizeBuckets.delete(size);
        else if (kept.length !== entries.length) {
          incomingSizeBuckets.set(size, kept);
        }
      }
      if (incomingSizeBuckets.size === 0) return [];

      const incomingPathSet = new Set(
        [...incomingSizeBuckets.values()].flatMap((entries) =>
          entries.map((entry) => normalizePathKey(entry.path)),
        ),
      );

      const candidateSizes = collectCandidateSizes(
        incomingSizeBuckets,
        existingSizeBuckets,
      );
      if (candidateSizes.length === 0) return [];

      const existingSignatureBuckets = await buildSignatureBuckets(
        existingSizeBuckets,
        candidateSizes,
        hashFile,
        options?.signal,
      );
      const incomingSignatureBuckets = await buildSignatureBuckets(
        incomingSizeBuckets,
        candidateSizes,
        hashFile,
        options?.signal,
      );

      return buildDuplicateGroupsFromBuckets(
        incomingSignatureBuckets,
        existingSignatureBuckets,
        incomingPathSet,
      );
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
