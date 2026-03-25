import { useCallback, useEffect } from "react";
import { useFolders } from "@/hooks/useFolders";
import { useFolderSelection } from "@/hooks/useFolderSelection";
import { useFolderCollapse } from "@/hooks/useFolderCollapse";
import { useSubfolderState } from "@/hooks/useSubfolderState";

export function useFolderController(initialFolderCount: number | null = null) {
  const {
    folders,
    hasLoaded,
    addFolder,
    addFolders,
    removeFolder,
    renameFolder,
    reorderFolders,
  } = useFolders();
  const {
    selectedFolderIds,
    toggleFolder,
    toggleFolderWithCascade,
    addSelectedFolder,
    removeSelectedFolder,
  } = useFolderSelection();
  const { collapsedFolderIds, toggleCollapse } = useFolderCollapse();
  const {
    subfoldersByFolder,
    isSubfolderVisible,
    toggleSubfolder,
    setFolderSubfoldersVisible,
    clearFolderSubfolders,
    refreshSubfolders,
    loadSubfolders,
    subfolderFilters,
  } = useSubfolderState();

  const folderCount = hasLoaded ? folders.length : initialFolderCount;

  // Load subfolders for all folders on mount and when folder list changes
  useEffect(() => {
    if (!hasLoaded || folders.length === 0) return;
    void refreshSubfolders(folders.map((f) => f.id));
  }, [hasLoaded, folders, refreshSubfolders]);

  const toggleFolderVisible = useCallback(
    (id: number) => {
      const subfolders = subfoldersByFolder.get(id) ?? [];
      const descendantIds = subfolders.map((s) => s.path);
      if (descendantIds.length > 0) {
        const willBeOn = !selectedFolderIds.has(id);
        toggleFolderWithCascade(id, []);
        setFolderSubfoldersVisible(id, willBeOn);
      } else {
        toggleFolder(id);
      }
    },
    [
      subfoldersByFolder,
      selectedFolderIds,
      toggleFolderWithCascade,
      toggleFolder,
      setFolderSubfoldersVisible,
    ],
  );

  const removeFolderAndCleanup = useCallback(
    async (id: number) => {
      await removeFolder(id);
      clearFolderSubfolders(id);
    },
    [removeFolder, clearFolderSubfolders],
  );

  return {
    folders,
    hasLoaded,
    addFolder,
    addFolders,
    removeFolder: removeFolderAndCleanup,
    renameFolder,
    reorderFolders,
    selectedFolderIds,
    toggleFolder: toggleFolderVisible,
    addSelectedFolder,
    removeSelectedFolder,
    folderCount,
    collapsedFolderIds,
    toggleCollapse,
    subfoldersByFolder,
    isSubfolderVisible,
    toggleSubfolder,
    refreshSubfolders,
    loadSubfolders,
    subfolderFilters,
  };
}
