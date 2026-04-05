import { useEffect } from "react";
import type { MutableRefObject } from "react";
import type { ImageRow } from "@preload/index.d";
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

export function useImageWatchBootstrap({
  loadSearchPresetStats,
  scheduleSearchStatsRefresh,
  scanningRef,
  scanStartCountRef,
  rescanningRef,
  scheduleAnalysis,
  schedulePageRefresh,
  runScan,
}: UseImageWatchBootstrapOptions) {
  useEffect(() => {
    let cancelled = false;
    let deferredTimer: ReturnType<typeof setTimeout> | null = null;

    log.info("App mounted: quick-verifying folders before scan");

    void (async () => {
      // Phase 1: Quick verify — count-based fingerprint check
      let changedFolderIds: number[] = [];
      let unchangedFolderIds: number[] = [];
      try {
        const result = await window.image.quickVerify();
        changedFolderIds = result.changedFolderIds;
        unchangedFolderIds = result.unchangedFolderIds;
        log.info("Quick verify result", {
          changed: changedFolderIds.length,
          unchanged: unchangedFolderIds.length,
        });
      } catch (error: unknown) {
        log.warn("Quick verify failed, falling back to full scan", {
          error: error instanceof Error ? error.message : String(error),
        });
        // Fallback: treat all as changed → full scan
      }

      if (cancelled) return;

      // Phase 2: Conditional scan
      if (changedFolderIds.length === 0 && unchangedFolderIds.length > 0) {
        // Nothing changed — skip scan, just load cached data
        // (gallery loads automatically via galleryReady gate)
        log.info("All folders unchanged, skipping initial scan");
        void loadSearchPresetStats();
        scheduleAnalysis(0);
      } else {
        // Some folders changed — scan only those, skip unchanged
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

      // Phase 3: Deferred integrity check for unchanged folders
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

    let scanFirstBatchFired = false;
    let lastScanRefreshAt = 0;
    let lastSeenScanStart = 0;
    const SCAN_REFRESH_INTERVAL_MS = 3000;

    const offBatch = window.image.onBatch((rows: ImageRow[]) => {
      if (rows.length === 0) return;
      // 메타데이터 재스캔: 기존 이미지의 메타데이터만 변경되므로 갤러리 갱신 불필요
      if (rescanningRef.current) return;
      if (scanningRef.current) {
        // 새 스캔이 시작되었으면 첫 배치 플래그를 리셋하여 즉시 갱신을 보장한다
        if (scanStartCountRef.current !== lastSeenScanStart) {
          lastSeenScanStart = scanStartCountRef.current;
          scanFirstBatchFired = false;
          lastScanRefreshAt = 0;
        }
        if (!scanFirstBatchFired) {
          // 첫 배치는 즉시 갤러리에 표시하여 빈 화면 시간을 줄인다
          scanFirstBatchFired = true;
          lastScanRefreshAt = Date.now();
          schedulePageRefresh(0);
        } else {
          // 이후 배치는 쓰로틀: 마지막 갱신으로부터 일정 간격이 지났으면 즉시, 아니면 남은 시간 후 갱신
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
      log.info("App unmount cleanup");
      cancelled = true;
      watchCancelled = true;
      if (deferredTimer) {
        clearTimeout(deferredTimer);
        deferredTimer = null;
      }
      if (watchRetryTimer) {
        clearTimeout(watchRetryTimer);
        watchRetryTimer = null;
      }
      offBatch();
      offRemoved();
    };
  }, [
    loadSearchPresetStats,
    runScan,
    scanningRef,
    scanStartCountRef,
    rescanningRef,
    scheduleAnalysis,
    schedulePageRefresh,
    scheduleSearchStatsRefresh,
  ]);
}
