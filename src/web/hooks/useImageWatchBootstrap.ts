import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { ImageRow } from "@preload/index.d";

interface UseImageWatchBootstrapOptions {
  loadSearchPresetStats: () => Promise<void>;
  scheduleSearchStatsRefresh: (delay?: number) => void;
  scanningRef: MutableRefObject<boolean>;
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
 * Runs the app initialization sequence:
 * quickVerify → scan (changed folders only) → analysis.
 *
 * quickVerify classifies every folder as changed/unchanged via stat + mtime.
 * Unchanged folders are passed as skipFolderIds so syncAllFolders skips them
 * entirely, avoiding redundant DB queries and stale-row checks.
 */
export function runAppInitialization({
  loadSearchPresetStats,
  scheduleAnalysis,
  runScan,
  onInitialRefreshDone,
  setScanning,
  scanningRef,
}: {
  loadSearchPresetStats: () => Promise<void>;
  scheduleAnalysis: (delay?: number) => void;
  runScan: UseImageWatchBootstrapOptions["runScan"];
  onInitialRefreshDone?: () => void;
  setScanning: (v: boolean) => void;
  scanningRef: MutableRefObject<boolean>;
}): { cancel: () => void } {
  let cancelled = false;

  void (async () => {
    void loadSearchPresetStats();

    // Show scanning state immediately so the UI isn't unresponsive
    scanningRef.current = true;
    setScanning(true);

    // Quick-verify folders first — skip unchanged ones during scan
    let skipFolderIds: number[] | undefined;
    try {
      const result = await window.image.quickVerify();
      if (
        result.unchangedFolderIds.length > 0 &&
        result.changedFolderIds.length > 0
      ) {
        skipFolderIds = result.unchangedFolderIds;
      }
    } catch {
      // quickVerify failed — fall through to full scan
    }

    // Skip duplicate detection on boot — it requires hashing candidate files
    // which adds significant IO. The watcher catches duplicates in real-time
    // for new files, and folder-add scans run with detectDuplicates=true.
    await runScan({
      detectDuplicates: false,
      skipFolderIds,
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
  rescanningRef,
  scheduleAnalysis,
  schedulePageRefresh,
  incrementPendingNew,
  incrementPendingRemoved,
  effectiveFolderIds,
  refreshSubfolders,
}: Omit<UseImageWatchBootstrapOptions, "loadSearchPresetStats" | "runScan"> & {
  incrementPendingNew: (count: number) => void;
  incrementPendingRemoved: (count: number) => void;
  effectiveFolderIds: Set<number>;
  refreshSubfolders?: (
    folderIds: number[],
    options?: { allowEmpty?: boolean },
  ) => Promise<void>;
}) {
  const incrementPendingNewRef = useRef(incrementPendingNew);
  useEffect(() => {
    incrementPendingNewRef.current = incrementPendingNew;
  }, [incrementPendingNew]);

  const incrementPendingRemovedRef = useRef(incrementPendingRemoved);
  useEffect(() => {
    incrementPendingRemovedRef.current = incrementPendingRemoved;
  }, [incrementPendingRemoved]);

  const effectiveFolderIdsRef = useRef(effectiveFolderIds);
  useEffect(() => {
    effectiveFolderIdsRef.current = effectiveFolderIds;
  }, [effectiveFolderIds]);

  const refreshSubfoldersRef = useRef(refreshSubfolders);
  useEffect(() => {
    refreshSubfoldersRef.current = refreshSubfolders;
  }, [refreshSubfolders]);

  useEffect(() => {
    const offBatch = window.image.onBatch((rows: ImageRow[]) => {
      if (rows.length === 0) return;
      if (rescanningRef.current) return;
      if (scanningRef.current) {
        // Skip gallery refresh during scan — scan completion in useScanning
        // triggers a full schedulePageRefresh(0) anyway. Refreshing mid-scan
        // causes DB reads + image file reads that compete with scan IO.
      } else {
        // Only count images belonging to currently visible folders so the
        // "new images" banner doesn't appear for non-visible folder additions.
        const visibleCount = rows.filter((r) =>
          effectiveFolderIdsRef.current.has(r.folderId),
        ).length;
        if (visibleCount > 0) {
          incrementPendingNewRef.current(visibleCount);
        }
        scheduleAnalysis();
        scheduleSearchStatsRefresh(180);
        // Subfolder list is derived from image paths. New images may belong
        // to a subfolder that isn't yet in the cached list — refresh so the
        // sidebar picks it up without requiring a restart.
        const refresh = refreshSubfoldersRef.current;
        if (refresh) {
          const touchedFolderIds = [...new Set(rows.map((r) => r.folderId))];
          if (touchedFolderIds.length > 0) void refresh(touchedFolderIds);
        }
      }
    });

    const offRemoved = window.image.onRemoved((ids: number[]) => {
      if (ids.length === 0) return;
      if (rescanningRef.current) return;
      if (!scanningRef.current) {
        incrementPendingRemovedRef.current(ids.length);
      }
      scheduleAnalysis();
      scheduleSearchStatsRefresh(120);
      // Subfolder list is derived from image paths, so removed images can
      // leave stale entries until the next full refresh. Recompute now.
      const refresh = refreshSubfoldersRef.current;
      if (refresh) {
        const folderIds = [...effectiveFolderIdsRef.current];
        if (folderIds.length > 0) void refresh(folderIds, { allowEmpty: true });
      }
    });

    return () => {
      offBatch();
      offRemoved();
    };
  }, [
    scanningRef,
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
    incrementPendingNew: () => {},
    incrementPendingRemoved: () => {},
    effectiveFolderIds: new Set(),
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
      setScanning: () => {},
      scanningRef,
    });
  }, [loadSearchPresetStats, scheduleAnalysis, runScan, scanningRef]);

  useEffect(() => {
    const handle = runInit();
    return handle.cancel;
  }, [runInit]);
}
