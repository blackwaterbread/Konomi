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
  runScan: (options?: RunScanOptions) => Promise<boolean>;
  scanningRef: MutableRefObject<boolean>;
  scheduleAnalysis: (delay?: number) => void;
  analyzeTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setActiveScanFolderIds: Dispatch<SetStateAction<Set<number>>>;
  setRollbackFolderIds: Dispatch<SetStateAction<Set<number>>>;
  refreshSubfolders: (folderIds: number[]) => Promise<void>;
}

export function useSidebarFolderActions({
  isAnalyzing,
  addSelectedFolder,
  removeSelectedFolder,
  runScan,
  scanningRef,
  scheduleAnalysis,
  analyzeTimerRef,
  setActiveScanFolderIds,
  setRollbackFolderIds,
  refreshSubfolders,
}: UseSidebarFolderActionsOptions) {
  const handleFolderAdded = useCallback(
    (folderId: number) => {
      log.info("Folder added", { folderId });
      addSelectedFolder(folderId);
      setRollbackFolderIds((prev) => new Set([...prev, folderId]));
      setActiveScanFolderIds((prev) => new Set([...prev, folderId]));
      void runScan({ folderIds: [folderId], detectDuplicates: true }).then((ok) => {
        if (!ok) return;
        void refreshSubfolders([folderId]);
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
      refreshSubfolders,
      runScan,
      scheduleAnalysis,
      setActiveScanFolderIds,
      setRollbackFolderIds,
    ],
  );

  const handleFoldersAdded = useCallback(
    (folderIds: number[]) => {
      if (folderIds.length === 0) return;
      if (folderIds.length === 1) {
        handleFolderAdded(folderIds[0]);
        return;
      }
      log.info("Multiple folders added", { folderIds });
      for (const folderId of folderIds) {
        addSelectedFolder(folderId);
      }
      setRollbackFolderIds((prev) => {
        const next = new Set(prev);
        for (const id of folderIds) next.add(id);
        return next;
      });
      setActiveScanFolderIds((prev) => {
        const next = new Set(prev);
        for (const id of folderIds) next.add(id);
        return next;
      });
      void runScan({ folderIds, detectDuplicates: true }).then((ok) => {
        if (!ok) return;
        void refreshSubfolders(folderIds);
        setRollbackFolderIds((prev) => {
          const next = new Set(prev);
          for (const id of folderIds) next.delete(id);
          return next;
        });
        scheduleAnalysis(0);
      });
    },
    [
      addSelectedFolder,
      handleFolderAdded,
      refreshSubfolders,
      runScan,
      scheduleAnalysis,
      setActiveScanFolderIds,
      setRollbackFolderIds,
    ],
  );

  const handleFolderCancelled = useCallback(
    (folderId: number) => {
      log.info("Folder add rollback/cancelled", { folderId });
      removeSelectedFolder(folderId);
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
      // 폴더 롤백 시 예약된 분석 타이머를 취소하여 불필요한 해시 계산 방지
      if (analyzeTimerRef.current) {
        clearTimeout(analyzeTimerRef.current);
        analyzeTimerRef.current = null;
      }
    },
    [
      analyzeTimerRef,
      removeSelectedFolder,
      setActiveScanFolderIds,
      setRollbackFolderIds,
    ],
  );

  const handleFolderRemoved = useCallback(
    (folderId: number) => {
      log.info("Folder removed", { folderId });
      removeSelectedFolder(folderId);
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
      scheduleAnalysis(500);
      void runScan();
    },
    [
      removeSelectedFolder,
      runScan,
      scheduleAnalysis,
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
          void refreshSubfolders([folderId]);
          scheduleAnalysis(0);
        }
      });
    },
    [
      isAnalyzing,
      refreshSubfolders,
      runScan,
      scanningRef,
      scheduleAnalysis,
      setActiveScanFolderIds,
    ],
  );

  return {
    handleFolderAdded,
    handleFoldersAdded,
    handleFolderCancelled,
    handleFolderRemoved,
    handleFolderRescan,
  };
}
