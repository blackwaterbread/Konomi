import { useCallback, useEffect, useState } from "react";

const SELECTED_FOLDERS_STORAGE_KEY = "konomi-selected-folders";

function readSelectedFolderIds(): Set<number> {
  try {
    const stored = localStorage.getItem(SELECTED_FOLDERS_STORAGE_KEY);
    return stored ? new Set<number>(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

export function useFolderSelection() {
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<number>>(() =>
    readSelectedFolderIds(),
  );

  useEffect(() => {
    localStorage.setItem(
      SELECTED_FOLDERS_STORAGE_KEY,
      JSON.stringify([...selectedFolderIds]),
    );
  }, [selectedFolderIds]);

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

  return {
    selectedFolderIds,
    toggleFolder,
    toggleFolderWithCascade,
    addSelectedFolder,
    removeSelectedFolder,
  };
}
