import { useCallback, useState } from "react";
import { useFolderSelection } from "@/hooks/useFolderSelection";

export function useSidebarFolders(initialFolderCount: number | null = null) {
  const {
    selectedFolderIds,
    toggleFolder,
    addSelectedFolder,
    removeSelectedFolder,
  } = useFolderSelection();
  const [folderCount, setFolderCount] = useState<number | null>(
    initialFolderCount,
  );
  const [folderDialogRequest, setFolderDialogRequest] = useState(0);

  const requestFolderDialog = useCallback(() => {
    setFolderDialogRequest((request) => request + 1);
  }, []);

  return {
    selectedFolderIds,
    toggleFolder,
    addSelectedFolder,
    removeSelectedFolder,
    folderCount,
    setFolderCount,
    folderDialogRequest,
    requestFolderDialog,
  };
}
