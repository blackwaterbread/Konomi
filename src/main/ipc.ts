import { app, ipcMain, dialog, shell } from "electron";
import { checkForUpdates, installUpdate } from "./lib/updater";
import fs from "fs";
import path from "path";
import { unlink, readFile } from "fs/promises";
import { readImageMeta, readImageMetaFromBuffer } from "./lib/nai";
import {
  PROMPTS_DB_FILENAME,
  readPromptsDBSchemaVersion,
} from "./lib/prompts-db";
import { bridge } from "./bridge";
import { isManagedImagePath, registerTransientPath } from "./lib/path-guard";

async function assertManagedImagePath(filePath: string): Promise<void> {
  if (await isManagedImagePath(filePath)) return;
  throw new Error("허용되지 않은 이미지 경로입니다.");
}

export function registerIpcHandlers(): void {
  ipcMain.handle("app:getInfo", () => ({
    appName: app.getName(),
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? "unknown",
    chromeVersion: process.versions.chrome ?? "unknown",
    nodeVersion: process.versions.node ?? "unknown",
    platform: process.platform,
    arch: process.arch,
  }));
  ipcMain.handle("app:getLocale", () => {
    const preferred = app.getPreferredSystemLanguages?.()[0];
    return preferred || app.getLocale();
  });
  ipcMain.handle("app:getDbFileSize", () => {
    const dbPath = path.join(app.getPath("userData"), "konomi.db");
    try {
      const stat = fs.statSync(dbPath);
      return stat.isFile() ? stat.size : null;
    } catch {
      return null;
    }
  });
  ipcMain.handle("app:getPromptsDbSchemaVersion", () => {
    const dbPath = path.join(app.getPath("userData"), PROMPTS_DB_FILENAME);
    return readPromptsDBSchemaVersion(dbPath);
  });
  ipcMain.handle("app:checkForUpdates", () => checkForUpdates());
  ipcMain.handle("app:installUpdate", () => installUpdate());

  // ── File/system handlers (must stay in main process) ───────────────────────
  ipcMain.handle("readNaiMeta", async (_, filePath: string) => {
    await assertManagedImagePath(filePath);
    return readImageMeta(filePath);
  });
  ipcMain.handle("image:readMetaFromBuffer", (_, data: Uint8Array) => {
    const buf = Buffer.from(data);
    return readImageMetaFromBuffer(buf);
  });
  ipcMain.handle("image:readFile", async (_, filePath: string) => {
    await assertManagedImagePath(filePath);
    return readFile(filePath);
  });
  ipcMain.handle("selectDirectory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("selectDirectories", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "multiSelections"],
    });
    return result.canceled ? null : result.filePaths;
  });
  ipcMain.handle("image:revealInExplorer", async (_, path: string) => {
    await assertManagedImagePath(path);
    shell.showItemInFolder(path);
  });
  ipcMain.handle("image:delete", async (_, path: string) => {
    await assertManagedImagePath(path);
    try {
      await shell.trashItem(path);
    } catch {
      await unlink(path);
    }
  });

  // ── Utility process bridge handlers ────────────────────────────────────────
  ipcMain.handle("folder:list", () => bridge.request("folder:list"));
  ipcMain.handle("folder:create", (_, name: string, path: string) =>
    bridge.request("folder:create", { name, path }),
  );
  ipcMain.handle("folder:findDuplicates", (_, path: string) =>
    bridge.request("folder:findDuplicates", { path }, 0),
  );
  ipcMain.handle(
    "folder:resolveDuplicates",
    (
      _,
      resolutions: Array<{
        id: string;
        hash: string;
        existingEntries: Array<{ imageId: number; path: string }>;
        incomingPaths: string[];
        keep: "existing" | "incoming" | "ignore";
      }>,
    ) => bridge.request("folder:resolveDuplicates", { resolutions }),
  );
  ipcMain.handle("folder:delete", (_, id: number) =>
    bridge.request("folder:delete", { id }),
  );
  ipcMain.handle("folder:rename", (_, id: number, name: string) =>
    bridge.request("folder:rename", { id, name }),
  );
  ipcMain.handle("folder:listSubdirectories", (_, id: number) =>
    bridge.request("folder:listSubdirectories", { id }),
  );
  ipcMain.handle("folder:revealInExplorer", async (_, id: number) => {
    const folders = (await bridge.request("folder:list")) as Array<{
      id: number;
      path: string;
    }>;
    const folder = folders.find((item) => item.id === id);
    if (!folder) {
      throw new Error("Folder not found");
    }
    const result = await shell.openPath(folder.path);
    if (result) {
      throw new Error(result);
    }
  });

  ipcMain.handle("image:list", () => bridge.request("image:list"));
  ipcMain.handle("image:getSearchPresetStats", () =>
    bridge.request("image:getSearchPresetStats"),
  );
  ipcMain.handle(
    "image:suggestTags",
    (
      _,
      query: {
        prefix: string;
        limit?: number;
        exclude?: string[];
      },
    ) => bridge.request("image:suggestTags", query),
  );
  ipcMain.handle(
    "image:listPage",
    (
      _,
      query: {
        page?: number;
        pageSize?: number;
        folderIds?: number[];
        searchQuery?: string;
        sortBy?: "recent" | "oldest" | "favorites" | "name";
        onlyRecent?: boolean;
        recentDays?: number;
        customCategoryId?: number | null;
        builtinCategory?: "favorites" | "random" | null;
        randomSeed?: number;
        resolutionFilters?: Array<{ width: number; height: number }>;
        modelFilters?: string[];
        seedFilters?: number[];
        excludeTags?: string[];
      },
    ) => bridge.request("image:listPage", query),
  );
  ipcMain.handle(
    "image:listMatching",
    (
      _,
      query: {
        page?: number;
        pageSize?: number;
        folderIds?: number[];
        searchQuery?: string;
        sortBy?: "recent" | "oldest" | "favorites" | "name";
        onlyRecent?: boolean;
        recentDays?: number;
        customCategoryId?: number | null;
        builtinCategory?: "favorites" | "random" | null;
        randomSeed?: number;
        resolutionFilters?: Array<{ width: number; height: number }>;
        modelFilters?: string[];
        seedFilters?: number[];
        excludeTags?: string[];
      },
    ) => bridge.request("image:listMatching", query),
  );
  ipcMain.handle("image:listByIds", (_, ids: number[]) =>
    bridge.request("image:listByIds", { ids }),
  );
  ipcMain.handle(
    "image:scan",
    (
      _,
      options?: {
        detectDuplicates?: boolean;
        folderIds?: number[];
        orderedFolderIds?: number[];
      },
    ) => bridge.request("image:scan", options ?? {}, 0),
  );
  ipcMain.handle("image:cancelScan", () => bridge.request("image:cancelScan"));
  ipcMain.handle("image:setFavorite", (_, id: number, isFavorite: boolean) =>
    bridge.request("image:setFavorite", { id, isFavorite }),
  );
  ipcMain.handle("image:watch", () => bridge.request("image:watch"));
  ipcMain.handle("image:listIgnoredDuplicates", () =>
    bridge.request("image:listIgnoredDuplicates"),
  );
  ipcMain.handle("image:clearIgnoredDuplicates", () =>
    bridge.request("image:clearIgnoredDuplicates"),
  );

  ipcMain.handle("prompt:listCategories", () =>
    bridge.request("prompt:listCategories"),
  );
  ipcMain.handle("prompt:createCategory", (_, name: string) =>
    bridge.request("prompt:createCategory", { name }),
  );
  ipcMain.handle("prompt:renameCategory", (_, id: number, name: string) =>
    bridge.request("prompt:renameCategory", { id, name }),
  );
  ipcMain.handle("prompt:deleteCategory", (_, id: number) =>
    bridge.request("prompt:deleteCategory", { id }),
  );
  ipcMain.handle("prompt:resetCategories", () =>
    bridge.request("prompt:resetCategories"),
  );
  ipcMain.handle("prompt:createGroup", (_, categoryId: number, name: string) =>
    bridge.request("prompt:createGroup", { categoryId, name }),
  );
  ipcMain.handle("prompt:deleteGroup", (_, id: number) =>
    bridge.request("prompt:deleteGroup", { id }),
  );
  ipcMain.handle("prompt:renameGroup", (_, id: number, name: string) =>
    bridge.request("prompt:renameGroup", { id, name }),
  );
  ipcMain.handle("prompt:createToken", (_, groupId: number, label: string) =>
    bridge.request("prompt:createToken", { groupId, label }),
  );
  ipcMain.handle("prompt:deleteToken", (_, id: number) =>
    bridge.request("prompt:deleteToken", { id }),
  );
  ipcMain.handle("prompt:reorderTokens", (_, groupId: number, ids: number[]) =>
    bridge.request("prompt:reorderTokens", { groupId, ids }),
  );
  ipcMain.handle(
    "prompt:suggestTags",
    (
      _,
      query: {
        prefix: string;
        limit?: number;
        exclude?: string[];
      },
    ) => bridge.request("prompt:suggestTags", query),
  );

  ipcMain.handle("image:computeHashes", () =>
    bridge.request("image:computeHashes", undefined, 0),
  );
  ipcMain.handle(
    "image:similarGroups",
    (_, threshold: number, jaccardThreshold?: number) =>
      bridge.request("image:similarGroups", { threshold, jaccardThreshold }, 0),
  );
  ipcMain.handle(
    "image:similarReasons",
    (
      _,
      imageId: number,
      candidateImageIds: number[],
      threshold: number,
      jaccardThreshold?: number,
    ) =>
      bridge.request("image:similarReasons", {
        imageId,
        candidateImageIds,
        threshold,
        jaccardThreshold,
      }),
  );
  ipcMain.handle("image:resetHashes", () =>
    bridge.request("image:resetHashes"),
  );

  ipcMain.handle("category:list", () => bridge.request("category:list"));
  ipcMain.handle("category:create", (_, name: string) =>
    bridge.request("category:create", { name }),
  );
  ipcMain.handle("category:delete", (_, id: number) =>
    bridge.request("category:delete", { id }),
  );
  ipcMain.handle("category:rename", (_, id: number, name: string) =>
    bridge.request("category:rename", { id, name }),
  );
  ipcMain.handle(
    "category:addImage",
    (_, imageId: number, categoryId: number) =>
      bridge.request("category:addImage", { imageId, categoryId }),
  );
  ipcMain.handle(
    "category:removeImage",
    (_, imageId: number, categoryId: number) =>
      bridge.request("category:removeImage", { imageId, categoryId }),
  );
  ipcMain.handle(
    "category:addImages",
    (_, imageIds: number[], categoryId: number) =>
      bridge.request("category:addImages", { imageIds, categoryId }),
  );
  ipcMain.handle(
    "category:removeImages",
    (_, imageIds: number[], categoryId: number) =>
      bridge.request("category:removeImages", { imageIds, categoryId }),
  );
  ipcMain.handle(
    "category:addByPrompt",
    (_, categoryId: number, query: string) =>
      bridge.request("category:addByPrompt", { categoryId, query }),
  );
  ipcMain.handle("category:imageIds", (_, categoryId: number) =>
    bridge.request("category:imageIds", { categoryId }),
  );
  ipcMain.handle("category:forImage", (_, imageId: number) =>
    bridge.request("category:forImage", { imageId }),
  );
  ipcMain.handle("category:commonForImages", (_, imageIds: number[]) =>
    bridge.request("category:commonForImages", { imageIds }),
  );

  ipcMain.handle("nai:validateApiKey", (_, apiKey: string) =>
    bridge.request("nai:validateApiKey", apiKey),
  );
  ipcMain.handle("nai:getConfig", () => bridge.request("nai:getConfig"));
  ipcMain.handle("nai:updateConfig", (_, patch) =>
    bridge.request("nai:updateConfig", patch),
  );
  ipcMain.handle("nai:generate", async (_, params) => {
    const generatedPath = await bridge.request<string>("nai:generate", params);
    await registerTransientPath(generatedPath);
    return generatedPath;
  });
}
