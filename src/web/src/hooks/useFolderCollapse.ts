import { useCallback, useState } from "react";

const COLLAPSE_STATE_KEY = "konomi-folder-collapse-state";

function readCollapsedIds(): Set<number> {
  try {
    const raw = localStorage.getItem(COLLAPSE_STATE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is number => Number.isInteger(id)));
  } catch {
    return new Set();
  }
}

function writeCollapsedIds(ids: Set<number>): void {
  try {
    localStorage.setItem(COLLAPSE_STATE_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore storage errors
  }
}

export function useFolderCollapse() {
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<number>>(
    () => readCollapsedIds(),
  );

  const toggleCollapse = useCallback((id: number) => {
    setCollapsedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeCollapsedIds(next);
      return next;
    });
  }, []);

  return { collapsedFolderIds, toggleCollapse };
}
