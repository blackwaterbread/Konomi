import fs from "fs";
import { walkImageFiles, countImageFiles, withConcurrency } from "../lib/scanner";
import { readImageMeta } from "../lib/image-meta";
import { parsePromptTokens } from "../lib/token";
import { createLogger } from "../lib/logger";
import type { CancelToken } from "../lib/scanner";
import type { ImageRepository, FolderRepository, ImageUpsertData } from "../types/repository";
import type { EventSender } from "../types/event-sender";

const log = createLogger("scan-service");

const BATCH_SIZE = 50;
const SYNC_CONCURRENCY = 4;

export type ScanServiceDeps = {
  imageRepo: ImageRepository;
  folderRepo: FolderRepository;
  sender: EventSender;
  /** Optional: custom metadata reader (e.g. with native addon support) */
  readMeta?: (filePath: string) => ReturnType<typeof readImageMeta>;
};

export type ScanOptions = {
  signal?: CancelToken;
  folderIds?: number[];
};

function buildUpsertData(
  filePath: string,
  folderId: number,
  stat: fs.Stats,
  meta: ReturnType<typeof readImageMeta>,
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
    seed: Number.isFinite(meta?.seed) ? meta!.seed : 0,
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

export function createScanService(deps: ScanServiceDeps) {
  const { imageRepo, folderRepo, sender } = deps;
  const metaReader = deps.readMeta ?? readImageMeta;

  async function scanFolder(
    folderId: number,
    folderPath: string,
    signal?: CancelToken,
  ): Promise<void> {
    sender.send("image:scanFolder", {
      folderId,
      folderName: folderPath,
      active: true,
    });

    try {
      // Check folder accessibility
      try {
        await fs.promises.access(folderPath);
      } catch {
        log.info(`skipping inaccessible folder: ${folderPath}`);
        return;
      }

      // Load existing images for delta detection
      const existing = await imageRepo.findSyncRowsByFolderId(folderId);
      const existingMap = new Map(existing.map((e) => [e.path, e] as const));
      const discoveredPaths = new Set<string>();

      const pending: ImageUpsertData[] = [];
      let done = 0;
      let total = await countImageFiles(folderPath, signal);
      sender.send("image:scanProgress", { scanned: 0, total });

      const flushBatch = async (): Promise<void> => {
        if (pending.length === 0) return;
        const batch = pending.splice(0);
        const images = await imageRepo.upsertBatch(batch);
        sender.send("image:batch", { rows: images });
      };

      await withConcurrency(
        walkImageFiles(folderPath, signal),
        SYNC_CONCURRENCY,
        async (filePath) => {
          try {
            discoveredPaths.add(filePath);
            const stat = await fs.promises.stat(filePath);
            const existingRow = existingMap.get(filePath);

            // Skip unchanged files
            if (
              existingRow &&
              existingRow.fileModifiedAt.getTime() === stat.mtime.getTime() &&
              existingRow.source !== "unknown"
            ) {
              return;
            }

            const meta = metaReader(filePath);
            pending.push(buildUpsertData(filePath, folderId, stat, meta));
            if (pending.length >= BATCH_SIZE) await flushBatch();
          } catch {
            // skip unreadable files
          } finally {
            done++;
            sender.send("image:scanProgress", { scanned: done, total });
          }
        },
        signal,
      );

      await flushBatch();

      // Prune stale rows (files deleted from disk)
      const staleIds = existing
        .filter((row) => !discoveredPaths.has(row.path))
        .map((row) => row.id);
      if (staleIds.length > 0) {
        await imageRepo.deleteByIds(staleIds);
        sender.send("image:removed", { paths: staleIds });
      }

      // Update folder scan fingerprint
      await imageRepo.updateFolderScanMeta(
        folderId,
        discoveredPaths.size,
        new Date(),
      );
    } finally {
      sender.send("image:scanFolder", { folderId, active: false });
    }
  }

  return {
    async scanAll(options?: ScanOptions): Promise<void> {
      const signal = options?.signal;
      const startedAt = Date.now();
      log.info("scanAll start");

      try {
        const allFolders = await folderRepo.findAll();
        const folders =
          options?.folderIds && options.folderIds.length > 0
            ? allFolders.filter((f) => options.folderIds!.includes(f.id))
            : allFolders;

        for (const folder of folders) {
          if (signal?.cancelled) break;
          await scanFolder(folder.id, folder.path, signal);
        }
      } finally {
        const elapsed = Date.now() - startedAt;
        log.info(`scanAll end elapsed=${elapsed}ms`);
      }
    },

    async scanOne(folderId: number, signal?: CancelToken): Promise<void> {
      const folder = await folderRepo.findById(folderId);
      if (!folder) throw new Error(`Folder not found: ${folderId}`);
      await scanFolder(folderId, folder.path, signal);
    },

    buildUpsertData,
  };
}

export type ScanService = ReturnType<typeof createScanService>;
