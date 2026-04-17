import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import type { Folder } from "@preload/index.d";
import i18n from "@/lib/i18n";
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

export function useFolders(initialFolders?: Folder[] | null) {
  const [folders, setFolders] = useState<Folder[]>(() =>
    initialFolders ? applyFolderOrder(initialFolders) : [],
  );
  const [hasLoaded, setHasLoaded] = useState(!!initialFolders);

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
        i18n.t("error.folderListLoadFailed", {
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setHasLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (initialFolders) return;
    load();
  }, [initialFolders, load]);

  const addFolder = useCallback(
    async (name: string, path: string) => {
      log.info("Creating folder", { name, path });
      const folder = await window.folder.create(name, path);
      await load();
      return folder;
    },
    [load],
  );

  const addFolders = useCallback(
    async (
      paths: string[],
    ): Promise<{
      added: Folder[];
      errors: { path: string; message: string }[];
    }> => {
      const added: Folder[] = [];
      const errors: { path: string; message: string }[] = [];
      for (const folderPath of paths) {
        const name =
          folderPath.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ||
          folderPath;
        try {
          log.info("Creating folder (batch)", { name, path: folderPath });
          const folder = await window.folder.create(name, folderPath);
          added.push(folder);
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          log.warn("Failed to add folder (batch)", {
            path: folderPath,
            error: message,
          });
          errors.push({ path: folderPath, message });
        }
      }
      if (added.length > 0) await load();
      return { added, errors };
    },
    [load],
  );

  const removeFolder = useCallback(
    async (id: number) => {
      log.info("Removing folder", { id });
      await window.folder.delete(id);
      await load();
    },
    [load],
  );

  const renameFolder = useCallback(
    async (id: number, name: string) => {
      log.info("Renaming folder", { id, name });
      await window.folder.rename(id, name);
      await load();
    },
    [load],
  );

  const reorderFolders = useCallback((ids: number[]) => {
    setFolders((prev) => applyFolderOrder(prev, ids));
  }, []);

  return {
    folders,
    hasLoaded,
    addFolder,
    addFolders,
    removeFolder,
    renameFolder,
    reorderFolders,
  };
}
