import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("appInfo", {
  get: () => ipcRenderer.invoke("app:getInfo"),
});

contextBridge.exposeInMainWorld("image", {
  readNaiMeta: (path: string) => ipcRenderer.invoke("readNaiMeta", path),
  readMetaFromBuffer: (data: Uint8Array) =>
    ipcRenderer.invoke("image:readMetaFromBuffer", data),
  readFile: (path: string) => ipcRenderer.invoke("image:readFile", path),
  list: () => ipcRenderer.invoke("image:list"),
  getSearchPresetStats: () => ipcRenderer.invoke("image:getSearchPresetStats"),
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
  }) => ipcRenderer.invoke("image:listPage", query),
  listByIds: (ids: number[]) => ipcRenderer.invoke("image:listByIds", ids),
  scan: (options?: {
    detectDuplicates?: boolean;
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
  similarGroups: (threshold: number) =>
    ipcRenderer.invoke("image:similarGroups", threshold),
  onHashProgress: (cb: (data: { done: number; total: number }) => void) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      data: { done: number; total: number },
    ) => cb(data);
    ipcRenderer.on("image:hashProgress", handler);
    return () => ipcRenderer.removeListener("image:hashProgress", handler);
  },
  onScanProgress: (cb: (data: { done: number; total: number }) => void) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      data: { done: number; total: number },
    ) => cb(data);
    ipcRenderer.on("image:scanProgress", handler);
    return () => ipcRenderer.removeListener("image:scanProgress", handler);
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
});
contextBridge.exposeInMainWorld("promptBuilder", {
  listGroups: () => ipcRenderer.invoke("prompt:listGroups"),
  createGroup: (name: string, type: string) =>
    ipcRenderer.invoke("prompt:createGroup", name, type),
  deleteGroup: (id: number) => ipcRenderer.invoke("prompt:deleteGroup", id),
  renameGroup: (id: number, name: string) =>
    ipcRenderer.invoke("prompt:renameGroup", id, name),
  reorderGroups: (ids: number[]) =>
    ipcRenderer.invoke("prompt:reorderGroups", ids),
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
  getConfig: () => ipcRenderer.invoke("nai:getConfig"),
  updateConfig: (patch: object) =>
    ipcRenderer.invoke("nai:updateConfig", patch),
  generate: (params: object) => ipcRenderer.invoke("nai:generate", params),
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
});
