import { useFolders } from "@/hooks/useFolders";
import { useFolderSelection } from "@/hooks/useFolderSelection";

export function useFolderController(initialFolderCount: number | null = null) {
  const {
    folders,
    hasLoaded,
    addFolder,
    removeFolder,
    renameFolder,
    reorderFolders,
  } = useFolders();
  const {
    selectedFolderIds,
    toggleFolder,
    addSelectedFolder,
    removeSelectedFolder,
  } = useFolderSelection();
  const folderCount = hasLoaded ? folders.length : initialFolderCount;

  return {
    folders,
    hasLoaded,
    addFolder,
    removeFolder,
    renameFolder,
    reorderFolders,
    selectedFolderIds,
    toggleFolder,
    addSelectedFolder,
    removeSelectedFolder,
    folderCount,
  };
}
