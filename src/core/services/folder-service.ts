import fs from "fs/promises";
import path from "path";
import { normalizePathKey } from "../lib/path-key";
import type {
  FolderEntity,
  SearchStatSource,
} from "../types/repository";
import type { FolderRepo } from "../lib/repositories/prisma-folder-repo";
import type { ImageRepo } from "../lib/repositories/prisma-image-repo";

export type FolderServiceDeps = {
  folderRepo: FolderRepo;
  imageRepo: ImageRepo;
  /**
   * Optional cleanup hooks for tables without a foreign-key path back to
   * Folder (ImageSimilarityCache, ImageSearchStat). Call sites that wire
   * these in get cleanup-on-delete for free; sites that don't will leave
   * stale rows behind. The Electron utility process and Fastify server both
   * wire these in.
   */
  similarityCache?: {
    deleteForImageIds(imageIds: number[]): Promise<void>;
  };
  searchStats?: {
    listSourcesForFolder(folderId: number): Promise<SearchStatSource[]>;
    decrementForRows(
      rows: SearchStatSource[],
      onProgress?: (done: number, total: number) => void,
    ): Promise<void>;
  };
};

export type FolderStats = {
  path: string;
  imageCount: number;
  createdAt: Date;
};

/**
 * Not `normalizePathKey`, on purpose: this answers "is this folder already
 * registered?" — a uniqueness check where two spellings of one directory must
 * collide even through a symlink, hence `realpath`. File identity inside a
 * folder is a different question with a different fold; see the registry in
 * `lib/path-key.ts`.
 */
async function normalizeFolderPath(folderPath: string): Promise<string> {
  const resolved = path.resolve(folderPath.trim());
  try {
    const realPath = await fs.realpath(resolved);
    const normalized = path.normalize(realPath);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  } catch {
    const normalized = path.normalize(resolved);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  }
}

export function createFolderService(deps: FolderServiceDeps) {
  const { folderRepo, imageRepo, similarityCache, searchStats } = deps;

  return {
    async list(): Promise<FolderEntity[]> {
      return folderRepo.findAll();
    },

    async create(name: string, folderPath: string): Promise<FolderEntity> {
      const normalizedPath = await normalizeFolderPath(folderPath);
      const existing = await folderRepo.findAll();
      // Normalize all existing paths in parallel — the data-root watcher
      // batch-creates folders on volume mount, so an O(n) realpath per call
      // becomes O(n²) over a fresh boot. Promise.all amortizes the syscalls.
      const normalizedExisting = await Promise.all(
        existing.map((folder) => normalizeFolderPath(folder.path)),
      );
      if (normalizedExisting.includes(normalizedPath)) {
        throw new Error("Folder path already registered");
      }
      return folderRepo.create(name, folderPath);
    },

    async delete(
      id: number,
      onSearchStatsProgress?: (done: number, total: number) => void,
    ): Promise<void> {
      // Capture image IDs and stat-source rows BEFORE the cascade delete —
      // once folderRepo.delete fires, the Image rows are gone and the only
      // way to find the orphans in ImageSimilarityCache / ImageSearchStat is
      // by IDs we already collected.
      const [imageIds, statRows] = await Promise.all([
        imageRepo.listIdsByFolderId(id),
        searchStats?.listSourcesForFolder(id) ?? Promise.resolve([]),
      ]);
      await folderRepo.delete(id);
      // ImageSimilarityCache / ImageSearchStat have no FK back to Folder, so
      // cascade doesn't reach them. Clean them up explicitly.
      if (similarityCache && imageIds.length > 0) {
        await similarityCache.deleteForImageIds(imageIds);
      }
      if (searchStats && statRows.length > 0) {
        await searchStats.decrementForRows(statRows, onSearchStatsProgress);
      }
    },

    async rename(id: number, name: string): Promise<FolderEntity> {
      return folderRepo.rename(id, name);
    },

    async getById(id: number): Promise<FolderEntity | null> {
      return folderRepo.findById(id);
    },

    /**
     * Subfolder paths carry the spelling `Image.path` recorded, which is the
     * on-disk casing the scan walked.
     *
     * Case is folded to *group* rows, never to build the result. A folded path
     * is a string that names no directory: every consumer either walks it
     * (`scanService` subPath targets), prefix-matches `Image.path` with it
     * (subfolder filters), or compares it against a scan event — and each one
     * needed its own compensation for a spelling the library invented.
     */
    async getSubfolderPaths(folderId: number): Promise<{ path: string; depth: number }[]> {
      const folder = await folderRepo.findById(folderId);
      if (!folder) return [];

      // Both separators count on win32 only, matching `normalizePathKey`: `\`
      // is an ordinary filename character on POSIX, so treating it as a
      // separator there splits a file named `a\b.png` into a subfolder `a`
      // that does not exist — a phantom row in the sidebar, and a subPath the
      // rescan would then be asked to walk.
      const isWin = process.platform === "win32";
      const sep = isWin ? "\\" : "/";
      const segmentSep = isWin ? /[\\/]/ : /\//;
      const root = folder.path.replace(isWin ? /[\\/]+$/ : /\/+$/, "");
      // Measured on the slash-folded form minus the case fold: `toLowerCase`
      // can change a string's length (U+0130 lower-cases to two code units),
      // and an index taken from the folded key would slice into the first
      // segment. Slash replacement is length-preserving, so the index is valid
      // on the original string too.
      const prefixLen = root.replace(/\\/g, "/").length + 1;
      const rootKey = normalizePathKey(root);

      const images = await imageRepo.getPathsByFolderId(folderId);
      // Keyed by `normalizePathKey` so rows spelling one directory differently
      // — a case-only rename on win32 is enough — collapse to a single entry.
      const subfolderMap = new Map<string, { path: string; depth: number }>();
      for (const img of images) {
        if (!normalizePathKey(img.path).startsWith(rootKey + "/")) continue;
        const parts = img.path.slice(prefixLen).split(segmentSep);
        for (let i = 1; i < parts.length; i++) {
          const subPath = root + sep + parts.slice(0, i).join(sep);
          const key = normalizePathKey(subPath);
          if (!subfolderMap.has(key)) {
            subfolderMap.set(key, { path: subPath, depth: i });
          }
        }
      }

      return [...subfolderMap.values()].sort((a, b) =>
        a.path.localeCompare(b.path),
      );
    },

    async getStats(id: number): Promise<FolderStats | null> {
      const folder = await folderRepo.findById(id);
      if (!folder) return null;

      return {
        path: folder.path,
        imageCount: await imageRepo.countByFolderId(id),
        createdAt: folder.createdAt,
      };
    },

    async getSize(id: number): Promise<number> {
      return imageRepo.sumFileSizeByFolderId(id);
    },
  };
}

export type FolderService = ReturnType<typeof createFolderService>;
