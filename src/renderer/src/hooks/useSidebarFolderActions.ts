import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { createLogger } from "@/lib/logger";

const log = createLogger("renderer/useSidebarFolderActions");

interface RunScanOptions {
  detectDuplicates?: boolean;
  folderIds?: number[];
  refreshPage?: boolean;
  refreshSearchPresetStats?: boolean;
}

interface UseSidebarFolderActionsOptions {
  isAnalyzing: boolean;
  addSelectedFolder: (id: number) => void;
  removeSelectedFolder: (id: number) => void;
  incrementFolderCount: () => void;
  decrementFolderCount: () => void;
  runScan: (options?: RunScanOptions) => Promise<boolean>;
  scanningRef: MutableRefObject<boolean>;
  scheduleAnalysis: (delay?: number) => void;
  schedulePageRefresh: (delay?: number) => void;
  setActiveScanFolderIds: Dispatch<SetStateAction<Set<number>>>;
  setRollbackFolderIds: Dispatch<SetStateAction<Set<number>>>;
}

export function useSidebarFolderActions({
  isAnalyzing,
  addSelectedFolder,
  removeSelectedFolder,
  incrementFolderCount,
  decrementFolderCount,
  runScan,
  scanningRef,
  scheduleAnalysis,
  schedulePageRefresh,
  setActiveScanFolderIds,
  setRollbackFolderIds,
}: UseSidebarFolderActionsOptions) {
  const handleFolderAdded = useCallback(
    (folderId: number) => {
      log.info("Folder added", { folderId });
      addSelectedFolder(folderId);
      incrementFolderCount();
      setRollbackFolderIds((prev) => new Set([...prev, folderId]));
      setActiveScanFolderIds((prev) => new Set([...prev, folderId]));
      schedulePageRefresh(0);
      void runScan().then((ok) => {
        if (!ok) return;
        setRollbackFolderIds((prev) => {
          const next = new Set(prev);
          next.delete(folderId);
          return next;
        });
        scheduleAnalysis(0);
      });
    },
    [
      addSelectedFolder,
      incrementFolderCount,
      runScan,
      scheduleAnalysis,
      schedulePageRefresh,
      setActiveScanFolderIds,
      setRollbackFolderIds,
    ],
  );

  const handleFolderCancelled = useCallback(
    (folderId: number) => {
      log.info("Folder add rollback/cancelled", { folderId });
      removeSelectedFolder(folderId);
      decrementFolderCount();
      setRollbackFolderIds((prev) => {
        const next = new Set(prev);
        next.delete(folderId);
        return next;
      });
      setActiveScanFolderIds((prev) => {
        const next = new Set(prev);
        next.delete(folderId);
        return next;
      });
      schedulePageRefresh(0);
      scheduleAnalysis(500);
    },
    [
      decrementFolderCount,
      removeSelectedFolder,
      scheduleAnalysis,
      schedulePageRefresh,
      setActiveScanFolderIds,
      setRollbackFolderIds,
    ],
  );

  const handleFolderRemoved = useCallback(
    (folderId: number) => {
      log.info("Folder removed", { folderId });
      removeSelectedFolder(folderId);
      decrementFolderCount();
      setRollbackFolderIds((prev) => {
        const next = new Set(prev);
        next.delete(folderId);
        return next;
      });
      setActiveScanFolderIds((prev) => {
        const next = new Set(prev);
        next.delete(folderId);
        return next;
      });
      schedulePageRefresh(0);
      scheduleAnalysis(500);
      void runScan();
    },
    [
      decrementFolderCount,
      removeSelectedFolder,
      runScan,
      scheduleAnalysis,
      schedulePageRefresh,
      setActiveScanFolderIds,
      setRollbackFolderIds,
    ],
  );

  const handleFolderRescan = useCallback(
    (folderId: number) => {
      if (scanningRef.current || isAnalyzing) return;
      log.info("Folder rescan requested", { folderId });
      setActiveScanFolderIds((prev) => {
        const next = new Set(prev);
        next.add(folderId);
        return next;
      });
      void runScan({ folderIds: [folderId] }).then((ok) => {
        if (ok) {
          scheduleAnalysis(0);
        }
      });
    },
    [
      isAnalyzing,
      runScan,
      scanningRef,
      scheduleAnalysis,
      setActiveScanFolderIds,
    ],
  );

  return {
    handleFolderAdded,
    handleFolderCancelled,
    handleFolderRemoved,
    handleFolderRescan,
  };
}
