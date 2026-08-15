import { useCallback, useMemo, useState } from "react";

export type Subfolder = {
  path: string;
  name: string;
  folderId: number;
  depth: number;
};

export type SubfolderFilter = {
  folderId: number;
  selectedPaths: string[];
  allPaths: string[];
  includeRoot: boolean;
};

const VISIBILITY_KEY = "konomi-subfolder-visibility";
const ROOT_SENTINEL = "__root__";

/**
 * The "no overrides" result, shared rather than rebuilt.
 *
 * `subfolderFilters` feeds a gallery query memo as a dependency, so a fresh
 * `[]` on every clear would re-run the query for a filter set that did not
 * change. This was a `useRef`, which meant reading `.current` during render —
 * something the React compiler cannot reason about. A module constant is
 * stable across every render *and* every hook instance, and the value is only
 * ever read.
 */
const NO_FILTERS: SubfolderFilter[] = [];

export function normalizeSubfolderPath(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * Comparison key for a subfolder path.
 *
 * Case is deliberately not folded: the renderer cannot know whether the backend
 * runs on a case-insensitive filesystem, and folding unconditionally would
 * merge two genuinely distinct subfolders on a case-sensitive one. It does not
 * need to — every subfolder path the sidebar handles comes from
 * `getSubfolderPaths`, which reports the on-disk spelling, and that is what the
 * scan walks and echoes back on `image:scanFolder`. Only separators and a
 * trailing one can still differ.
 */
export function subfolderKey(path: string): string {
  return normalizeSubfolderPath(path).replace(/\/+$/, "");
}

/**
 * Re-spells stored visibility overrides onto the paths the backend now reports.
 *
 * `getSubfolderPaths` used to lower-case its result on win32. The overrides
 * persisted under those folded spellings, so once it started reporting the
 * on-disk casing every hidden subfolder silently reappeared and the stale keys
 * stayed in localStorage forever.
 *
 * Case is matched here only as a repair against a known-good list, never as a
 * general comparison rule — `subfolderKey` still refuses to fold it, for the
 * reason documented there. An entry is rewritten solely when exactly one
 * reported path differs from it by case or separator alone; an ambiguous or
 * unrecognised entry is left untouched, because the list can be partial while a
 * scan is still running and dropping it would lose a real override.
 *
 * Returns `null` when nothing needed rewriting, so the common path does not
 * churn state.
 */
function remapDeselectedPaths(
  stored: Set<string>,
  knownPaths: string[],
): Set<string> | null {
  const exact = new Set(knownPaths);
  const byFoldedCase = new Map<string, string[]>();
  for (const p of knownPaths) {
    const folded = subfolderKey(p).toLowerCase();
    const bucket = byFoldedCase.get(folded) ?? [];
    bucket.push(p);
    byFoldedCase.set(folded, bucket);
  }

  let changed = false;
  const next = new Set<string>();
  for (const entry of stored) {
    if (entry === ROOT_SENTINEL || exact.has(entry)) {
      next.add(entry);
      continue;
    }
    const candidates = byFoldedCase.get(subfolderKey(entry).toLowerCase());
    if (candidates && candidates.length === 1) {
      next.add(candidates[0]);
      changed = true;
    } else {
      next.add(entry);
    }
  }
  return changed ? next : null;
}

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
  const [collapsedSubfolderPaths, setCollapsedSubfolderPaths] = useState<
    Set<string>
  >(new Set());

  const reconcileVisibilitySpelling = useCallback(
    (folderId: number, knownPaths: string[]) => {
      if (knownPaths.length === 0) return;
      setDeselected((prev) => {
        const stored = prev.get(folderId);
        if (!stored || stored.size === 0) return prev;
        const remapped = remapDeselectedPaths(stored, knownPaths);
        if (!remapped) return prev;
        const next = new Map(prev);
        next.set(folderId, remapped);
        writeDeselected(next);
        return next;
      });
    },
    [],
  );

  const loadSubfolders = useCallback(
    async (folderId: number) => {
      const entries = await window.folder.listSubdirectories(folderId);
      setSubfoldersByFolder((prev) => {
        // DB에 아직 이미지가 없으면 빈 배열이 돌아오는데,
        // 이미 seed된 데이터가 있으면 보존한다 (스캔 완료 후 다시 갱신됨)
        if (entries.length === 0 && (prev.get(folderId)?.length ?? 0) > 0) {
          return prev;
        }
        const next = new Map(prev);
        next.set(
          folderId,
          entries.map((e) => ({
            path: e.path,
            name: e.path.replace(/\\/g, "/").split("/").pop() ?? e.path,
            folderId,
            depth: e.depth,
          })),
        );
        return next;
      });
      reconcileVisibilitySpelling(
        folderId,
        entries.map((e) => e.path),
      );
    },
    [reconcileVisibilitySpelling],
  );

  const refreshSubfolders = useCallback(
    async (folderIds: number[], options?: { allowEmpty?: boolean }) => {
      const allowEmpty = options?.allowEmpty ?? false;
      const results = await Promise.all(
        folderIds.map(async (id) => {
          const entries = await window.folder.listSubdirectories(id);
          return { id, entries };
        }),
      );
      const disappearedPaths: string[] = [];
      setSubfoldersByFolder((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const { id, entries } of results) {
          // Initial load: preserve existing entries when DB returns empty
          // (scan still in progress). Image:removed callers pass allowEmpty
          // so the last subfolder can clear when its images are deleted.
          if (
            !allowEmpty &&
            entries.length === 0 &&
            (prev.get(id)?.length ?? 0) > 0
          ) {
            continue;
          }
          const prevPaths = prev.get(id)?.map((s) => s.path) ?? [];
          if (
            prevPaths.length === entries.length &&
            prevPaths.every((p, i) => p === entries[i].path)
          ) {
            continue;
          }
          changed = true;
          const incomingSet = new Set(
            entries.map((e) => normalizeSubfolderPath(e.path)),
          );
          for (const p of prevPaths) {
            const norm = normalizeSubfolderPath(p);
            if (!incomingSet.has(norm)) disappearedPaths.push(norm);
          }
          next.set(
            id,
            entries.map((e) => ({
              path: e.path,
              name: e.path.replace(/\\/g, "/").split("/").pop() ?? e.path,
              folderId: id,
              depth: e.depth,
            })),
          );
        }
        return changed ? next : prev;
      });
      for (const { id, entries } of results) {
        reconcileVisibilitySpelling(
          id,
          entries.map((e) => e.path),
        );
      }
      if (disappearedPaths.length > 0) {
        setCollapsedSubfolderPaths((prev) => {
          if (prev.size === 0) return prev;
          let changed = false;
          const next = new Set(prev);
          for (const p of disappearedPaths) {
            if (next.delete(p)) changed = true;
          }
          return changed ? next : prev;
        });
      }
      setSubfolderReady(true);
    },
    [reconcileVisibilitySpelling],
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
        const allPaths =
          subfoldersByFolder.get(folderId)?.map((s) => s.path) ?? [];
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
        // Seed callers currently only pass first-level directories; the
        // subsequent scan refresh overwrites this with the full tree
        // including real depth values from the backend.
        next.set(
          folderId,
          subdirs.map((s) => ({
            path: s.path,
            name: s.name,
            folderId,
            depth: 1,
          })),
        );
        return next;
      });
    },
    [],
  );

  const toggleSubfolderCollapse = useCallback((path: string) => {
    const normalized = normalizeSubfolderPath(path);
    setCollapsedSubfolderPaths((prev) => {
      const next = new Set(prev);
      if (next.has(normalized)) next.delete(normalized);
      else next.add(normalized);
      return next;
    });
  }, []);

  const clearFolderSubfolders = useCallback((folderId: number) => {
    let clearedPaths: string[] = [];
    setSubfoldersByFolder((prev) => {
      const removed = prev.get(folderId);
      if (removed) {
        clearedPaths = removed.map((s) => normalizeSubfolderPath(s.path));
      }
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
    if (clearedPaths.length > 0) {
      setCollapsedSubfolderPaths((prev) => {
        if (prev.size === 0) return prev;
        let changed = false;
        const next = new Set(prev);
        for (const p of clearedPaths) {
          if (next.delete(p)) changed = true;
        }
        return changed ? next : prev;
      });
    }
  }, []);

  const hasSubfolderOverrides = useCallback(
    (folderId: number) => (deselected.get(folderId)?.size ?? 0) > 0,
    [deselected],
  );

  const hasAnyOverrides = useMemo(() => deselected.size > 0, [deselected]);

  const clearAllOverrides = useCallback(() => {
    setDeselected((prev) => {
      if (prev.size === 0) return prev;
      writeDeselected(new Map());
      return new Map();
    });
  }, []);

  const subfolderFilters = useMemo<SubfolderFilter[]>(() => {
    if (deselected.size === 0) return NO_FILTERS;
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
  };
}
