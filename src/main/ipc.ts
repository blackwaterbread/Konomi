import { app, ipcMain, dialog, shell } from "electron";
import { checkForUpdates, installUpdate } from "./lib/updater";
import fs from "fs";
import path from "path";
import { readdir, unlink, readFile } from "fs/promises";
import { readImageMeta, readImageMetaFromBuffer } from "./lib/image-meta";
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

function isDevMode(): boolean {
  if (!app.isPackaged) {
    return true;
  }
  const launchArgs = process.argv.slice(1);
  return launchArgs.some((arg) => arg === "-d" || arg === "--dev");
}

export function registerIpcHandlers(): void {
  ipcMain.handle("app:isDevMode", () => isDevMode());
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
  ipcMain.handle(
    "image:bulkDelete",
    async (_, ids: number[]): Promise<{ deleted: number; failed: number }> => {
      const rows = await bridge.request("image:listByIds", { ids }) as Array<{ path: string }>;
      let deleted = 0;
      let failed = 0;
      const BATCH = 20;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          batch.map(async (row) => {
            await assertManagedImagePath(row.path);
            try {
              await shell.trashItem(row.path);
            } catch {
              await unlink(row.path);
            }
          }),
        );
        for (const r of results) {
          if (r.status === "fulfilled") deleted++;
          else failed++;
        }
      }
      return { deleted, failed };
    },
  );

  ipcMain.handle(
    "folder:listSubdirectoriesByPath",
    async (_, folderPath: string) => {
      try {
        const entries = await readdir(folderPath, { withFileTypes: true });
        return entries
          .filter((e) => e.isDirectory())
          .map((e) => ({
            name: e.name,
            path: path.join(folderPath, e.name),
          }));
      } catch {
        return [];
      }
    },
  );

  // ── Utility process bridge handlers ────────────────────────────────────────
  ipcMain.handle("db:runMigrations", () =>
    bridge.request("db:runMigrations"),
  );
  ipcMain.handle("folder:list", () => bridge.request("folder:list"));
  ipcMain.handle("folder:create", (_, name: string, path: string) =>
    bridge.request("folder:create", { name, path }),
  );
  ipcMain.handle("folder:findDuplicates", (_, path: string) =>
    bridge.request("folder:findDuplicates", { path }),
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
  ipcMain.handle("folder:stats", (_, id: number) =>
    bridge.request("folder:stats", { id }),
  );
  ipcMain.handle("folder:size", (_, id: number) =>
    bridge.request("folder:size", { id }),
  );
  // number: 상위 폴더 — DB에서 path 조회 후 열기
  // string: 하위 폴더 — path 직접 전달 (DB에 없으므로)
  // 이거 설계 꼭 이렇게 할 필요가 있었나? 클로드 이새키 진짜 패고싶다.
  ipcMain.handle(
    "folder:revealInExplorer",
    async (_, idOrPath: number | string) => {
      let targetPath: string;
      if (typeof idOrPath === "number") {
        const folders = (await bridge.request("folder:list")) as Array<{
          id: number;
          path: string;
        }>;
        const folder = folders.find((item) => item.id === idOrPath);
        if (!folder) {
          throw new Error("Folder not found");
        }
        targetPath = folder.path;
      } else {
        targetPath = idOrPath;
      }
      const result = await shell.openPath(targetPath);
      if (result) {
        throw new Error(result);
      }
    },
  );

  ipcMain.handle("image:getSearchPresetStats", () =>
    bridge.request("image:getSearchPresetStats", undefined),
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
    "image:listMatchingIds",
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
    ) => bridge.request("image:listMatchingIds", query),
  );
  ipcMain.handle("image:listByIds", (_, ids: number[]) =>
    bridge.request("image:listByIds", { ids }),
  );
  ipcMain.handle("image:quickVerify", () =>
    bridge.request("image:quickVerify", undefined),
  );
  ipcMain.handle(
    "image:scan",
    (
      _,
      options?: {
        detectDuplicates?: boolean;
        folderIds?: number[];
        orderedFolderIds?: number[];
        skipFolderIds?: number[];
      },
    ) => bridge.request("image:scan", options ?? {}),
  );
  ipcMain.handle("image:cancelScan", () => bridge.request("image:cancelScan"));
  ipcMain.handle("image:setFavorite", (_, id: number, isFavorite: boolean) =>
    bridge.request("image:setFavorite", { id, isFavorite }),
  );
  ipcMain.handle("image:watch", () => bridge.request("image:watch"));
  ipcMain.handle("image:listIgnoredDuplicates", () =>
    bridge.request("image:listIgnoredDuplicates", undefined),
  );
  ipcMain.handle("image:clearIgnoredDuplicates", () =>
    bridge.request("image:clearIgnoredDuplicates", undefined),
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
  ipcMain.handle(
    "prompt:reorderGroups",
    (_, categoryId: number, ids: number[]) =>
      bridge.request("prompt:reorderGroups", { categoryId, ids }),
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
  ipcMain.handle(
    "prompt:searchTags",
    (
      _,
      query: {
        name?: string;
        sortBy?: "name" | "count";
        order?: "asc" | "desc";
        page?: number;
        pageSize?: number;
      },
    ) => bridge.request("prompt:searchTags", query),
  );

  ipcMain.handle("image:computeHashes", () =>
    bridge.request("image:computeHashes", undefined),
  );
  ipcMain.handle(
    "image:similarGroups",
    (_, threshold: number, jaccardThreshold?: number) =>
      bridge.request("image:similarGroups", { threshold, jaccardThreshold }),
  );
  ipcMain.handle(
    "image:similarGroupForImage",
    (_, imageId: number) =>
      bridge.request("image:similarGroupForImage", { imageId }),
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
    bridge.request("image:resetHashes", undefined),
  );
  ipcMain.handle("image:rescanMetadata", () =>
    bridge.request("image:rescanMetadata", undefined),
  );
  ipcMain.handle("image:rescanImageMetadata", (_, paths: string[]) =>
    bridge.request("image:rescanImageMetadata", { paths }),
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
  ipcMain.handle("category:setColor", (_, id: number, color: string | null) =>
    bridge.request("category:setColor", { id, color }),
  );

  ipcMain.handle("nai:validateApiKey", (_, apiKey: string) =>
    bridge.request("nai:validateApiKey", apiKey),
  );
  ipcMain.handle("nai:getSubscription", () =>
    bridge.request("nai:getSubscription"),
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
