import {
  useState,
  useCallback,
  useEffect,
  useRef,
  startTransition,
} from "react";
import { toast } from "sonner";
import { createLogger } from "@/lib/logger";

const log = createLogger("renderer/useScanning");

export function useScanning({
  schedulePageRefresh,
  loadSearchPresetStats,
}: {
  schedulePageRefresh: (delay?: number) => void;
  loadSearchPresetStats: () => Promise<void>;
}) {
  const [scanning, setScanning] = useState(false);
  const [activeScanFolderIds, setActiveScanFolderIds] = useState<Set<number>>(
    new Set(),
  );
  const [rollbackFolderIds, setRollbackFolderIds] = useState<Set<number>>(
    new Set(),
  );
  const [scanProgress, setScanProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [scanCancelConfirmOpen, setScanCancelConfirmOpen] = useState(false);
  const [scanningFolderNames, setScanningFolderNames] = useState<
    Map<number, string>
  >(new Map());
  const [folderRollbackRequest, setFolderRollbackRequest] = useState<{
    id: number;
    folderIds: number[];
  } | null>(null);

  const scanPromiseRef = useRef<Promise<boolean> | null>(null);
  const scanningRef = useRef(false);
  const rollbackRequestSeqRef = useRef(0);

  useEffect(() => {
    const offScanProgress = window.image.onScanProgress((data) => {
      if (scanningRef.current)
        startTransition(() =>
          setScanProgress(data.done >= data.total ? null : data),
        );
    });
    const offScanFolder = window.image.onScanFolder(
      ({ folderId, folderName, active }) => {
        setActiveScanFolderIds((prev) => {
          const next = new Set(prev);
          if (active) next.add(folderId);
          else next.delete(folderId);
          return next;
        });
        setScanningFolderNames((prev) => {
          const next = new Map(prev);
          if (active && folderName) next.set(folderId, folderName);
          else next.delete(folderId);
          return next;
        });
      },
    );

    return () => {
      offScanProgress();
      offScanFolder();
    };
  }, []);

  const runScan = useCallback(
    (options?: {
      detectDuplicates?: boolean;
      refreshPage?: boolean;
      refreshSearchPresetStats?: boolean;
    }): Promise<boolean> => {
      if (scanPromiseRef.current) {
        log.debug("Scan request deduped");
        return scanPromiseRef.current;
      }
      const {
        detectDuplicates,
        refreshPage = true,
        refreshSearchPresetStats = true,
      } = options ?? {};
      const startedAt = Date.now();
      log.info("Scan started", { options });
      scanningRef.current = true;
      setScanning(true);
      setScanProgress(null);
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
        .scan({ detectDuplicates, orderedFolderIds })
        .then(() => {
          log.info("Scan completed", { elapsedMs: Date.now() - startedAt });
          if (refreshPage) {
            schedulePageRefresh(0);
          }
          if (refreshSearchPresetStats) {
            void loadSearchPresetStats();
          }
          return true;
        })
        .catch((e: unknown) => {
          log.error("Scan failed", {
            elapsedMs: Date.now() - startedAt,
            error: e instanceof Error ? e.message : String(e),
          });
          toast.error(
            `스캔 실패: ${e instanceof Error ? e.message : String(e)}`,
          );
          return false;
        })
        .finally(() => {
          scanningRef.current = false;
          setScanning(false);
          setScanProgress(null);
          setActiveScanFolderIds(new Set());
          setScanningFolderNames(new Map());
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
    activeScanFolderIds,
    setActiveScanFolderIds,
    rollbackFolderIds,
    setRollbackFolderIds,
    scanProgress,
    scanCancelConfirmOpen,
    setScanCancelConfirmOpen,
    scanningFolderNames,
    folderRollbackRequest,
    setFolderRollbackRequest,
    scanningRef,
    runScan,
    waitForScanToStop,
    handleCancelScan,
    confirmCancelScan,
  };
}
