import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { ImageRow } from "@preload/index.d";

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
 * Runs the app initialization sequence: full scan → analysis.
 * The watcher is started automatically in the utility process at boot in
 * paused mode (scanActive=true), so file changes during scan are queued
 * and flushed when the scan finishes.
 */
export function runAppInitialization({
  loadSearchPresetStats,
  scheduleAnalysis,
  runScan,
  onInitialRefreshDone,
}: {
  loadSearchPresetStats: () => Promise<void>;
  scheduleAnalysis: (delay?: number) => void;
  runScan: UseImageWatchBootstrapOptions["runScan"];
  onInitialRefreshDone?: () => void;
}): { cancel: () => void } {
  let cancelled = false;

  void (async () => {
    void loadSearchPresetStats();
    await runScan({
      detectDuplicates: true,
      refreshPage: true,
      refreshSearchPresetStats: true,
    });
    if (!cancelled) onInitialRefreshDone?.();
    scheduleAnalysis(0);
  })();

  return {
    cancel: () => {
      cancelled = true;
    },
  };
}

/**
 * Subscribes to IPC events (onBatch, onRemoved).
 * Pure event subscription — no initialization logic.
 * Watcher is started separately in runAppInitialization.
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

    return () => {
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
      loadSearchPresetStats,
      scheduleAnalysis,
      runScan,
    });
  }, [loadSearchPresetStats, scheduleAnalysis, runScan]);

  useEffect(() => {
    const handle = runInit();
    return handle.cancel;
  }, [runInit]);
}
