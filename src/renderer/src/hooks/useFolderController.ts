import { useMemo, useCallback } from "react";
import { useFolders } from "@/hooks/useFolders";
import { useFolderSelection } from "@/hooks/useFolderSelection";
import { useFolderCollapse } from "@/hooks/useFolderCollapse";
import {
  buildFolderTree,
  findNodeById,
  getAllDescendantIds,
} from "@/lib/folder-tree";

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
    toggleFolderWithCascade,
    addSelectedFolder,
    removeSelectedFolder,
  } = useFolderSelection();
  const { collapsedFolderIds, toggleCollapse } = useFolderCollapse();

  const folderCount = hasLoaded ? folders.length : initialFolderCount;

  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);

  const toggleFolderVisible = useCallback(
    (id: number) => {
      const node = findNodeById(folderTree, id);
      const descendantIds = node ? getAllDescendantIds(node) : [];
      if (descendantIds.length > 0) {
        toggleFolderWithCascade(id, descendantIds);
      } else {
        toggleFolder(id);
      }
    },
    [folderTree, toggleFolder, toggleFolderWithCascade],
  );

  return {
    folders,
    hasLoaded,
    addFolder,
    removeFolder,
    renameFolder,
    reorderFolders,
    selectedFolderIds,
    toggleFolder: toggleFolderVisible,
    addSelectedFolder,
    removeSelectedFolder,
    folderCount,
    folderTree,
    collapsedFolderIds,
    toggleCollapse,
  };
}
