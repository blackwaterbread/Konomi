import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { createLogger } from "@/lib/logger";
import { subfolderKey } from "@/hooks/useSubfolderState";

const log = createLogger("renderer/useSidebarFolderActions");

interface RunScanOptions {
  detectDuplicates?: boolean;
  folderIds?: number[];
  subPaths?: string[];
  refreshPage?: boolean;
  refreshSearchPresetStats?: boolean;
}

interface UseSidebarFolderActionsOptions {
  isAnalyzing: boolean;
  addSelectedFolder: (id: number) => void;
  removeSelectedFolder: (id: number) => void;
  runScan: (
    options?: RunScanOptions,
  ) => Promise<{ ok: boolean; cancelled: boolean }>;
  scanningRef: MutableRefObject<boolean>;
  setActiveScanFolderIds: Dispatch<SetStateAction<Set<number>>>;
  setActiveScanSubPaths: Dispatch<SetStateAction<Set<string>>>;
  setRollbackFolderIds: Dispatch<SetStateAction<Set<number>>>;
  refreshSubfolders: (folderIds: number[]) => Promise<void>;
}

// Auto-trigger of analysis after scan/rescan/folder-add lives in the core
// maintenance service (utility process or web server). These handlers only
// drive renderer-side UI state.
export function useSidebarFolderActions({
  isAnalyzing,
  addSelectedFolder,
  removeSelectedFolder,
  runScan,
  scanningRef,
  setActiveScanFolderIds,
  setActiveScanSubPaths,
  setRollbackFolderIds,
  refreshSubfolders,
}: UseSidebarFolderActionsOptions) {
  const handleFolderAdded = useCallback(
    (folderId: number) => {
      log.info("Folder added", { folderId });
      addSelectedFolder(folderId);
      setRollbackFolderIds((prev) => new Set([...prev, folderId]));
      setActiveScanFolderIds((prev) => new Set([...prev, folderId]));
      void runScan({ folderIds: [folderId], detectDuplicates: true }).then(
        ({ ok, cancelled }) => {
          if (!ok || cancelled) return;
          void refreshSubfolders([folderId]);
          setRollbackFolderIds((prev) => {
            const next = new Set(prev);
            next.delete(folderId);
            return next;
          });
        },
      );
    },
    [
      addSelectedFolder,
      refreshSubfolders,
      runScan,
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
      void runScan({ folderIds, detectDuplicates: true }).then(
        ({ ok, cancelled }) => {
          if (!ok || cancelled) return;
          void refreshSubfolders(folderIds);
          setRollbackFolderIds((prev) => {
            const next = new Set(prev);
            for (const id of folderIds) next.delete(id);
            return next;
          });
        },
      );
    },
    [
      addSelectedFolder,
      handleFolderAdded,
      refreshSubfolders,
      runScan,
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
    },
    [removeSelectedFolder, setActiveScanFolderIds, setRollbackFolderIds],
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
      void runScan();
    },
    [
      removeSelectedFolder,
      runScan,
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
      // `runScan` already refreshes the scanned folders' subfolder lists on
      // success, and with `allowEmpty` so a subtree that lost its last image
      // can actually disappear — a second pass here would re-fetch without it.
      void runScan({ folderIds: [folderId] });
    },
    [isAnalyzing, runScan, scanningRef, setActiveScanFolderIds],
  );

  const handleSubfolderRescan = useCallback(
    (folderId: number, subPath: string) => {
      if (scanningRef.current || isAnalyzing) return;
      log.info("Subfolder rescan requested", { folderId, subPath });
      // Optimistic spinner state: `image:scanFolder` echoes the requested
      // spelling back, so the event converges on the key set here.
      setActiveScanSubPaths((prev) => new Set([...prev, subfolderKey(subPath)]));
      setActiveScanFolderIds((prev) => new Set([...prev, folderId]));
      // `runScan` already refreshes the scanned folders' subfolder lists on
      // success, and with `allowEmpty` so a subtree that lost its last image
      // can actually disappear.
      void runScan({ folderIds: [folderId], subPaths: [subPath] });
    },
    [
      isAnalyzing,
      runScan,
      scanningRef,
      setActiveScanFolderIds,
      setActiveScanSubPaths,
    ],
  );

  return {
    handleFolderAdded,
    handleFoldersAdded,
    handleFolderCancelled,
    handleFolderRemoved,
    handleFolderRescan,
    handleSubfolderRescan,
  };
}
