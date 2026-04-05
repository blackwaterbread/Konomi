import { useCallback, useEffect, useMemo } from "react";
import type { Folder } from "@preload/index.d";
import { useFolders } from "@/hooks/useFolders";
import { useFolderSelection } from "@/hooks/useFolderSelection";
import { useFolderCollapse } from "@/hooks/useFolderCollapse";
import { useSubfolderState } from "@/hooks/useSubfolderState";

export function useFolderController(
  initialFolderCount: number | null = null,
  initialFolders: Folder[] | null = null,
) {
  const {
    folders,
    hasLoaded,
    addFolder,
    addFolders,
    removeFolder,
    renameFolder,
    reorderFolders,
  } = useFolders(initialFolders);
  const {
    selectedFolderIds,
    toggleFolder,
    toggleFolderWithCascade,
    addSelectedFolder,
    removeSelectedFolder,
  } = useFolderSelection();
  const { collapsedFolderIds, toggleCollapse } = useFolderCollapse();
  const {
    subfolderReady,
    subfoldersByFolder,
    isSubfolderVisible,
    isRootVisible,
    hasSubfolderOverrides,
    toggleSubfolder,
    toggleRoot,
    setFolderSubfoldersVisible,
    clearFolderSubfolders,
    seedSubfolders,
    refreshSubfolders,
    loadSubfolders,
    subfolderFilters,
  } = useSubfolderState();

  const folderCount = hasLoaded ? folders.length : initialFolderCount;
  // Gallery can start loading once subfolder state is known.
  // Ready immediately when there are no folders (nothing to refresh).
  const galleryReady = subfolderReady || (hasLoaded && folders.length === 0);

  // Load subfolders for all folders on mount and when folder list changes
  useEffect(() => {
    if (!hasLoaded || folders.length === 0) return;
    void refreshSubfolders(folders.map((f) => f.id));
  }, [hasLoaded, folders, refreshSubfolders]);

  // A folder is "partial" when it's OFF in selectedFolderIds but has at least
  // one visible subfolder (or root visible while some subfolders are off).
  const isFolderPartial = useCallback(
    (id: number): boolean => {
      const subs = subfoldersByFolder.get(id) ?? [];
      if (subs.length === 0) return false;

      const isOn = selectedFolderIds.has(id);
      if (isOn) {
        // Parent ON but some children deselected → partial
        const anyChildOff = subs.some((s) => !isSubfolderVisible(s.path, id));
        const rootOff = !isRootVisible(id);
        return anyChildOff || rootOff;
      } else {
        // Parent OFF — only partial if user has explicitly toggled subfolders
        // (deselected map has entries). Without overrides, default visibility
        // is "true" which would incorrectly make every OFF folder look partial.
        if (!hasSubfolderOverrides(id)) return false;
        const anyChildOn = subs.some((s) => isSubfolderVisible(s.path, id));
        const rootOn = isRootVisible(id);
        return anyChildOn || rootOn;
      }
    },
    [
      subfoldersByFolder,
      selectedFolderIds,
      isSubfolderVisible,
      isRootVisible,
      hasSubfolderOverrides,
    ],
  );

  // Effective folder IDs for gallery query: includes partial folders
  // so their visible subfolders' images still show up.
  const effectiveFolderIds = useMemo(() => {
    const ids = new Set(selectedFolderIds);
    for (const folder of folders) {
      if (!ids.has(folder.id) && isFolderPartial(folder.id)) {
        ids.add(folder.id);
      }
    }
    return ids;
  }, [selectedFolderIds, folders, isFolderPartial]);

  const toggleFolderVisible = useCallback(
    (id: number) => {
      const subfolders = subfoldersByFolder.get(id) ?? [];
      if (subfolders.length > 0) {
        const isOn = selectedFolderIds.has(id);
        const partial = isFolderPartial(id);
        // Partial or OFF → turn everything ON; ON (fully) → turn everything OFF
        const willBeOn = !isOn || partial;
        if (willBeOn) {
          if (!selectedFolderIds.has(id)) toggleFolderWithCascade(id, []);
          setFolderSubfoldersVisible(id, true);
        } else {
          toggleFolderWithCascade(id, []);
          setFolderSubfoldersVisible(id, false);
        }
      } else {
        toggleFolder(id);
      }
    },
    [
      subfoldersByFolder,
      selectedFolderIds,
      isFolderPartial,
      toggleFolderWithCascade,
      toggleFolder,
      setFolderSubfoldersVisible,
    ],
  );

  // Auto-promote: when all subfolder overrides are cleared (user turned
  // everything back on) while parent is OFF, auto-select the parent.
  useEffect(() => {
    for (const folder of folders) {
      if (selectedFolderIds.has(folder.id)) continue;
      const subs = subfoldersByFolder.get(folder.id) ?? [];
      if (subs.length === 0) continue;
      if (!hasSubfolderOverrides(folder.id)) continue;
      // Has overrides but all are visible → promote
      const allChildOn = subs.every((s) =>
        isSubfolderVisible(s.path, folder.id),
      );
      const rootOn = isRootVisible(folder.id);
      if (allChildOn && rootOn) {
        addSelectedFolder(folder.id);
        setFolderSubfoldersVisible(folder.id, true);
      }
    }
  }, [
    folders,
    selectedFolderIds,
    subfoldersByFolder,
    hasSubfolderOverrides,
    isSubfolderVisible,
    isRootVisible,
    addSelectedFolder,
    setFolderSubfoldersVisible,
  ]);

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
    effectiveFolderIds,
    isFolderPartial,
    toggleFolder: toggleFolderVisible,
    addSelectedFolder,
    removeSelectedFolder,
    folderCount,
    collapsedFolderIds,
    toggleCollapse,
    subfoldersByFolder,
    isSubfolderVisible,
    isRootVisible,
    toggleSubfolder,
    toggleRoot,
    seedSubfolders,
    refreshSubfolders,
    loadSubfolders,
    subfolderFilters,
    galleryReady,
  };
}
