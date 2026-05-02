import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import i18n from "@/lib/i18n";
import { createLogger } from "@/lib/logger";

const log = createLogger("renderer/useScanning");

export function useScanning({
  schedulePageRefresh,
  loadSearchPresetStats,
  refreshSubfolders,
  allFolderIds,
}: {
  schedulePageRefresh: (delay?: number) => void;
  loadSearchPresetStats: () => Promise<void>;
  refreshSubfolders?: (
    folderIds: number[],
    options?: { allowEmpty?: boolean },
  ) => Promise<void>;
  allFolderIds?: number[];
}) {
  const [scanning, setScanning] = useState(false);
  const [activeScanFolderIds, setActiveScanFolderIds] = useState<Set<number>>(
    new Set(),
  );
  const [rollbackFolderIds, setRollbackFolderIds] = useState<Set<number>>(
    new Set(),
  );
  const [scanCancelConfirmOpen, setScanCancelConfirmOpen] = useState(false);
  const [folderRollbackRequest, setFolderRollbackRequest] = useState<{
    id: number;
    folderIds: number[];
  } | null>(null);

  const scanPromiseRef = useRef<Promise<{
    ok: boolean;
    cancelled: boolean;
  }> | null>(null);
  const scanningRef = useRef(false);
  const scanStartCountRef = useRef(0);
  const rollbackRequestSeqRef = useRef(0);

  const refreshSubfoldersRef = useRef(refreshSubfolders);
  useEffect(() => {
    refreshSubfoldersRef.current = refreshSubfolders;
  }, [refreshSubfolders]);

  const allFolderIdsRef = useRef(allFolderIds);
  useEffect(() => {
    allFolderIdsRef.current = allFolderIds;
  }, [allFolderIds]);

  useEffect(() => {
    const offScanFolder = window.image.onScanFolder(
      ({ folderId, active }) => {
        setActiveScanFolderIds((prev) => {
          const next = new Set(prev);
          if (active) next.add(folderId);
          else next.delete(folderId);
          return next;
        });
      },
    );

    return () => {
      offScanFolder();
    };
  }, []);

  const runScan = useCallback(
    (options?: {
      detectDuplicates?: boolean;
      folderIds?: number[];
      skipFolderIds?: number[];
      refreshPage?: boolean;
      refreshSearchPresetStats?: boolean;
    }): Promise<{ ok: boolean; cancelled: boolean }> => {
      if (scanPromiseRef.current) {
        log.debug("Scan request deduped");
        return scanPromiseRef.current;
      }
      const {
        detectDuplicates,
        folderIds,
        skipFolderIds,
        refreshPage = true,
        refreshSearchPresetStats = true,
      } = options ?? {};
      const startedAt = Date.now();
      log.info("Scan started", { options });
      scanStartCountRef.current += 1;
      scanningRef.current = true;
      setScanning(true);
      const orderedFolderIds = (() => {
        try {
          const raw = localStorage.getItem("konomi-folder-order");
          if (!raw) return undefined;
          const parsed = JSON.parse(raw) as unknown;
          if (!Array.isArray(parsed)) return undefined;
          const ids = parsed.filter((id): id is number => Number.isInteger(id));
          return ids.length > 0 ? ids : undefined;
        } catch {
          return undefined;
        }
      })();
      const scanPromise = window.image
        .scan({ detectDuplicates, folderIds, orderedFolderIds, skipFolderIds })
        .then((result) => {
          const cancelled = result?.cancelled === true;
          log.info("Scan completed", {
            elapsedMs: Date.now() - startedAt,
            cancelled,
          });
          if (cancelled) {
            return { ok: true, cancelled: true };
          }
          if (refreshPage) {
            schedulePageRefresh(0);
          }
          if (refreshSearchPresetStats) {
            void loadSearchPresetStats();
          }
          // Subfolder list is derived from image paths. A scan may introduce
          // new subfolders (or drop empty ones); refresh so the sidebar
          // reflects the post-scan state without a restart.
          const refresh = refreshSubfoldersRef.current;
          if (refresh) {
            const ids =
              folderIds && folderIds.length > 0
                ? folderIds
                : (allFolderIdsRef.current ?? []);
            if (ids.length > 0) {
              void refresh(ids, { allowEmpty: true });
            }
          }
          return { ok: true, cancelled: false };
        })
        .catch((e: unknown) => {
          log.error("Scan failed", {
            elapsedMs: Date.now() - startedAt,
            error: e instanceof Error ? e.message : String(e),
          });
          toast.error(
            i18n.t("error.scanFailed", {
              message: e instanceof Error ? e.message : String(e),
            }),
          );
          return { ok: false, cancelled: false };
        })
        .finally(() => {
          scanningRef.current = false;
          setScanning(false);
          setActiveScanFolderIds(new Set());
          scanPromiseRef.current = null;
        });
      scanPromiseRef.current = scanPromise;
      return scanPromise;
    },
    [loadSearchPresetStats, schedulePageRefresh],
  );

  const waitForScanToStop = useCallback(async (timeoutMs = 15000) => {
    const start = Date.now();
    while (scanningRef.current && Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }, []);

  const handleCancelScan = useCallback(() => {
    setScanCancelConfirmOpen(true);
  }, []);

  const confirmCancelScan = useCallback(async () => {
    log.warn("Scan cancel requested");
    setScanCancelConfirmOpen(false);
    const rollbackTargetFolderIds = Array.from(rollbackFolderIds);
    await window.image.cancelScan().catch(() => {});
    await waitForScanToStop();
    schedulePageRefresh(0);

    if (rollbackTargetFolderIds.length > 0) {
      rollbackRequestSeqRef.current += 1;
      setFolderRollbackRequest({
        id: rollbackRequestSeqRef.current,
        folderIds: rollbackTargetFolderIds,
      });
      setRollbackFolderIds((prev) => {
        const next = new Set(prev);
        rollbackTargetFolderIds.forEach((folderId) => next.delete(folderId));
        return next;
      });
    }
  }, [rollbackFolderIds, schedulePageRefresh, waitForScanToStop]);

  return {
    scanning,
    setScanning,
    activeScanFolderIds,
    setActiveScanFolderIds,
    rollbackFolderIds,
    setRollbackFolderIds,
    scanCancelConfirmOpen,
    setScanCancelConfirmOpen,
    folderRollbackRequest,
    setFolderRollbackRequest,
    scanningRef,
    runScan,
    waitForScanToStop,
    handleCancelScan,
    confirmCancelScan,
  };
}
