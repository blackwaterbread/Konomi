import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { ImageRow } from "@preload/index.d";
import type { QuickVerifyResult } from "@/bootstrap-app";
import { createLogger } from "@/lib/logger";

const log = createLogger("renderer/useImageWatchBootstrap");

const DEFERRED_INTEGRITY_CHECK_MS = 30_000;

interface UseImageWatchBootstrapOptions {
  loadSearchPresetStats: () => Promise<void>;
  scheduleSearchStatsRefresh: (delay?: number) => void;
  scanningRef: MutableRefObject<boolean>;
  scanStartCountRef: MutableRefObject<number>;
  rescanningRef: MutableRefObject<boolean>;
  scheduleAnalysis: (delay?: number) => void;
  schedulePageRefresh: (delay?: number) => void;
  runScan: (options?: {
    detectDuplicates?: boolean;
    folderIds?: number[];
    skipFolderIds?: number[];
    refreshPage?: boolean;
    refreshSearchPresetStats?: boolean;
  }) => Promise<boolean>;
}

/**
 * Runs the app initialization sequence: quickVerify → conditional scan → deferred integrity check.
 * Called explicitly from the App mount orchestrator instead of being triggered by a useEffect.
 */
export function runAppInitialization({
  quickVerifyResult,
  loadSearchPresetStats,
  scanningRef,
  scheduleAnalysis,
  runScan,
}: {
  quickVerifyResult: QuickVerifyResult | null;
  loadSearchPresetStats: () => Promise<void>;
  scanningRef: MutableRefObject<boolean>;
  scheduleAnalysis: (delay?: number) => void;
  runScan: UseImageWatchBootstrapOptions["runScan"];
}): { cancel: () => void } {
  let cancelled = false;
  let deferredTimer: ReturnType<typeof setTimeout> | null = null;

  // Use bootstrap-provided quickVerify result, or run it now as fallback
  const initPromise = (async () => {
    let changedFolderIds: number[] = [];
    let unchangedFolderIds: number[] = [];

    if (quickVerifyResult) {
      changedFolderIds = quickVerifyResult.changedFolderIds;
      unchangedFolderIds = quickVerifyResult.unchangedFolderIds;
      log.info("Using bootstrap quickVerify result", {
        changed: changedFolderIds.length,
        unchanged: unchangedFolderIds.length,
      });
    } else {
      try {
        const result = await window.image.quickVerify();
        changedFolderIds = result.changedFolderIds;
        unchangedFolderIds = result.unchangedFolderIds;
        log.info("Quick verify result (fallback)", {
          changed: changedFolderIds.length,
          unchanged: unchangedFolderIds.length,
        });
      } catch (error: unknown) {
        log.warn("Quick verify failed, falling back to full scan", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (cancelled) return;

    // Conditional scan
    if (changedFolderIds.length === 0 && unchangedFolderIds.length > 0) {
      log.info("All folders unchanged, skipping initial scan");
      void loadSearchPresetStats();
      scheduleAnalysis(0);
    } else {
      void loadSearchPresetStats();
      void runScan({
        detectDuplicates: true,
        skipFolderIds:
          unchangedFolderIds.length > 0 ? unchangedFolderIds : undefined,
        refreshPage: true,
        refreshSearchPresetStats: true,
      }).then(() => {
        scheduleAnalysis(0);
      });
    }

    // Deferred integrity check for unchanged folders
    if (unchangedFolderIds.length > 0 && !cancelled) {
      deferredTimer = setTimeout(() => {
        deferredTimer = null;
        if (cancelled || scanningRef.current) return;
        log.info("Running deferred integrity check for unchanged folders");
        void runScan({
          detectDuplicates: false,
          folderIds: unchangedFolderIds,
          refreshPage: true,
          refreshSearchPresetStats: false,
        });
      }, DEFERRED_INTEGRITY_CHECK_MS);
    }
  })();

  void initPromise;

  return {
    cancel: () => {
      cancelled = true;
      if (deferredTimer) {
        clearTimeout(deferredTimer);
        deferredTimer = null;
      }
    },
  };
}

/**
 * Subscribes to IPC events (onBatch, onRemoved) and starts the file watcher.
 * Pure event subscription — no initialization logic.
 */
export function useImageEventSubscriptions({
  scheduleSearchStatsRefresh,
  scanningRef,
  scanStartCountRef,
  rescanningRef,
  scheduleAnalysis,
  schedulePageRefresh,
}: Omit<UseImageWatchBootstrapOptions, "loadSearchPresetStats" | "runScan">) {
  const SCAN_REFRESH_INTERVAL_MS = 3000;

  useEffect(() => {
    let scanFirstBatchFired = false;
    let lastScanRefreshAt = 0;
    let lastSeenScanStart = 0;

    const offBatch = window.image.onBatch((rows: ImageRow[]) => {
      if (rows.length === 0) return;
      if (rescanningRef.current) return;
      if (scanningRef.current) {
        if (scanStartCountRef.current !== lastSeenScanStart) {
          lastSeenScanStart = scanStartCountRef.current;
          scanFirstBatchFired = false;
          lastScanRefreshAt = 0;
        }
        if (!scanFirstBatchFired) {
          scanFirstBatchFired = true;
          lastScanRefreshAt = Date.now();
          schedulePageRefresh(0);
        } else {
          const elapsed = Date.now() - lastScanRefreshAt;
          if (elapsed >= SCAN_REFRESH_INTERVAL_MS) {
            lastScanRefreshAt = Date.now();
            schedulePageRefresh(0);
          } else {
            schedulePageRefresh(SCAN_REFRESH_INTERVAL_MS - elapsed);
          }
        }
      } else {
        scanFirstBatchFired = false;
        lastScanRefreshAt = 0;
        schedulePageRefresh(150);
        scheduleAnalysis();
        scheduleSearchStatsRefresh(180);
      }
    });

    const offRemoved = window.image.onRemoved((ids: number[]) => {
      if (ids.length === 0) return;
      schedulePageRefresh(60);
      scheduleAnalysis();
      scheduleSearchStatsRefresh(120);
    });

    // File watcher with retry
    let watchCancelled = false;
    let watchRetryTimer: ReturnType<typeof setTimeout> | null = null;
    const startWatch = (attempt = 0): void => {
      void window.image.watch().catch((error: unknown) => {
        if (watchCancelled) return;
        const delayMs = Math.min(10000, 1000 * 2 ** attempt);
        log.warn("Image watcher start failed; retry scheduled", {
          attempt: attempt + 1,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        });
        watchRetryTimer = setTimeout(() => {
          watchRetryTimer = null;
          startWatch(attempt + 1);
        }, delayMs);
      });
    };
    startWatch();

    return () => {
      watchCancelled = true;
      if (watchRetryTimer) {
        clearTimeout(watchRetryTimer);
        watchRetryTimer = null;
      }
      offBatch();
      offRemoved();
    };
  }, [
    scanningRef,
    scanStartCountRef,
    rescanningRef,
    scheduleAnalysis,
    schedulePageRefresh,
    scheduleSearchStatsRefresh,
  ]);
}

/**
 * @deprecated Use useImageEventSubscriptions + runAppInitialization instead.
 * Kept temporarily for reference during migration.
 */
export function useImageWatchBootstrap(options: UseImageWatchBootstrapOptions) {
  const {
    loadSearchPresetStats,
    scanningRef,
    scheduleAnalysis,
    runScan,
    ...subscriptionOptions
  } = options;

  // Event subscriptions
  useImageEventSubscriptions({
    ...subscriptionOptions,
    scanningRef,
    scheduleAnalysis,
  });

  // Initialization — run once on mount with no quickVerify (fallback path)
  const initRef = useRef(false);
  const runInit = useCallback(() => {
    if (initRef.current) return { cancel: () => {} };
    initRef.current = true;
    return runAppInitialization({
      quickVerifyResult: null,
      loadSearchPresetStats,
      scanningRef,
      scheduleAnalysis,
      runScan,
    });
  }, [loadSearchPresetStats, scanningRef, scheduleAnalysis, runScan]);

  useEffect(() => {
    const handle = runInit();
    return handle.cancel;
  }, [runInit]);
}
