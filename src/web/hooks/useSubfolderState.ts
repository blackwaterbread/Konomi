import { useCallback, useMemo, useState } from "react";

export type Subfolder = {
  path: string;
  name: string;
  folderId: number;
};

export type SubfolderFilter = {
  folderId: number;
  selectedPaths: string[];
  allPaths: string[];
  includeRoot: boolean;
};

const VISIBILITY_KEY = "konomi-subfolder-visibility";
const ROOT_SENTINEL = "__root__";

function readDeselected(): Map<number, Set<string>> {
  try {
    const raw = localStorage.getItem(VISIBILITY_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    const map = new Map<number, Set<string>>();
    for (const [k, v] of Object.entries(parsed)) {
      if (Array.isArray(v)) map.set(Number(k), new Set(v));
    }
    return map;
  } catch {
    return new Map();
  }
}

function writeDeselected(map: Map<number, Set<string>>): void {
  try {
    const obj: Record<string, string[]> = {};
    for (const [k, v] of map) {
      if (v.size > 0) obj[String(k)] = [...v];
    }
    localStorage.setItem(VISIBILITY_KEY, JSON.stringify(obj));
  } catch {
    // ignore
  }
}

export function useSubfolderState() {
  const [subfolderReady, setSubfolderReady] = useState(false);
  const [subfoldersByFolder, setSubfoldersByFolder] = useState<
    Map<number, Subfolder[]>
  >(new Map());
  const [deselected, setDeselected] = useState<Map<number, Set<string>>>(() =>
    readDeselected(),
  );

  const loadSubfolders = useCallback(async (folderId: number) => {
    const paths = await window.folder.listSubdirectories(folderId);
    setSubfoldersByFolder((prev) => {
      // DB에 아직 이미지가 없으면 빈 배열이 돌아오는데,
      // 이미 seed된 데이터가 있으면 보존한다 (스캔 완료 후 다시 갱신됨)
      if (paths.length === 0 && (prev.get(folderId)?.length ?? 0) > 0) {
        return prev;
      }
      const next = new Map(prev);
      next.set(
        folderId,
        paths.map((p) => ({
          path: p,
          name: p.replace(/\\/g, "/").split("/").pop() ?? p,
          folderId,
        })),
      );
      return next;
    });
  }, []);

  const refreshSubfolders = useCallback(
    async (folderIds: number[], options?: { allowEmpty?: boolean }) => {
      const allowEmpty = options?.allowEmpty ?? false;
      const results = await Promise.all(
        folderIds.map(async (id) => {
          const paths = await window.folder.listSubdirectories(id);
          return { id, paths };
        }),
      );
      setSubfoldersByFolder((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const { id, paths } of results) {
          // Initial load: preserve existing entries when DB returns empty
          // (scan still in progress). Image:removed callers pass allowEmpty
          // so the last subfolder can clear when its images are deleted.
          if (
            !allowEmpty &&
            paths.length === 0 &&
            (prev.get(id)?.length ?? 0) > 0
          ) {
            continue;
          }
          changed = true;
          next.set(
            id,
            paths.map((p) => ({
              path: p,
              name: p.replace(/\\/g, "/").split("/").pop() ?? p,
              folderId: id,
            })),
          );
        }
        return changed ? next : prev;
      });
      setSubfolderReady(true);
    },
    [],
  );

  const isSubfolderVisible = useCallback(
    (subfolderPath: string, folderId: number) => {
      return !(deselected.get(folderId)?.has(subfolderPath) ?? false);
    },
    [deselected],
  );

  const isRootVisible = useCallback(
    (folderId: number) => {
      return !(deselected.get(folderId)?.has(ROOT_SENTINEL) ?? false);
    },
    [deselected],
  );

  const toggleRoot = useCallback((folderId: number) => {
    setDeselected((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(folderId));
      if (set.has(ROOT_SENTINEL)) set.delete(ROOT_SENTINEL);
      else set.add(ROOT_SENTINEL);
      if (set.size === 0) next.delete(folderId);
      else next.set(folderId, set);
      writeDeselected(next);
      return next;
    });
  }, []);

  const toggleSubfolder = useCallback(
    (subfolderPath: string, folderId: number) => {
      setDeselected((prev) => {
        const next = new Map(prev);
        const set = new Set(next.get(folderId));
        if (set.has(subfolderPath)) set.delete(subfolderPath);
        else set.add(subfolderPath);
        if (set.size === 0) next.delete(folderId);
        else next.set(folderId, set);
        writeDeselected(next);
        return next;
      });
    },
    [],
  );

  // Called when parent folder visibility is toggled (cascade)
  const setFolderSubfoldersVisible = useCallback(
    (folderId: number, visible: boolean) => {
      setDeselected((prev) => {
        const next = new Map(prev);
        if (visible) {
          next.delete(folderId);
        } else {
          const allPaths = subfoldersByFolder.get(folderId)?.map((s) => s.path);
          if (allPaths && allPaths.length > 0) {
            next.set(folderId, new Set([...allPaths, ROOT_SENTINEL]));
          }
        }
        writeDeselected(next);
        return next;
      });
    },
    [subfoldersByFolder],
  );

  // Hide every subfolder (and root) except the given subfolder path.
  const setOnlySubfolderVisible = useCallback(
    (folderId: number, subfolderPath: string) => {
      setDeselected((prev) => {
        const next = new Map(prev);
        const allPaths = subfoldersByFolder.get(folderId)?.map((s) => s.path) ?? [];
        const hidden = new Set<string>([ROOT_SENTINEL]);
        for (const p of allPaths) {
          if (p !== subfolderPath) hidden.add(p);
        }
        if (hidden.size === 0) next.delete(folderId);
        else next.set(folderId, hidden);
        writeDeselected(next);
        return next;
      });
    },
    [subfoldersByFolder],
  );

  const seedSubfolders = useCallback(
    (folderId: number, subdirs: { name: string; path: string }[]) => {
      if (subdirs.length === 0) return;
      setSubfoldersByFolder((prev) => {
        const next = new Map(prev);
        next.set(
          folderId,
          subdirs.map((s) => ({ path: s.path, name: s.name, folderId })),
        );
        return next;
      });
    },
    [],
  );

  const clearFolderSubfolders = useCallback((folderId: number) => {
    setSubfoldersByFolder((prev) => {
      const next = new Map(prev);
      next.delete(folderId);
      return next;
    });
    setDeselected((prev) => {
      if (!prev.has(folderId)) return prev;
      const next = new Map(prev);
      next.delete(folderId);
      writeDeselected(next);
      return next;
    });
  }, []);

  const hasSubfolderOverrides = useCallback(
    (folderId: number) => (deselected.get(folderId)?.size ?? 0) > 0,
    [deselected],
  );

  const subfolderFilters = useMemo<SubfolderFilter[]>(() => {
    const filters: SubfolderFilter[] = [];
    for (const [folderId, deselectedPaths] of deselected) {
      if (deselectedPaths.size === 0) continue;
      const allSubfolders = subfoldersByFolder.get(folderId) ?? [];
      if (allSubfolders.length === 0) continue;
      const allPaths = allSubfolders.map((s) => s.path);
      const selectedPaths = allPaths.filter((p) => !deselectedPaths.has(p));
      const includeRoot = !deselectedPaths.has(ROOT_SENTINEL);
      filters.push({ folderId, selectedPaths, allPaths, includeRoot });
    }
    return filters;
  }, [deselected, subfoldersByFolder]);

  return {
    subfolderReady,
    subfoldersByFolder,
    isSubfolderVisible,
    isRootVisible,
    hasSubfolderOverrides,
    toggleSubfolder,
    toggleRoot,
    setFolderSubfoldersVisible,
    setOnlySubfolderVisible,
    clearFolderSubfolders,
    seedSubfolders,
    refreshSubfolders,
    loadSubfolders,
    subfolderFilters,
  };
}
