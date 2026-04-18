import fs from "fs";
import type { FastifyInstance } from "fastify";
import type { Services } from "../services";
import type { ImageListQuery } from "@core/types/image-query";
import type { CancelToken } from "@core/lib/scanner";
import {
  getImageSearchPresetStats,
  suggestImageSearchTags,
} from "@core/lib/search-stats-store";
import {
  computeAllHashes,
  getSimilarGroups,
  getGroupForImage,
  getSimilarityReasons,
  resetAllHashes,
  deleteSimilarityCacheForImageIds,
} from "@core/lib/phash";
import { decrementImageSearchStatsForRows } from "@core/lib/search-stats-store";
import type { SearchStatSource } from "@core/types/repository";

let scanCancelToken: CancelToken | null = null;
let computeHashesInFlight: Promise<number> | null = null;

export function registerImageRoutes(app: FastifyInstance, services: Services) {
  const { imageService, scanService, watchService, sender } = services;

  const emitSearchStatsProgress = (done: number, total: number) => {
    sender.send("image:searchStatsProgress", { done, total });
  };

  // ── Listing ──────────────────────────────
  app.post<{ Body: ImageListQuery }>("/api/images/page", async (req) => {
    return imageService.listPage(req.body ?? {});
  });

  app.post<{ Body: ImageListQuery }>("/api/images/matching-ids", async (req) => {
    return imageService.listMatchingIds(req.body ?? {});
  });

  app.post<{ Body: { ids: number[] } }>("/api/images/by-ids", async (req) => {
    return imageService.listByIds(req.body.ids);
  });

  // ── Search ───────────────────────────────
  app.get("/api/images/search-preset-stats", async () => {
    return getImageSearchPresetStats(emitSearchStatsProgress);
  });

  app.post<{ Body: { prefix: string; limit?: number; exclude?: string[] } }>(
    "/api/images/suggest-tags",
    async (req) => {
      return suggestImageSearchTags(req.body);
    },
  );

  // ── Scan ─────────────────────────────────
  app.post<{
    Body: {
      detectDuplicates?: boolean;
      folderIds?: number[];
      orderedFolderIds?: number[];
      skipFolderIds?: number[];
    };
  }>("/api/images/scan", async (req) => {
    const { detectDuplicates = false, folderIds, orderedFolderIds, skipFolderIds } = req.body ?? {};
    scanCancelToken = { cancelled: false };
    watchService.setScanActive(true);
    try {
      return scanService.scanAll({
        signal: scanCancelToken,
        folderIds,
        orderedFolderIds,
        skipFolderIds,
        detectDuplicates,
        onDuplicateGroup: detectDuplicates
          ? (group) => sender.send("image:watchDuplicate", group)
          : undefined,
        onDupCheckProgress: (done, total) => sender.send("image:dupCheckProgress", { done, total }),
        onSearchStatsProgress: emitSearchStatsProgress,
        onPhase: (phase) => sender.send("image:scanPhase", { phase }),
      });
    } finally {
      scanCancelToken = null;
      watchService.setScanActive(false, { discardDeferredChanges: true });
    }
  });

  app.post("/api/images/scan/cancel", async () => {
    if (scanCancelToken) scanCancelToken.cancelled = true;
    return null;
  });

  app.post("/api/images/quick-verify", async () => {
    return scanService.quickVerify(undefined, (done, total) => {
      sender.send("image:quickVerifyProgress", { done, total });
    });
  });

  // ── Favorites ────────────────────────────
  app.post<{ Body: { id: number; isFavorite: boolean } }>("/api/images/favorite", async (req) => {
    await services.imageRepo.setFavorite(req.body.id, req.body.isFavorite);
    return null;
  });

  // ── Delete ───────────────────────────────
  // fs.watch on Linux / network volumes can miss deletion events, so explicitly
  // remove the DB row, similarity cache, and search stats here instead of
  // relying on the watcher. setScanActive pauses the watcher during the delete
  // so the (possibly delayed) file-gone event doesn't double-decrement stats.
  app.post<{ Body: { path: string } }>("/api/images/delete", async (req) => {
    watchService.setScanActive(true);
    try {
      const existing = await services.imageRepo.findByPath(req.body.path);
      await fs.promises.unlink(req.body.path).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT") throw err;
      });
      if (existing) {
        await services.imageRepo.deleteByIds([existing.id]);
        await deleteSimilarityCacheForImageIds([existing.id]);
        await decrementImageSearchStatsForRows(
          [existing as SearchStatSource],
          emitSearchStatsProgress,
        );
        sender.send("image:removed", [existing.id]);
      }
      return { deletedFromDb: existing !== null };
    } finally {
      watchService.setScanActive(false, { discardDeferredChanges: true });
    }
  });

  app.post<{ Body: { ids: number[] } }>("/api/images/bulk-delete", async (req) => {
    watchService.setScanActive(true);
    try {
      const rows = await services.imageRepo.listByIds(req.body.ids);
      let deleted = 0;
      let failed = 0;
      const deletedRows: typeof rows = [];
      for (const row of rows) {
        try {
          await fs.promises.unlink(row.path).catch((err: NodeJS.ErrnoException) => {
            if (err.code !== "ENOENT") throw err;
          });
          deletedRows.push(row);
          deleted++;
        } catch {
          failed++;
        }
      }
      let deletedFromDb = 0;
      if (deletedRows.length > 0) {
        const deletedIds = deletedRows.map((r) => r.id);
        await services.imageRepo.deleteByIds(deletedIds);
        await deleteSimilarityCacheForImageIds(deletedIds);
        await decrementImageSearchStatsForRows(
          deletedRows as SearchStatSource[],
          emitSearchStatsProgress,
        );
        sender.send("image:removed", deletedIds);
        deletedFromDb = deletedIds.length;
      }
      return { deleted, failed, deletedFromDb };
    } finally {
      watchService.setScanActive(false, { discardDeferredChanges: true });
    }
  });

  // ── Ignored duplicates ───────────────────
  app.get("/api/images/ignored-duplicates", async () => {
    return services.duplicateService.listIgnored();
  });

  app.delete("/api/images/ignored-duplicates", async () => {
    return services.duplicateService.clearIgnored();
  });

  // ── Hashing / Similarity ─────────────────
  app.post("/api/images/compute-hashes", async () => {
    if (computeHashesInFlight) return computeHashesInFlight;
    computeHashesInFlight = computeAllHashes(
      (done, total) => sender.send("image:hashProgress", { done, total }),
      (done, total) => sender.send("image:similarityProgress", { done, total }),
    ).finally(() => {
      computeHashesInFlight = null;
    });
    return computeHashesInFlight;
  });

  app.post<{ Body: { threshold: number; jaccardThreshold?: number } }>(
    "/api/images/similar-groups",
    async (req) => {
      return getSimilarGroups(req.body.threshold, req.body.jaccardThreshold, (done, total) =>
        sender.send("image:similarityProgress", { done, total }),
      );
    },
  );

  app.get<{ Params: { id: string } }>("/api/images/:id/similar-group", async (req) => {
    return getGroupForImage(Number(req.params.id));
  });

  app.post<{
    Body: { imageId: number; candidateImageIds: number[]; threshold: number; jaccardThreshold?: number };
  }>("/api/images/similar-reasons", async (req) => {
    return getSimilarityReasons(
      req.body.imageId,
      req.body.candidateImageIds,
      req.body.threshold,
      req.body.jaccardThreshold,
    );
  });

  app.post("/api/images/reset-hashes", async () => {
    return resetAllHashes();
  });

  // ── Rescan metadata ──────────────────────
  app.post("/api/images/rescan-metadata", async () => {
    return imageService.rescanAll(
      (done, total) => sender.send("image:rescanMetadataProgress", { done, total }),
      (images) => sender.send("image:batch", images),
      emitSearchStatsProgress,
    );
  });

  app.post<{ Body: { paths: string[] } }>("/api/images/rescan-image-metadata", async (req) => {
    return imageService.rescanPaths(req.body.paths, (images) =>
      sender.send("image:batch", images),
    );
  });
}
