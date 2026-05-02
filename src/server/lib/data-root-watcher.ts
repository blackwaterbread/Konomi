import fs from "fs";
import path from "path";
import { createLogger } from "@core/lib/logger";
import {
  DATA_ROOT,
  dataRootExists,
  isUnderDataRoot,
  listAvailableDirectories,
} from "./data-root";
import type { Services } from "../services";

const log = createLogger("web/data-root-watcher");
const RECONCILE_DEBOUNCE_MS = 1000;
const POLL_INTERVAL_MS = 60_000;

function normalizeFsPath(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export interface DataRootWatcher {
  start(): void;
  stop(): void;
  reconcileNow(): Promise<void>;
  /**
   * Resolves once any background scan triggered by auto-registration has
   * settled. Shutdown awaits this so worker pools / DB aren't torn down while
   * a scanOne is still issuing reads/writes.
   */
  awaitInFlight(): Promise<void>;
}

/**
 * Watches DATA_ROOT for newly mounted / removed volume directories at runtime,
 * so users adding a docker volume don't have to restart the container.
 *
 * fs.watch is unreliable on NFS/SMB, so a 60s polling fallback runs alongside.
 */
export function createDataRootWatcher(services: Services): DataRootWatcher {
  let fsWatcher: fs.FSWatcher | null = null;
  let pollTimer: NodeJS.Timeout | null = null;
  let debounceTimer: NodeJS.Timeout | null = null;
  let reconcileInFlight = false;
  let pendingReconcile = false;
  let stopped = false;
  const inFlightScans = new Set<Promise<void>>();

  async function reconcile(): Promise<void> {
    if (reconcileInFlight) {
      pendingReconcile = true;
      return;
    }
    reconcileInFlight = true;
    try {
      // DATA_ROOT itself disappearing means a misconfiguration — never wipe
      // the user's library based on that. Skip until it returns.
      if (!(await dataRootExists())) return;

      const detected = await listAvailableDirectories();
      const detectedPaths = new Set(
        detected.map((d) => normalizeFsPath(d.path)),
      );
      const existing = await services.folderService.list();
      const existingPaths = new Set(
        existing.map((f) => normalizeFsPath(f.path)),
      );

      const newlyRegistered: number[] = [];
      let removed = 0;

      for (const dir of detected) {
        if (existingPaths.has(normalizeFsPath(dir.path))) continue;
        try {
          const folder = await services.folderService.create(
            dir.name,
            dir.path,
          );
          services.watchService.watchFolder(folder.id, folder.path);
          newlyRegistered.push(folder.id);
          log.info(`Auto-registered folder: ${dir.name} (${dir.path})`);
        } catch (err) {
          log.errorWithStack(
            `Failed to auto-register folder ${dir.path}`,
            err as Error,
          );
        }
      }

      // Auto-removal cascades through Image rows; running it concurrently
      // with scanService.scanAll/scanOne would race the scan's folder
      // iteration. Skip removal while a scan is active and let the next
      // reconcile (debounced fs.watch event or 60s poll) handle it.
      const removalDeferred = services.scanState.active;
      if (removalDeferred) {
        log.debug(
          "Deferring folder auto-removal — scan in progress; will retry on next reconcile",
        );
      } else {
        for (const folder of existing) {
          if (!isUnderDataRoot(folder.path)) continue;
          if (detectedPaths.has(normalizeFsPath(folder.path))) continue;
          try {
            services.watchService.stopFolder(folder.id);
            await services.folderService.delete(folder.id);
            removed++;
            log.info(
              `Auto-removed missing folder: ${folder.name} (${folder.path})`,
            );
          } catch (err) {
            log.errorWithStack(
              `Failed to auto-remove folder ${folder.path}`,
              err as Error,
            );
          }
        }
      }

      if (newlyRegistered.length > 0 || removed > 0) {
        services.sender.send("folder:listChanged", {
          added: newlyRegistered.length,
          removed,
        });
      }

      if (newlyRegistered.length > 0 && !stopped) {
        // Newly mounted volumes typically already contain files; fs.watch only
        // fires on subsequent changes, so we have to scan once explicitly.
        // Tracked in inFlightScans so shutdown can await it.
        const scanPromise = scanNewlyRegistered(newlyRegistered);
        inFlightScans.add(scanPromise);
        scanPromise.finally(() => inFlightScans.delete(scanPromise));
      }
    } catch (err) {
      log.errorWithStack("DATA_ROOT reconcile failed", err as Error);
    } finally {
      reconcileInFlight = false;
      if (pendingReconcile && !stopped) {
        pendingReconcile = false;
        scheduleReconcile();
      }
    }
  }

  async function scanNewlyRegistered(folderIds: number[]): Promise<void> {
    // Bail if shutdown started before we could launch.
    if (services.scanState.shuttingDown) return;
    // If a scan is already active, defer to the next reconcile — the
    // active scan owns the cancel token and we don't want to step on it.
    if (services.scanState.active) {
      log.info(
        `Deferring scan for ${folderIds.length} new folder(s) — scan in progress`,
      );
      return;
    }
    // Take ownership of scanState so maintenance defers and shutdown can
    // cancel via scanState.cancelToken — same contract as runInitialScan.
    const cancelToken = { cancelled: false };
    services.scanState.active = true;
    services.scanState.cancelToken = cancelToken;
    services.watchService.setScanActive(true);
    try {
      for (const folderId of folderIds) {
        if (stopped || cancelToken.cancelled) return;
        await services.scanService.scanOne(folderId, cancelToken);
      }
      if (!cancelToken.cancelled) {
        services.maintenanceService.scheduleAnalysis();
      }
    } catch (err) {
      log.errorWithStack(
        "Background scan for newly registered folders failed",
        err as Error,
      );
    } finally {
      services.scanState.active = false;
      services.scanState.cancelToken = null;
      services.watchService.setScanActive(false, {
        discardDeferredChanges: true,
      });
    }
  }

  function scheduleReconcile(): void {
    if (stopped) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void reconcile();
    }, RECONCILE_DEBOUNCE_MS);
  }

  return {
    start(): void {
      if (stopped) return;
      try {
        fsWatcher = fs.watch(DATA_ROOT, { persistent: false }, () => {
          scheduleReconcile();
        });
        fsWatcher.on("error", (err) => {
          log.warn(
            `fs.watch error on DATA_ROOT (${DATA_ROOT}): ${(err as Error).message}`,
          );
        });
        log.info(`Watching DATA_ROOT for new mounts: ${DATA_ROOT}`);
      } catch (err) {
        log.warn(
          `Could not watch DATA_ROOT (${DATA_ROOT}); polling only: ${(err as Error).message}`,
        );
      }
      pollTimer = setInterval(() => {
        scheduleReconcile();
      }, POLL_INTERVAL_MS);
      pollTimer.unref?.();
    },

    stop(): void {
      stopped = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      fsWatcher?.close();
      fsWatcher = null;
    },

    async reconcileNow(): Promise<void> {
      await reconcile();
    },

    async awaitInFlight(): Promise<void> {
      await Promise.allSettled(inFlightScans);
    },
  };
}
