import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("appInfo", {
  get: () => ipcRenderer.invoke("app:getInfo"),
  getLocale: () => ipcRenderer.invoke("app:getLocale"),
  getDbFileSize: () => ipcRenderer.invoke("app:getDbFileSize"),
  getPromptsDbSchemaVersion: () =>
    ipcRenderer.invoke("app:getPromptsDbSchemaVersion"),
  checkForUpdates: () => ipcRenderer.invoke("app:checkForUpdates"),
  installUpdate: () => ipcRenderer.invoke("app:installUpdate"),
  onUpdateAvailable: (
    cb: (info: { version: string; releaseUrl?: string }) => void,
  ) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      info: { version: string; releaseUrl?: string },
    ) => cb(info);
    ipcRenderer.on("app:updateAvailable", handler);
    return () => ipcRenderer.removeListener("app:updateAvailable", handler);
  },
  onUpdateDownloaded: (cb: (info: { version: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, info: { version: string }) =>
      cb(info);
    ipcRenderer.on("app:updateDownloaded", handler);
    return () => ipcRenderer.removeListener("app:updateDownloaded", handler);
  },
  onUpdateProgress: (cb: (data: { percent: number }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { percent: number }) =>
      cb(data);
    ipcRenderer.on("app:updateProgress", handler);
    return () => ipcRenderer.removeListener("app:updateProgress", handler);
  },
});

contextBridge.exposeInMainWorld("image", {
  readNaiMeta: (path: string) => ipcRenderer.invoke("readNaiMeta", path),
  readMetaFromBuffer: (data: Uint8Array) =>
    ipcRenderer.invoke("image:readMetaFromBuffer", data),
  readFile: (path: string) => ipcRenderer.invoke("image:readFile", path),
  list: () => ipcRenderer.invoke("image:list"),
  getSearchPresetStats: () => ipcRenderer.invoke("image:getSearchPresetStats"),
  suggestTags: (query: {
    prefix: string;
    limit?: number;
    exclude?: string[];
  }) => ipcRenderer.invoke("image:suggestTags", query),
  listPage: (query: {
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
  }) => ipcRenderer.invoke("image:listPage", query),
  listMatching: (query: {
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
  }) => ipcRenderer.invoke("image:listMatching", query),
  listByIds: (ids: number[]) => ipcRenderer.invoke("image:listByIds", ids),
  scan: (options?: {
    detectDuplicates?: boolean;
    folderIds?: number[];
    orderedFolderIds?: number[];
  }) => ipcRenderer.invoke("image:scan", options),
  setFavorite: (id: number, isFavorite: boolean) =>
    ipcRenderer.invoke("image:setFavorite", id, isFavorite),
  watch: () => ipcRenderer.invoke("image:watch"),
  listIgnoredDuplicates: () =>
    ipcRenderer.invoke("image:listIgnoredDuplicates"),
  clearIgnoredDuplicates: () =>
    ipcRenderer.invoke("image:clearIgnoredDuplicates"),
  onBatch: (cb: (images: unknown[]) => void) => {
    const handler = (_: Electron.IpcRendererEvent, images: unknown[]) =>
      cb(images);
    ipcRenderer.on("image:batch", handler);
    return () => ipcRenderer.removeListener("image:batch", handler);
  },
  onRemoved: (cb: (ids: number[]) => void) => {
    const handler = (_: Electron.IpcRendererEvent, ids: number[]) => cb(ids);
    ipcRenderer.on("image:removed", handler);
    return () => ipcRenderer.removeListener("image:removed", handler);
  },
  onWatchDuplicate: (
    cb: (item: {
      id: string;
      hash: string;
      previewPath: string;
      previewFileName: string;
      existingEntries: Array<{
        imageId: number;
        path: string;
        fileName: string;
      }>;
      incomingEntries: Array<{
        path: string;
        fileName: string;
      }>;
    }) => void,
  ) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      item: {
        id: string;
        hash: string;
        previewPath: string;
        previewFileName: string;
        existingEntries: Array<{
          imageId: number;
          path: string;
          fileName: string;
        }>;
        incomingEntries: Array<{
          path: string;
          fileName: string;
        }>;
      },
    ) => cb(item);
    ipcRenderer.on("image:watchDuplicate", handler);
    return () => ipcRenderer.removeListener("image:watchDuplicate", handler);
  },
  revealInExplorer: (path: string) =>
    ipcRenderer.invoke("image:revealInExplorer", path),
  delete: (path: string) => ipcRenderer.invoke("image:delete", path),
  computeHashes: () => ipcRenderer.invoke("image:computeHashes"),
  resetHashes: () => ipcRenderer.invoke("image:resetHashes"),
  refreshPrompts: (): Promise<number> =>
    ipcRenderer.invoke("image:refreshPrompts"),
  similarGroups: (threshold: number, jaccardThreshold?: number) =>
    ipcRenderer.invoke("image:similarGroups", threshold, jaccardThreshold),
  similarReasons: (
    imageId: number,
    candidateImageIds: number[],
    threshold: number,
    jaccardThreshold?: number,
  ) =>
    ipcRenderer.invoke(
      "image:similarReasons",
      imageId,
      candidateImageIds,
      threshold,
      jaccardThreshold,
    ),
  onHashProgress: (cb: (data: { done: number; total: number }) => void) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      data: { done: number; total: number },
    ) => cb(data);
    ipcRenderer.on("image:hashProgress", handler);
    return () => ipcRenderer.removeListener("image:hashProgress", handler);
  },
  onSimilarityProgress: (
    cb: (data: { done: number; total: number }) => void,
  ) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      data: { done: number; total: number },
    ) => cb(data);
    ipcRenderer.on("image:similarityProgress", handler);
    return () =>
      ipcRenderer.removeListener("image:similarityProgress", handler);
  },
  onScanProgress: (cb: (data: { done: number; total: number }) => void) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      data: { done: number; total: number },
    ) => cb(data);
    ipcRenderer.on("image:scanProgress", handler);
    return () => ipcRenderer.removeListener("image:scanProgress", handler);
  },
  onDupCheckProgress: (cb: (data: { done: number; total: number }) => void) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      data: { done: number; total: number },
    ) => cb(data);
    ipcRenderer.on("image:dupCheckProgress", handler);
    return () => ipcRenderer.removeListener("image:dupCheckProgress", handler);
  },
  onSearchStatsProgress: (
    cb: (data: { done: number; total: number }) => void,
  ) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      data: { done: number; total: number },
    ) => cb(data);
    ipcRenderer.on("image:searchStatsProgress", handler);
    return () =>
      ipcRenderer.removeListener("image:searchStatsProgress", handler);
  },
  onRefreshPromptsProgress: (
    cb: (data: { done: number; total: number }) => void,
  ) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      data: { done: number; total: number },
    ) => cb(data);
    ipcRenderer.on("image:refreshPromptsProgress", handler);
    return () =>
      ipcRenderer.removeListener("image:refreshPromptsProgress", handler);
  },
  cancelScan: () => ipcRenderer.invoke("image:cancelScan"),
  onScanFolder: (
    cb: (data: {
      folderId: number;
      folderName?: string;
      active: boolean;
    }) => void,
  ) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      data: { folderId: number; folderName?: string; active: boolean },
    ) => cb(data);
    ipcRenderer.on("image:scanFolder", handler);
    return () => ipcRenderer.removeListener("image:scanFolder", handler);
  },
});
contextBridge.exposeInMainWorld("dialog", {
  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke("selectDirectory"),
  selectDirectories: (): Promise<string[] | null> =>
    ipcRenderer.invoke("selectDirectories"),
});
contextBridge.exposeInMainWorld("promptBuilder", {
  listCategories: () => ipcRenderer.invoke("prompt:listCategories"),
  suggestTags: (query: {
    prefix: string;
    limit?: number;
    exclude?: string[];
  }) => ipcRenderer.invoke("prompt:suggestTags", query),
  createCategory: (name: string) =>
    ipcRenderer.invoke("prompt:createCategory", name),
  renameCategory: (id: number, name: string) =>
    ipcRenderer.invoke("prompt:renameCategory", id, name),
  deleteCategory: (id: number) =>
    ipcRenderer.invoke("prompt:deleteCategory", id),
  resetCategories: () => ipcRenderer.invoke("prompt:resetCategories"),
  createGroup: (categoryId: number, name: string) =>
    ipcRenderer.invoke("prompt:createGroup", categoryId, name),
  deleteGroup: (id: number) => ipcRenderer.invoke("prompt:deleteGroup", id),
  renameGroup: (id: number, name: string) =>
    ipcRenderer.invoke("prompt:renameGroup", id, name),
  createToken: (groupId: number, label: string) =>
    ipcRenderer.invoke("prompt:createToken", groupId, label),
  deleteToken: (id: number) => ipcRenderer.invoke("prompt:deleteToken", id),
  reorderTokens: (groupId: number, ids: number[]) =>
    ipcRenderer.invoke("prompt:reorderTokens", groupId, ids),
});
contextBridge.exposeInMainWorld("category", {
  list: () => ipcRenderer.invoke("category:list"),
  create: (name: string) => ipcRenderer.invoke("category:create", name),
  delete: (id: number) => ipcRenderer.invoke("category:delete", id),
  rename: (id: number, name: string) =>
    ipcRenderer.invoke("category:rename", id, name),
  addImage: (imageId: number, categoryId: number) =>
    ipcRenderer.invoke("category:addImage", imageId, categoryId),
  removeImage: (imageId: number, categoryId: number) =>
    ipcRenderer.invoke("category:removeImage", imageId, categoryId),
  addImages: (imageIds: number[], categoryId: number) =>
    ipcRenderer.invoke("category:addImages", imageIds, categoryId),
  removeImages: (imageIds: number[], categoryId: number) =>
    ipcRenderer.invoke("category:removeImages", imageIds, categoryId),
  addByPrompt: (categoryId: number, query: string) =>
    ipcRenderer.invoke("category:addByPrompt", categoryId, query),
  imageIds: (categoryId: number) =>
    ipcRenderer.invoke("category:imageIds", categoryId),
  forImage: (imageId: number) =>
    ipcRenderer.invoke("category:forImage", imageId),
  commonForImages: (imageIds: number[]) =>
    ipcRenderer.invoke("category:commonForImages", imageIds),
});
contextBridge.exposeInMainWorld("nai", {
  validateApiKey: (apiKey: string) =>
    ipcRenderer.invoke("nai:validateApiKey", apiKey),
  getConfig: () => ipcRenderer.invoke("nai:getConfig"),
  updateConfig: (patch: object) =>
    ipcRenderer.invoke("nai:updateConfig", patch),
  generate: (params: object) => ipcRenderer.invoke("nai:generate", params),
  onGeneratePreview: (cb: (dataUrl: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, dataUrl: string) =>
      cb(dataUrl);
    ipcRenderer.on("nai:generatePreview", handler);
    return () => ipcRenderer.off("nai:generatePreview", handler);
  },
});
contextBridge.exposeInMainWorld("folder", {
  list: () => ipcRenderer.invoke("folder:list"),
  create: (name: string, path: string) =>
    ipcRenderer.invoke("folder:create", name, path),
  findDuplicates: (path: string) =>
    ipcRenderer.invoke("folder:findDuplicates", path),
  resolveDuplicates: (
    resolutions: Array<{
      id: string;
      hash: string;
      existingEntries: Array<{ imageId: number; path: string }>;
      incomingPaths: string[];
      keep: "existing" | "incoming" | "ignore";
    }>,
  ) => ipcRenderer.invoke("folder:resolveDuplicates", resolutions),
  delete: (id: number) => ipcRenderer.invoke("folder:delete", id),
  rename: (id: number, name: string) =>
    ipcRenderer.invoke("folder:rename", id, name),
  revealInExplorer: (id: number) =>
    ipcRenderer.invoke("folder:revealInExplorer", id),
  listSubdirectories: (id: number) =>
    ipcRenderer.invoke("folder:listSubdirectories", id),
});
