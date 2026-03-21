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

  const incrementFolderCount = useCallback(() => {
    setFolderCount((count) => (count === null ? count : count + 1));
  }, []);

  const decrementFolderCount = useCallback(() => {
    setFolderCount((count) => {
      if (count === null) return count;
      return Math.max(0, count - 1);
    });
  }, []);

  return {
    selectedFolderIds,
    toggleFolder,
    addSelectedFolder,
    removeSelectedFolder,
    folderCount,
    incrementFolderCount,
    decrementFolderCount,
  };
}
