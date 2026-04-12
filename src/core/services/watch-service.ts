import fs from "fs";
import path from "path";
import { readImageMeta } from "../lib/image-meta";
import { parsePromptTokens } from "../lib/token";
import { createLogger } from "../lib/logger";
import type { ImageRepository, FolderRepository, ImageUpsertData } from "../types/repository";
import type { EventSender } from "../types/event-sender";

const log = createLogger("watch-service");
const DEBOUNCE_MS = 500;

function buildUpsertData(
  filePath: string,
  folderId: number,
  stat: fs.Stats,
  metaReader: (filePath: string) => ReturnType<typeof readImageMeta>,
): ImageUpsertData {
  const meta = metaReader(filePath);
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

export type WatchServiceDeps = {
  imageRepo: ImageRepository;
  folderRepo: FolderRepository;
  sender: EventSender;
  readMeta?: (filePath: string) => ReturnType<typeof readImageMeta>;
};

export function createWatchService(deps: WatchServiceDeps) {
  const { imageRepo, folderRepo, sender } = deps;
  const metaReader = deps.readMeta ?? readImageMeta;

  const fsWatchers = new Map<number, fs.FSWatcher>();
  const debounceTimers = new Map<string, NodeJS.Timeout>();
  let scanActive = false;
  const deferredChanges = new Map<string, number>();

  async function processChange(
    folderId: number,
    filePath: string,
  ): Promise<void> {
    if (scanActive) {
      deferredChanges.set(filePath, folderId);
      return;
    }

    if (!fs.existsSync(filePath)) {
      // File deleted
      const existing = await imageRepo.findByPath(filePath);
      if (existing) {
        await imageRepo.deleteByPath(filePath);
        sender.send("image:removed", { path: filePath });
      }
      return;
    }

    // File added or modified
    try {
      const stat = fs.statSync(filePath);
      const existing = await imageRepo.findByPath(filePath);
      if (existing && existing.fileModifiedAt.getTime() === stat.mtime.getTime()) {
        return;
      }

      const data = buildUpsertData(filePath, folderId, stat, metaReader);
      const image = await imageRepo.upsertByPath(data);
      sender.send("image:batch", { rows: [image] });
    } catch {
      // skip unreadable files
    }
  }

  function scheduleProcess(folderId: number, filePath: string): void {
    if (scanActive) {
      deferredChanges.set(filePath, folderId);
      return;
    }
    clearTimeout(debounceTimers.get(filePath));
    debounceTimers.set(
      filePath,
      setTimeout(() => {
        debounceTimers.delete(filePath);
        void processChange(folderId, filePath);
      }, DEBOUNCE_MS),
    );
  }

  function flushDeferred(): void {
    const changes = new Map(deferredChanges);
    deferredChanges.clear();
    for (const [filePath, folderId] of changes) {
      scheduleProcess(folderId, filePath);
    }
  }

  return {
    watchFolder(folderId: number, folderPath: string): void {
      // Stop existing watcher for this folder
      fsWatchers.get(folderId)?.close();

      try {
        const watcher = fs.watch(
          folderPath,
          { recursive: true },
          (_, filename) => {
            if (!filename) return;
            const fullPath = path.join(folderPath, filename);
            if (![".png", ".webp"].includes(path.extname(fullPath).toLowerCase())) {
              return;
            }
            scheduleProcess(folderId, fullPath);
          },
        );
        watcher.on("error", () => {
          fsWatchers.get(folderId)?.close();
          fsWatchers.delete(folderId);
        });
        fsWatchers.set(folderId, watcher);
      } catch {
        log.warn(`failed to watch folder: ${folderPath}`);
      }
    },

    stopFolder(folderId: number): void {
      fsWatchers.get(folderId)?.close();
      fsWatchers.delete(folderId);
    },

    stopAll(): void {
      fsWatchers.forEach((w) => w.close());
      fsWatchers.clear();
      debounceTimers.forEach((t) => clearTimeout(t));
      debounceTimers.clear();
      deferredChanges.clear();
      scanActive = false;
    },

    setScanActive(active: boolean): void {
      scanActive = active;
      if (!active) flushDeferred();
    },

    async startAll(): Promise<void> {
      const folders = await folderRepo.findAll();
      for (const folder of folders) {
        this.watchFolder(folder.id, folder.path);
      }
      log.info(`watching ${folders.length} folders`);
    },
  };
}

export type WatchService = ReturnType<typeof createWatchService>;
