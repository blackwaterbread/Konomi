import fs from "fs";
import path from "path";
import { getDB } from "./db";
import { readImageMeta } from "./image-meta";
import { parsePromptTokens } from "@core/lib/token";
import {
  applyImageSearchStatsMutation,
  decrementImageSearchStatsForRows,
  findDuplicateGroupForIncomingPath,
  forgetIgnoredDuplicatePath,
  isIgnoredDuplicatePath,
  type ImageSearchStatSource,
  type ImageRow,
} from "./image";
import {
  deleteSimilarityCacheForImageIds,
  refreshSimilarityCacheForImageIds,
} from "./phash";

const DEBOUNCE_MS = 500;

export type EventSender = {
  send(channel: string, data: unknown): void;
  isDestroyed(): boolean;
};

class FolderWatcher {
  private fsWatchers = new Map<number, fs.FSWatcher>();
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private folderReconcileTimers = new Map<number, NodeJS.Timeout>();
  private pendingDuplicatePaths = new Map<string, number>();
  private sender: EventSender;

  // Scan-active guard: while true, file changes are queued instead of processed
  private scanActive = false;
  private deferredChanges = new Map<string, number>();
  private deferredReconcileFolders = new Set<number>();

  constructor(sender: EventSender) {
    this.sender = sender;
  }

  watchFolder(folderId: number, folderPath: string): void {
    this.stopFolder(folderId);
    try {
      const watcher = fs.watch(
        folderPath,
        { recursive: true },
        (_, filename) => {
          if (!filename) {
            this.scheduleFolderReconcile(folderId);
            return;
          }
          const fullPath = path.join(folderPath, filename);
          if (![".png", ".webp"].includes(path.extname(fullPath).toLowerCase()))
            return;
          this.scheduleProcess(folderId, fullPath);
        },
      );
      watcher.on("error", () => this.stopFolder(folderId));
      this.fsWatchers.set(folderId, watcher);
    } catch {
      // folder not accessible
    }
  }

  stopFolder(folderId: number): void {
    this.fsWatchers.get(folderId)?.close();
    this.fsWatchers.delete(folderId);
    clearTimeout(this.folderReconcileTimers.get(folderId));
    this.folderReconcileTimers.delete(folderId);
  }

  stopAll(): void {
    this.fsWatchers.forEach((w) => w.close());
    this.fsWatchers.clear();
    this.debounceTimers.forEach((t) => clearTimeout(t));
    this.debounceTimers.clear();
    this.folderReconcileTimers.forEach((t) => clearTimeout(t));
    this.folderReconcileTimers.clear();
    this.pendingDuplicatePaths.clear();
    this.scanActive = false;
    this.deferredChanges.clear();
    this.deferredReconcileFolders.clear();
  }

  setScanActive(
    active: boolean,
    options?: { discardDeferredChanges?: boolean },
  ): void {
    this.scanActive = active;
    if (!active) {
      this.flushDeferred(options?.discardDeferredChanges ?? false);
    }
  }

  private flushDeferred(discardChanges: boolean): void {
    if (discardChanges) {
      this.deferredChanges.clear();
    } else {
      const changes = new Map(this.deferredChanges);
      this.deferredChanges.clear();
      for (const [filePath, folderId] of changes) {
        this.scheduleProcess(folderId, filePath);
      }
    }

    const reconcileFolders = new Set(this.deferredReconcileFolders);
    this.deferredReconcileFolders.clear();
    for (const folderId of reconcileFolders) {
      this.scheduleFolderReconcile(folderId);
    }
  }

  applyResolvedDuplicates(data: {
    touchedIncomingPaths: string[];
    retainedIncomingPaths: string[];
  }): void {
    const retained = new Set(data.retainedIncomingPaths);
    for (const incomingPath of data.touchedIncomingPaths) {
      const folderId = this.pendingDuplicatePaths.get(incomingPath);
      this.pendingDuplicatePaths.delete(incomingPath);
      if (folderId !== undefined && retained.has(incomingPath)) {
        this.scheduleProcess(folderId, incomingPath);
      }
    }
  }

  private scheduleProcess(folderId: number, filePath: string): void {
    if (this.scanActive) {
      this.deferredChanges.set(filePath, folderId);
      return;
    }
    clearTimeout(this.debounceTimers.get(filePath));
    this.debounceTimers.set(
      filePath,
      setTimeout(() => {
        this.debounceTimers.delete(filePath);
        void this.processChange(folderId, filePath);
      }, DEBOUNCE_MS),
    );
  }

  private scheduleFolderReconcile(folderId: number): void {
    if (this.scanActive) {
      this.deferredReconcileFolders.add(folderId);
      return;
    }
    clearTimeout(this.folderReconcileTimers.get(folderId));
    this.folderReconcileTimers.set(
      folderId,
      setTimeout(() => {
        this.folderReconcileTimers.delete(folderId);
        void this.reconcileFolderMissingRows(folderId);
      }, DEBOUNCE_MS),
    );
  }

  private async reconcileFolderMissingRows(folderId: number): Promise<void> {
    if (this.scanActive) {
      this.deferredReconcileFolders.add(folderId);
      return;
    }
    if (this.sender.isDestroyed()) return;
    try {
      const db = getDB();
      // Skip if folder root is inaccessible (e.g. NAS offline) to avoid
      // purging all DB rows for a temporarily unreachable folder.
      const folder = await db.folder.findUnique({
        where: { id: folderId },
        select: { path: true },
      });
      if (!folder) return;
      try {
        await fs.promises.access(folder.path);
      } catch {
        return;
      }
      const emitSearchStatsProgress = (done: number, total: number): void => {
        if (this.sender.isDestroyed()) return;
        this.sender.send("image:searchStatsProgress", { done, total });
      };
      const QUERY_CHUNK = 2000;
      const DELETE_BATCH = 400;
      const allRemovedIds: number[] = [];
      let lastId = 0;
      // 폴더 이미지를 cursor 기반 chunk 단위로 조회하고, missing은 즉시 삭제
      while (!this.sender.isDestroyed()) {
        const rows = await db.image.findMany({
          where: { folderId, id: { gt: lastId } },
          select: {
            id: true,
            path: true,
            width: true,
            height: true,
            model: true,
            promptTokens: true,
            negativePromptTokens: true,
            characterPromptTokens: true,
          },
          orderBy: { id: "asc" },
          take: QUERY_CHUNK,
        });
        if (rows.length === 0) break;
        lastId = rows[rows.length - 1].id;
        const missing = rows.filter((row) => !fs.existsSync(row.path));
        for (let i = 0; i < missing.length; i += DELETE_BATCH) {
          if (this.sender.isDestroyed()) break;
          const batch = missing.slice(i, i + DELETE_BATCH);
          await db.image.deleteMany({
            where: { id: { in: batch.map((row) => row.id) } },
          });
          await deleteSimilarityCacheForImageIds(batch.map((row) => row.id));
          await decrementImageSearchStatsForRows(
            batch,
            emitSearchStatsProgress,
          );
          for (const row of batch) allRemovedIds.push(row.id);
        }
      }
      if (allRemovedIds.length === 0 || this.sender.isDestroyed()) return;
      this.sender.send("image:removed", allRemovedIds);
    } catch {
      // ignore reconciliation failures
    }
  }

  private async processChange(
    folderId: number,
    filePath: string,
  ): Promise<void> {
    if (this.scanActive) {
      this.deferredChanges.set(filePath, folderId);
      return;
    }
    if (this.sender.isDestroyed()) return;
    const db = getDB();
    const emitSearchStatsProgress = (done: number, total: number): void => {
      if (this.sender.isDestroyed()) return;
      this.sender.send("image:searchStatsProgress", { done, total });
    };

    if (!fs.existsSync(filePath)) {
      this.pendingDuplicatePaths.delete(filePath);
      await forgetIgnoredDuplicatePath(filePath);
      // File deleted or renamed away
      const existing = await db.image.findUnique({ where: { path: filePath } });
      if (existing && !this.sender.isDestroyed()) {
        await db.image.delete({ where: { path: filePath } });
        await deleteSimilarityCacheForImageIds([existing.id]);
        await applyImageSearchStatsMutation(
          existing,
          null,
          emitSearchStatsProgress,
        );
        this.sender.send("image:removed", [existing.id]);
      } else {
        // Fallback for fs.watch path mismatches/case changes.
        await this.reconcileFolderMissingRows(folderId);
      }
      return;
    }

    // File added or modified
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      const stat = fs.statSync(filePath);
      const mtime = stat.mtime;

      if (await isIgnoredDuplicatePath(filePath)) return;

      const existing = await db.image.findUnique({ where: { path: filePath } });
      if (existing && existing.fileModifiedAt.getTime() === mtime.getTime())
        return;
      if (this.pendingDuplicatePaths.has(filePath)) return;

      if (!existing) {
        const duplicateGroup =
          await findDuplicateGroupForIncomingPath(filePath);
        if (duplicateGroup) {
          this.pendingDuplicatePaths.set(filePath, folderId);
          if (!this.sender.isDestroyed()) {
            this.sender.send("image:watchDuplicate", duplicateGroup);
          }
          return;
        }
      }

      const meta = readImageMeta(filePath);
      const data = {
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
        seed: meta?.seed ?? 0,
        width: meta?.width ?? 0,
        height: meta?.height ?? 0,
        sampler: meta?.sampler ?? "",
        steps: meta?.steps ?? 0,
        cfgScale: meta?.cfgScale ?? 0,
        cfgRescale: meta?.cfgRescale ?? 0,
        noiseSchedule: meta?.noiseSchedule ?? "",
        varietyPlus: meta?.varietyPlus ?? false,
        fileSize: stat.size,
        fileModifiedAt: mtime,
      };

      const image = await db.image.upsert({
        where: { path: filePath },
        update: data,
        create: data,
      });
      await applyImageSearchStatsMutation(
        existing as ImageSearchStatSource | null,
        image as ImageSearchStatSource,
        emitSearchStatsProgress,
      );
      await refreshSimilarityCacheForImageIds([image.id]);

      if (!this.sender.isDestroyed()) {
        this.sender.send("image:batch", [image as ImageRow]);
      }
    } catch {
      // skip unreadable files
    }
  }
}

let activeWatcher: FolderWatcher | null = null;

/**
 * Start watching all folders immediately.
 * When `paused` is true the watcher begins with scanActive=true so that
 * all detected changes are queued instead of processed.  The queue is
 * flushed when setWatcherScanActive(false) is called (e.g. after scan).
 */
export async function startWatching(
  sender: EventSender,
  options?: { paused?: boolean },
): Promise<void> {
  activeWatcher?.stopAll();
  const watcher = new FolderWatcher(sender);
  if (options?.paused) watcher.setScanActive(true);
  activeWatcher = watcher;
  const folders = await getDB().folder.findMany({ orderBy: { createdAt: "asc" } });
  folders.forEach((f) => watcher.watchFolder(f.id, f.path));
}

export function watchNewFolder(folderId: number, folderPath: string): void {
  activeWatcher?.watchFolder(folderId, folderPath);
}

export function unwatchFolder(folderId: number): void {
  activeWatcher?.stopFolder(folderId);
}

export function setWatcherScanActive(
  active: boolean,
  options?: { discardDeferredChanges?: boolean },
): void {
  activeWatcher?.setScanActive(active, options);
}

export function notifyWatchDuplicateResolved(data: {
  touchedIncomingPaths: string[];
  retainedIncomingPaths: string[];
}): void {
  activeWatcher?.applyResolvedDuplicates(data);
}
