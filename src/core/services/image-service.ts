import fs from "fs";
import path from "path";
import { parsePromptTokens } from "../lib/token";
import { normalizePathKey } from "../lib/path-key";
import { withConcurrency } from "../lib/scanner";
import type { CancelToken } from "../lib/scanner";
import type {
  ImageEntity,
  ImageMetadataUpdateEntry,
  ImageUpsertData,
  SearchStatMutation,
  SearchStatSource,
} from "../types/repository";
import type { ImageRepo } from "../lib/repositories/prisma-image-repo";
import type { FolderRepo } from "../lib/repositories/prisma-folder-repo";
import type { ImageMeta } from "../types/image-meta";
import type {
  ImageListQuery,
  ImageListResult,
} from "../types/image-query";

const BATCH_SIZE = 20;
const RESCAN_CONCURRENCY = 24;

// ── Adapter interfaces ─────────────────────────────────────────

export interface SearchStatsAdapter {
  applyMutations(
    mutations: SearchStatMutation[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<void>;
}

// ── Deps ───────────────────────────────────────────────────────

export type ImageServiceDeps = {
  imageRepo: ImageRepo;
  folderRepo?: FolderRepo;
  readMeta?: (filePath: string) => Promise<ImageMeta | null>;
  searchStats?: SearchStatsAdapter;
};

// ── Helper ─────────────────────────────────────────────────────

function buildUpsertData(
  filePath: string,
  folderId: number,
  stat: fs.Stats,
  meta: ImageMeta | null,
): ImageUpsertData {
  return {
    path: filePath,
    folderId,
    prompt: meta?.prompt ?? "",
    negativePrompt: meta?.negativePrompt ?? "",
    characterPrompts: JSON.stringify(meta?.characterPrompts ?? []),
    promptTokens: JSON.stringify(parsePromptTokens(meta?.prompt ?? "")),
    negativePromptTokens: JSON.stringify(
      parsePromptTokens(meta?.negativePrompt ?? ""),
    ),
    characterPromptTokens: JSON.stringify(
      (meta?.characterPrompts ?? []).flatMap(parsePromptTokens),
    ),
    source: meta?.source ?? "unknown",
    model: meta?.model ?? "",
    seed: meta?.seed || "",
    width: meta?.width ?? 0,
    height: meta?.height ?? 0,
    sampler: meta?.sampler ?? "",
    steps: meta?.steps ?? 0,
    cfgScale: meta?.cfgScale ?? 0,
    cfgRescale: meta?.cfgRescale ?? 0,
    noiseSchedule: meta?.noiseSchedule ?? "",
    varietyPlus: meta?.varietyPlus ?? false,
    fileSize: stat.size,
    fileModifiedAt: stat.mtime,
  };
}

/**
 * Same question `scan-service.isPathUnder` answers, so it must fold paths the
 * same way — `registerExternalPath` picks the owning folder with this while the
 * scan prunes that folder's rows with the other, and a disagreement would file
 * an image under a root the next scan does not walk.
 *
 * `path.resolve` runs first because a generated file's path can arrive relative
 * or with `..` segments; the folder root always comes from the DB.
 * Unlike the scan's copy a file is never "under" a root it equals.
 */
function isPathUnder(filePath: string, folderPath: string): boolean {
  const file = normalizePathKey(path.resolve(filePath));
  const folder = normalizePathKey(path.resolve(folderPath));
  if (file === folder) return false;
  return file.startsWith(folder + "/");
}

/**
 * The folder a file belongs to: the *innermost* registered root containing it,
 * matching how `scan-service.resolveScanTargets` assigns a subtree.
 *
 * A folder can be registered inside another one, and then a generated file sits
 * under both. Taking the first match instead would file it under whichever root
 * the repo happened to return first, and the next scan of the inner folder —
 * which is what the sidebar shows the file under — would prune the row as a
 * path it did not walk.
 */
function findOwningFolder<T extends { path: string }>(
  filePath: string,
  folders: T[],
): T | null {
  let owner: T | null = null;
  let ownerDepth = -1;
  for (const folder of folders) {
    if (!isPathUnder(filePath, folder.path)) continue;
    const depth = normalizePathKey(path.resolve(folder.path)).length;
    if (depth > ownerDepth) {
      owner = folder;
      ownerDepth = depth;
    }
  }
  return owner;
}

function buildMetadataEntry(
  filePath: string,
  meta: ImageMeta,
): ImageMetadataUpdateEntry {
  return {
    path: filePath,
    prompt: meta.prompt ?? "",
    negativePrompt: meta.negativePrompt ?? "",
    characterPrompts: JSON.stringify(meta.characterPrompts ?? []),
    promptTokens: JSON.stringify(parsePromptTokens(meta.prompt ?? "")),
    negativePromptTokens: JSON.stringify(
      parsePromptTokens(meta.negativePrompt ?? ""),
    ),
    characterPromptTokens: JSON.stringify(
      (meta.characterPrompts ?? []).flatMap(parsePromptTokens),
    ),
    source: meta.source,
    model: meta.model ?? "",
    seed: meta.seed || "",
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    sampler: meta.sampler ?? "",
    steps: meta.steps ?? 0,
    cfgScale: meta.cfgScale ?? 0,
    cfgRescale: meta.cfgRescale ?? 0,
    noiseSchedule: meta.noiseSchedule ?? "",
    varietyPlus: meta.varietyPlus ?? false,
  };
}

// ── Factory ────────────────────────────────────────────────────

export function createImageService(deps: ImageServiceDeps) {
  const { imageRepo, folderRepo, searchStats } = deps;
  const readMeta = deps.readMeta ?? (async () => null);

  return {
    // ── External path registration ────────────────────────
    //
    // Used to register a file produced by an in-app operation (e.g. NAI
    // generation) into the gallery without relying on a filesystem watcher.
    // Resolves the file's folder from the registered folder roots; returns
    // null if the path is outside every root or the file is missing.
    // Idempotent — re-registering with an unchanged mtime is a no-op.
    async registerExternalPath(filePath: string): Promise<ImageEntity | null> {
      if (!folderRepo) return null;
      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(filePath);
      } catch {
        return null;
      }
      if (!stat.isFile()) return null;

      const folders = await folderRepo.findAll();
      const matched = findOwningFolder(filePath, folders);
      if (!matched) return null;

      const existing = await imageRepo.findByPath(filePath);
      if (
        existing &&
        existing.fileModifiedAt.getTime() === stat.mtime.getTime()
      ) {
        return existing;
      }

      const meta = await readMeta(filePath);
      const data = buildUpsertData(filePath, matched.id, stat, meta);
      const image = await imageRepo.upsertByPath(data);

      if (searchStats) {
        await searchStats.applyMutations([
          {
            before: (existing as SearchStatSource | null) ?? null,
            after: image as SearchStatSource,
          },
        ]);
      }

      return image;
    },

    // ── Listing ────────────────────────────────────────────

    async listPage(query?: ImageListQuery): Promise<ImageListResult> {
      return imageRepo.listPage(query ?? {});
    },

    async listMatchingIds(query?: ImageListQuery): Promise<number[]> {
      return imageRepo.listMatchingIds(query ?? {});
    },

    async listByIds(ids: number[]): Promise<ImageEntity[]> {
      return imageRepo.listByIds(ids);
    },

    async listIdsByFolderId(folderId: number): Promise<number[]> {
      return imageRepo.listIdsByFolderId(folderId);
    },

    async setFavorite(id: number, isFavorite: boolean): Promise<void> {
      return imageRepo.setFavorite(id, isFavorite);
    },

    // ── Rescan ─────────────────────────────────────────────

    async rescanAll(
      onProgress?: (done: number, total: number) => void,
      onBatch?: (images: ImageEntity[]) => void,
      onSearchStatsProgress?: (done: number, total: number) => void,
      signal?: CancelToken,
    ): Promise<number> {
      const rows = await imageRepo.findAllIdAndPath();
      if (rows.length === 0) return 0;

      const total = rows.length;
      let done = 0;
      let updated = 0;
      let lastProgressAt = 0;

      const pending: ImageMetadataUpdateEntry[] = [];

      const flushBatch = async (): Promise<void> => {
        if (pending.length === 0) return;
        const batch = pending.splice(0);
        const batchPaths = batch.map((r) => r.path);

        // Get before-state for search stats delta
        let beforeMap: Map<string, SearchStatMutation["before"]> | undefined;
        if (searchStats) {
          const beforeRows = await imageRepo.findSearchStatSourcesByPaths(batchPaths);
          beforeMap = new Map(beforeRows.map((r) => [r.path, r]));
        }

        const images = await imageRepo.updateMetadataBatch(batch);

        if (searchStats && beforeMap) {
          await searchStats.applyMutations(
            batch.map((row) => ({
              before: beforeMap!.get(row.path) ?? null,
              after: row,
            })),
            onSearchStatsProgress,
          );
        }

        onBatch?.(images);
        updated += images.length;
      };

      await withConcurrency(
        rows.map((r) => r.path),
        RESCAN_CONCURRENCY,
        async (filePath) => {
          try {
            if (signal?.cancelled) return;
            const meta = await readMeta(filePath);
            if (!meta) return;
            pending.push(buildMetadataEntry(filePath, meta));
            if (pending.length >= BATCH_SIZE) await flushBatch();
          } catch {
            // skip unreadable files
          } finally {
            done++;
            const now = Date.now();
            if (done === total || now - lastProgressAt >= 100) {
              lastProgressAt = now;
              onProgress?.(done, total);
            }
          }
        },
        signal,
      );

      await flushBatch();
      return updated;
    },

    async rescanPaths(
      paths: string[],
      onBatch?: (images: ImageEntity[]) => void,
    ): Promise<number> {
      if (paths.length === 0) return 0;
      let updated = 0;

      for (let i = 0; i < paths.length; i += BATCH_SIZE) {
        const chunk = paths.slice(i, i + BATCH_SIZE);
        const entries: ImageMetadataUpdateEntry[] = [];

        for (const filePath of chunk) {
          try {
            const meta = await readMeta(filePath);
            if (!meta) continue;
            entries.push(buildMetadataEntry(filePath, meta));
          } catch {
            // skip unreadable files
          }
        }

        if (entries.length === 0) continue;

        let beforeMap: Map<string, SearchStatMutation["before"]> | undefined;
        if (searchStats) {
          const batchPaths = entries.map((e) => e.path);
          const beforeRows = await imageRepo.findSearchStatSourcesByPaths(batchPaths);
          beforeMap = new Map(beforeRows.map((r) => [r.path, r]));
        }

        const images = await imageRepo.updateMetadataBatch(entries);

        if (searchStats && beforeMap) {
          await searchStats.applyMutations(
            entries.map((row) => ({
              before: beforeMap!.get(row.path) ?? null,
              after: row,
            })),
          );
        }

        onBatch?.(images);
        updated += images.length;
      }

      return updated;
    },
  };
}

export type ImageService = ReturnType<typeof createImageService>;
