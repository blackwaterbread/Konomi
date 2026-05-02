import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { ImageRow } from "@preload/index.d";

interface UseImageEventSubscriptionsOptions {
  scheduleSearchStatsRefresh: (delay?: number) => void;
  scanningRef: MutableRefObject<boolean>;
  rescanningRef: MutableRefObject<boolean>;
  schedulePageRefresh: (delay?: number) => void;
}

/**
 * Runs the app initialization sequence:
 * quickVerify → scan (changed folders only).
 *
 * quickVerify classifies every folder as changed/unchanged via stat + mtime.
 * Unchanged folders are passed as skipFolderIds so syncAllFolders skips them
 * entirely, avoiding redundant DB queries and stale-row checks.
 *
 * Analysis (computeHashes / similarity refresh) is auto-scheduled by the
 * core maintenance service when scanService.scanAll() finishes, so the
 * renderer no longer schedules it here.
 */
export type RunScan = (options?: {
  detectDuplicates?: boolean;
  folderIds?: number[];
  skipFolderIds?: number[];
  refreshPage?: boolean;
  refreshSearchPresetStats?: boolean;
}) => Promise<{ ok: boolean; cancelled: boolean }>;

export function runAppInitialization({
  loadSearchPresetStats,
  runScan,
  onInitialRefreshDone,
  setScanning,
  scanningRef,
}: {
  loadSearchPresetStats: () => Promise<void>;
  runScan: RunScan;
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
 *
 * Auto-trigger of analysis on batch/removed lives in the core maintenance
 * service; this hook only updates renderer-side UI state and refreshes
 * downstream caches (search-stat presets, subfolder lists).
 */
export function useImageEventSubscriptions({
  scheduleSearchStatsRefresh,
  scanningRef,
  rescanningRef,
  schedulePageRefresh,
  addPendingNewIds,
  addPendingRemovedIds,
  effectiveFolderIds,
  refreshSubfolders,
}: UseImageEventSubscriptionsOptions & {
  addPendingNewIds: (ids: number[]) => void;
  addPendingRemovedIds: (ids: number[]) => void;
  effectiveFolderIds: Set<number>;
  refreshSubfolders?: (
    folderIds: number[],
    options?: { allowEmpty?: boolean },
  ) => Promise<void>;
}) {
  const addPendingNewIdsRef = useRef(addPendingNewIds);
  useEffect(() => {
    addPendingNewIdsRef.current = addPendingNewIds;
  }, [addPendingNewIds]);

  const addPendingRemovedIdsRef = useRef(addPendingRemovedIds);
  useEffect(() => {
    addPendingRemovedIdsRef.current = addPendingRemovedIds;
  }, [addPendingRemovedIds]);

  const effectiveFolderIdsRef = useRef(effectiveFolderIds);
  useEffect(() => {
    effectiveFolderIdsRef.current = effectiveFolderIds;
  }, [effectiveFolderIds]);

  const refreshSubfoldersRef = useRef(refreshSubfolders);
  useEffect(() => {
    refreshSubfoldersRef.current = refreshSubfolders;
  }, [refreshSubfolders]);

  // Debounced subfolder refresh: accumulates folder IDs over 1s before calling
  // refreshSubfolders once. Prevents flooding the utility process with
  // listSubdirectories IPC calls when many file events fire in rapid succession.
  const pendingRefreshIdsRef = useRef<Set<number>>(new Set());
  const pendingRefreshAllowEmptyRef = useRef(false);
  const refreshDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSubfolderRefresh = useCallback(
    (ids: number[], options?: { allowEmpty?: boolean }) => {
      const refresh = refreshSubfoldersRef.current;
      if (!refresh) return;
      for (const id of ids) pendingRefreshIdsRef.current.add(id);
      if (options?.allowEmpty) pendingRefreshAllowEmptyRef.current = true;
      if (refreshDebounceTimerRef.current)
        clearTimeout(refreshDebounceTimerRef.current);
      refreshDebounceTimerRef.current = setTimeout(() => {
        refreshDebounceTimerRef.current = null;
        const folderIds = [...pendingRefreshIdsRef.current];
        pendingRefreshIdsRef.current.clear();
        const allowEmpty = pendingRefreshAllowEmptyRef.current;
        pendingRefreshAllowEmptyRef.current = false;
        if (folderIds.length > 0) void refresh(folderIds, { allowEmpty });
      }, 1000);
    },
    [],
  );

  useEffect(() => {
    const offBatch = window.image.onBatch((rows: ImageRow[]) => {
      if (rows.length === 0) return;
      if (rescanningRef.current) return;
      if (scanningRef.current) {
        // Skip gallery refresh during scan — scan completion in useScanning
        // triggers a full schedulePageRefresh(0) anyway. Refreshing mid-scan
        // causes DB reads + image file reads that compete with scan IO.
      } else {
        // Only collect rows that are actually new (not metadata updates /
        // mtime touches of existing paths) AND belong to currently visible
        // folders. Every emitter (scan-service, watch-service, rescan
        // handlers) annotates batch rows with isNew, so a missing flag
        // signals a bug in a new emitter — fail closed (don't count) so it
        // surfaces as "no banner" rather than silently inflating the count.
        const visibleNewIds: number[] = [];
        for (const r of rows) {
          if (r.isNew !== true) continue;
          if (!effectiveFolderIdsRef.current.has(r.folderId)) continue;
          visibleNewIds.push(r.id);
        }
        if (visibleNewIds.length > 0) {
          addPendingNewIdsRef.current(visibleNewIds);
        }
        scheduleSearchStatsRefresh(180);
        // Subfolder list is derived from image paths. New images may belong
        // to a subfolder that isn't yet in the cached list — refresh so the
        // sidebar picks it up without requiring a restart.
        const touchedFolderIds = [...new Set(rows.map((r) => r.folderId))];
        if (touchedFolderIds.length > 0)
          scheduleSubfolderRefresh(touchedFolderIds);
      }
    });

    const offRemoved = window.image.onRemoved((ids: number[]) => {
      if (ids.length === 0) return;
      if (rescanningRef.current) return;
      if (!scanningRef.current) {
        addPendingRemovedIdsRef.current(ids);
      }
      scheduleSearchStatsRefresh(120);
      // Subfolder list is derived from image paths, so removed images can
      // leave stale entries until the next full refresh. Recompute now.
      const folderIds = [...effectiveFolderIdsRef.current];
      if (folderIds.length > 0)
        scheduleSubfolderRefresh(folderIds, { allowEmpty: true });
    });

    return () => {
      offBatch();
      offRemoved();
      if (refreshDebounceTimerRef.current) {
        clearTimeout(refreshDebounceTimerRef.current);
        refreshDebounceTimerRef.current = null;
      }
    };
  }, [
    scanningRef,
    rescanningRef,
    schedulePageRefresh,
    scheduleSearchStatsRefresh,
    scheduleSubfolderRefresh,
  ]);
}

