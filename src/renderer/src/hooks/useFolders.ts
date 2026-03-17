import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import type { Folder } from "@preload/index.d";
import { createLogger } from "@/lib/logger";

const log = createLogger("renderer/useFolders");
const FOLDER_ORDER_STORAGE_KEY = "konomi-folder-order";

function readFolderOrder(): number[] {
  try {
    const raw = localStorage.getItem(FOLDER_ORDER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is number => Number.isInteger(id));
  } catch {
    return [];
  }
}

function writeFolderOrder(ids: number[]): void {
  try {
    localStorage.setItem(FOLDER_ORDER_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // ignore storage errors
  }
}

function applyFolderOrder(
  folders: Folder[],
  preferredOrder?: number[],
): Folder[] {
  const order = preferredOrder ?? readFolderOrder();
  const folderMap = new Map(folders.map((folder) => [folder.id, folder]));
  const ordered: Folder[] = [];

  for (const id of order) {
    const folder = folderMap.get(id);
    if (!folder) continue;
    ordered.push(folder);
    folderMap.delete(id);
  }

  const remaining = folders.filter((folder) => folderMap.has(folder.id));
  const normalized = [...ordered, ...remaining];
  writeFolderOrder(normalized.map((folder) => folder.id));
  return normalized;
}

export function useFolders() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      log.debug("Loading folder list");
      const data = await window.folder.list();
      setFolders(applyFolderOrder(data));
      log.debug("Folder list loaded", { count: data.length });
    } catch (e: unknown) {
      log.error("Failed to load folder list", {
        error: e instanceof Error ? e.message : String(e),
      });
      toast.error(
        `폴더 목록 로드 실패: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setHasLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addFolder = async (name: string, path: string) => {
    log.info("Creating folder", { name, path });
    const folder = await window.folder.create(name, path);
    await load();
    return folder;
  };

  const removeFolder = async (id: number) => {
    log.info("Removing folder", { id });
    await window.folder.delete(id);
    await load();
  };

  const renameFolder = async (id: number, name: string) => {
    log.info("Renaming folder", { id, name });
    await window.folder.rename(id, name);
    await load();
  };

  const reorderFolders = useCallback((ids: number[]) => {
    setFolders((prev) => applyFolderOrder(prev, ids));
  }, []);

  return {
    folders,
    hasLoaded,
    addFolder,
    removeFolder,
    renameFolder,
    reorderFolders,
  };
}
