import { parsePromptTokens } from "../lib/token";
import { withConcurrency } from "../lib/scanner";
import type { CancelToken } from "../lib/scanner";
import type {
  ImageEntity,
  ImageMetadataUpdateEntry,
  SearchStatMutation,
} from "../types/repository";
import type { ImageRepo } from "../lib/repositories/prisma-image-repo";
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
  readMeta?: (filePath: string) => Promise<ImageMeta | null>;
  searchStats?: SearchStatsAdapter;
};

// ── Helper ─────────────────────────────────────────────────────

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
  const { imageRepo, searchStats } = deps;
  const readMeta = deps.readMeta ?? (async () => null);

  return {
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
