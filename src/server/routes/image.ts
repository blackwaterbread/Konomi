import fs from "fs";
import type { FastifyInstance } from "fastify";
import type { Services } from "../services";
import type { ImageListQuery } from "@core/types/image-query";
import {
  getImageSearchPresetStats,
  suggestImageSearchTags,
} from "@core/lib/search-stats-store";
import {
  getSimilarGroups,
  getGroupForImage,
  getSimilarityReasons,
  resetAllHashes,
  deleteSimilarityCacheForImageIds,
} from "@core/lib/phash";
import { decrementImageSearchStatsForRows } from "@core/lib/search-stats-store";
import type { SearchStatSource } from "@core/types/repository";

export function registerImageRoutes(app: FastifyInstance, services: Services) {
  const {
    imageService,
    scanService,
    maintenanceService,
    scanState,
    setScanActive,
    sender,
  } = services;

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
      subPaths?: string[];
    };
  }>("/api/images/scan", async (req) => {
    const {
      detectDuplicates = false,
      folderIds,
      orderedFolderIds,
      skipFolderIds,
      subPaths,
    } = req.body ?? {};

    // Single-flight: the initial scan, data-root-watcher, and any client may
    // all try to scan. Only one runs at a time. A client whose request is
    // rejected here still gets the running scan's `image:scanComplete` /
    // `image:scanActive {active:false}` and resolves against it.
    //
    // For a subfolder-scoped request that resolution is a lie: the running
    // scan is walking some other target, so the requested subtree is never
    // touched, yet the client resolves clean and reports a successful rescan.
    // Report the drop so the user sees why nothing changed — but in the
    // response, not on the WebSocket. `image:scanSkipped` is broadcast to
    // every connected client, and this rejection is scoped to one request:
    // other sessions would be warned about a rescan they never asked for. The
    // caller replays it onto its own listeners.
    if (scanState.active) {
      return {
        started: false,
        alreadyRunning: true,
        skippedSubPaths: subPaths && subPaths.length > 0 ? subPaths : undefined,
      };
    }

    const cancelToken = { cancelled: false };
    scanState.cancelToken = cancelToken;
    setScanActive(true);

    // Fire-and-forget: run the scan in the background and return immediately
    // so the HTTP connection is released right away. Long scans on large /
    // NAS libraries would otherwise blow past reverse-proxy read timeouts and
    // surface as a spurious client error even though the scan keeps running.
    // Progress + completion are delivered over the WebSocket instead.
    scanState.inFlight = (async () => {
      try {
        await scanService.scanAll({
          signal: cancelToken,
          folderIds,
          orderedFolderIds,
          skipFolderIds,
          subPaths,
          detectDuplicates,
          onDuplicateGroup: detectDuplicates
            ? (group) => sender.send("image:watchDuplicate", group)
            : undefined,
          onDupCheckProgress: (done, total) => sender.send("image:dupCheckProgress", { done, total }),
          onSearchStatsProgress: emitSearchStatsProgress,
          onPhase: (phase) => sender.send("image:scanPhase", { phase }),
        });
        if (!cancelToken.cancelled) {
          maintenanceService.scheduleAnalysis(0);
        }
        sender.send("image:scanComplete", { cancelled: cancelToken.cancelled });
      } catch (err) {
        sender.send("image:scanComplete", {
          cancelled: cancelToken.cancelled,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        scanState.cancelToken = null;
        scanState.inFlight = null;
        setScanActive(false);
      }
    })();

    return { started: true };
  });

  app.post("/api/images/scan/cancel", async () => {
    if (scanState.cancelToken) scanState.cancelToken.cancelled = true;
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
  app.post<{ Body: { path: string } }>("/api/images/delete", async (req) => {
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
  });

  app.post<{ Body: { ids: number[] } }>("/api/images/bulk-delete", async (req) => {
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
    // Manual trigger: routes call into maintenance service so the request
    // dedupes against any in-flight (auto-scheduled) run.
    const result = await maintenanceService.runAnalysisNow();
    return result.hashed;
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
    const result = await resetAllHashes();
    maintenanceService.scheduleAnalysis(0);
    return result;
  });

  // ── Rescan metadata ──────────────────────
  // Re-reads every image file's metadata — the one long-running foreground
  // job with no background path of its own (unlike hashing/similarity, which
  // maintenanceService already runs in the background). Make it
  // fire-and-forget like scan so a multi-minute rescan doesn't hit a
  // reverse-proxy read timeout; the count is delivered over the WebSocket via
  // `image:rescanMetadataComplete`.
  let rescanInFlight: Promise<void> | null = null;
  // Restore the shutdown safety the old blocking request got from app.close()
  // waiting on in-flight requests: await any running rescan during teardown so
  // worker pools aren't terminated mid-read.
  app.addHook("onClose", async () => {
    await rescanInFlight?.catch(() => {});
  });

  app.post("/api/images/rescan-metadata", async () => {
    if (rescanInFlight) return { started: false, alreadyRunning: true };
    rescanInFlight = (async () => {
      let count = 0;
      try {
        count = await imageService.rescanAll(
          (done, total) => sender.send("image:rescanMetadataProgress", { done, total }),
          (images) =>
            sender.send(
              "image:batch",
              images.map((img) => ({ ...img, isNew: false })),
            ),
          emitSearchStatsProgress,
        );
        maintenanceService.scheduleAnalysis(0);
      } finally {
        rescanInFlight = null;
        sender.send("image:rescanMetadataComplete", { count });
      }
    })();
    return { started: true };
  });

  app.post<{ Body: { paths: string[] } }>("/api/images/rescan-image-metadata", async (req) => {
    const result = await imageService.rescanPaths(req.body.paths, (images) =>
      sender.send(
        "image:batch",
        images.map((img) => ({ ...img, isNew: false })),
      ),
    );
    // Token text changed → similarity cache for these images is stale.
    maintenanceService.scheduleAnalysis(0);
    return result;
  });
}
