import { useCallback, useEffect, useRef, useState } from "react";

const SELECTED_FOLDERS_STORAGE_KEY = "konomi-selected-folders";

function readStoredSelection(): Set<number> | null {
  try {
    const stored = localStorage.getItem(SELECTED_FOLDERS_STORAGE_KEY);
    if (stored === null) return null;
    return new Set<number>(JSON.parse(stored));
  } catch {
    return null;
  }
}

export function useFolderSelection() {
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<number>>(
    () => readStoredSelection() ?? new Set(),
  );
  // Distinguishes "first run, key absent" from "user has empty selection".
  // Auto-registered folders (Docker bootstrap) need a default-on selection;
  // we can't tell from an empty Set alone, so track key presence explicitly.
  const initializedRef = useRef<boolean>(
    localStorage.getItem(SELECTED_FOLDERS_STORAGE_KEY) !== null,
  );
  const [initialized, setInitialized] = useState<boolean>(
    initializedRef.current,
  );

  useEffect(() => {
    if (!initialized) return;
    localStorage.setItem(
      SELECTED_FOLDERS_STORAGE_KEY,
      JSON.stringify([...selectedFolderIds]),
    );
  }, [initialized, selectedFolderIds]);

  const initializeIfNeeded = useCallback((defaultIds: number[]) => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (defaultIds.length > 0) {
      setSelectedFolderIds(new Set(defaultIds));
    }
    setInitialized(true);
  }, []);

  const toggleFolder = useCallback((id: number) => {
    setSelectedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleFolderWithCascade = useCallback(
    (id: number, descendantIds: number[]) => {
      setSelectedFolderIds((prev) => {
        const next = new Set(prev);
        const willBeOn = !prev.has(id);
        if (willBeOn) next.add(id);
        else next.delete(id);
        for (const descId of descendantIds) {
          if (willBeOn) next.add(descId);
          else next.delete(descId);
        }
        return next;
      });
    },
    [],
  );

  const addSelectedFolder = useCallback((id: number) => {
    setSelectedFolderIds((prev) => new Set([...prev, id]));
  }, []);

  const removeSelectedFolder = useCallback((id: number) => {
    setSelectedFolderIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const isolateFolder = useCallback((id: number) => {
    setSelectedFolderIds(new Set([id]));
  }, []);

  const selectFolders = useCallback((ids: number[]) => {
    setSelectedFolderIds(new Set(ids));
  }, []);

  return {
    selectedFolderIds,
    toggleFolder,
    toggleFolderWithCascade,
    addSelectedFolder,
    removeSelectedFolder,
    isolateFolder,
    selectFolders,
    initializeIfNeeded,
  };
}
