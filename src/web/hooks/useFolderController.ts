import { useCallback, useEffect, useMemo, useRef } from "react";
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
    isolateFolder,
    selectFolders,
    initializeIfNeeded: initializeSelectionIfNeeded,
  } = useFolderSelection();
  const { collapsedFolderIds, toggleCollapse } = useFolderCollapse();
  const {
    subfolderReady,
    subfoldersByFolder,
    isSubfolderVisible,
    isRootVisible,
    hasSubfolderOverrides,
    hasAnyOverrides,
    clearAllOverrides,
    toggleSubfolder,
    toggleRoot,
    setFolderSubfoldersVisible,
    setOnlySubfolderVisible,
    clearFolderSubfolders,
    seedSubfolders,
    refreshSubfolders,
    loadSubfolders,
    subfolderFilters,
    collapsedSubfolderPaths,
    toggleSubfolderCollapse,
  } = useSubfolderState();

  const folderCount = hasLoaded ? folders.length : initialFolderCount;
  // Gallery can start loading once subfolder state is known.
  // Ready immediately when there are no folders (nothing to refresh).
  const galleryReady = subfolderReady || (hasLoaded && folders.length === 0);

  // Explicit initialization — called once from App's mount orchestrator.
  // Replaces the old useEffect(hasLoaded → refreshSubfolders) chain.
  const initCalledRef = useRef(false);
  const initialize = useCallback(async () => {
    if (initCalledRef.current) return;
    initCalledRef.current = true;
    if (folders.length > 0) {
      initializeSelectionIfNeeded(folders.map((f) => f.id));
      await refreshSubfolders(folders.map((f) => f.id));
    }
  }, [folders, refreshSubfolders, initializeSelectionIfNeeded]);

  // Fallback: when useFolders loads asynchronously (no initialFolders),
  // we still need to trigger subfolder loading once folders are available.
  const asyncInitFiredRef = useRef(!!initialFolders);
  useEffect(() => {
    if (asyncInitFiredRef.current) return;
    if (!hasLoaded || folders.length === 0) return;
    asyncInitFiredRef.current = true;
    initCalledRef.current = true;
    initializeSelectionIfNeeded(folders.map((f) => f.id));
    void refreshSubfolders(folders.map((f) => f.id));
  }, [hasLoaded, folders, refreshSubfolders, initializeSelectionIfNeeded]);

  // A folder is "partial" when it's OFF in selectedFolderIds but has at least
  // one visible subfolder (or root visible while some subfolders are off).
  const isFolderPartial = useCallback(
    (id: number): boolean => {
      const subs = subfoldersByFolder.get(id) ?? [];
      if (subs.length === 0) return false;

      const isOn = selectedFolderIds.has(id);
      if (isOn) {
        // Parent ON but some children deselected ��� partial
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
  // This is a legitimate reactive effect — responds to user-driven state changes.
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

  const isolateFolderVisible = useCallback(
    (id: number) => {
      isolateFolder(id);
      for (const folder of folders) {
        setFolderSubfoldersVisible(folder.id, folder.id === id);
      }
    },
    [isolateFolder, folders, setFolderSubfoldersVisible],
  );

  const isFolderVisibilityDefault = useMemo(() => {
    if (folders.length === 0) return true;
    if (hasAnyOverrides) return false;
    for (const folder of folders) {
      if (!selectedFolderIds.has(folder.id)) return false;
    }
    return true;
  }, [folders, selectedFolderIds, hasAnyOverrides]);

  const resetFolderVisibility = useCallback(() => {
    selectFolders(folders.map((f) => f.id));
    clearAllOverrides();
  }, [folders, selectFolders, clearAllOverrides]);

  const isolateSubfolderVisible = useCallback(
    (folderId: number, subfolderPath: string) => {
      isolateFolder(folderId);
      for (const folder of folders) {
        if (folder.id !== folderId) {
          setFolderSubfoldersVisible(folder.id, false);
        }
      }
      setOnlySubfolderVisible(folderId, subfolderPath);
    },
    [isolateFolder, folders, setFolderSubfoldersVisible, setOnlySubfolderVisible],
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
    isolateFolder: isolateFolderVisible,
    isolateSubfolder: isolateSubfolderVisible,
    isFolderVisibilityDefault,
    resetFolderVisibility,
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
    collapsedSubfolderPaths,
    toggleSubfolderCollapse,
    galleryReady,
    initialize,
  };
}
