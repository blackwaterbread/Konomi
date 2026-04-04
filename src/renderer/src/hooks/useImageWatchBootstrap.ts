import { useEffect } from "react";
import type { MutableRefObject } from "react";
import type { ImageRow } from "@preload/index.d";
import { createLogger } from "@/lib/logger";

const log = createLogger("renderer/useImageWatchBootstrap");

interface UseImageWatchBootstrapOptions {
  loadSearchPresetStats: () => Promise<void>;
  scheduleSearchStatsRefresh: (delay?: number) => void;
  scanningRef: MutableRefObject<boolean>;
  scanStartCountRef: MutableRefObject<number>;
  scheduleAnalysis: (delay?: number) => void;
  schedulePageRefresh: (delay?: number) => void;
  runScan: (options?: {
    detectDuplicates?: boolean;
    folderIds?: number[];
    refreshPage?: boolean;
    refreshSearchPresetStats?: boolean;
  }) => Promise<boolean>;
}

export function useImageWatchBootstrap({
  loadSearchPresetStats,
  scheduleSearchStatsRefresh,
  scanningRef,
  scanStartCountRef,
  scheduleAnalysis,
  schedulePageRefresh,
  runScan,
}: UseImageWatchBootstrapOptions) {
  useEffect(() => {
    log.info(
      "App mounted: loading initial data, starting watchers, and running initial scan",
    );
    void loadSearchPresetStats();
    void runScan({
      detectDuplicates: true,
      refreshPage: true,
      refreshSearchPresetStats: true,
    }).then(() => {
      scheduleAnalysis(0);
    });
    let scanFirstBatchFired = false;
    let lastScanRefreshAt = 0;
    let lastSeenScanStart = 0;
    const SCAN_REFRESH_INTERVAL_MS = 3000;

    const offBatch = window.image.onBatch((rows: ImageRow[]) => {
      if (rows.length === 0) return;
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
      watchCancelled = true;
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
    scheduleAnalysis,
    schedulePageRefresh,
    scheduleSearchStatsRefresh,
  ]);
}
