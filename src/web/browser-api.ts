/**
 * Browser implementation of KonomiApi.
 * Backed by HTTP fetch (request/response) + WebSocket (push events).
 */

import type { KonomiApi } from "@/api";

const BASE_URL = import.meta.env.VITE_API_URL || "";

// ── HTTP helpers ───────────────────────────────────────────────

async function parseBody<T>(res: Response): Promise<T> {
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function rpc<T = unknown>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${url}`, {
    method: body !== undefined ? "POST" : "GET",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API ${url}: ${res.status}`);
  return parseBody(res);
}

async function rpcPatch<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${url}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${url}: ${res.status}`);
  return parseBody(res);
}

async function rpcDelete<T = unknown>(url: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${url}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`API ${url}: ${res.status}`);
  return parseBody(res);
}

// ── WebSocket event bus ────────────────────────────────────────

type Listener = (data: any) => void;
const eventListeners = new Map<string, Set<Listener>>();

function onEvent(channel: string, cb: Listener): () => void {
  let set = eventListeners.get(channel);
  if (!set) {
    set = new Set();
    eventListeners.set(channel, set);
  }
  set.add(cb);
  return () => set!.delete(cb);
}

function dispatchEvent(channel: string, data: unknown): void {
  const set = eventListeners.get(channel);
  if (set) {
    for (const cb of set) cb(data);
  }
}

export function connectWebSocket(): WebSocket {
  const wsUrl = (BASE_URL || location.origin).replace(/^http/, "ws") + "/ws";
  const ws = new WebSocket(wsUrl);
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.event) dispatchEvent(msg.event, msg.data);
    } catch { /* ignore malformed */ }
  };
  ws.onclose = () => {
    setTimeout(() => connectWebSocket(), 2000);
  };
  return ws;
}

// ── Implementation ─────────────────────────────────────────────

export function createBrowserApi(): KonomiApi {
  return {
    appInfo: {
      isDevMode: async () => import.meta.env.DEV,
      get: async () => ({
        appName: "Konomi Web",
        appVersion: __APP_VERSION__,
        electronVersion: "",
        chromeVersion: "",
        nodeVersion: "",
        platform: navigator.platform,
        arch: "",
      }),
      getLocale: async () => navigator.language,
      getDbFileSize: async () => null,
      getPromptsDbSchemaVersion: async () => null,
      checkForUpdates: async () => {},
      installUpdate: async () => {},
      onUpdateAvailable: () => () => {},
      onUpdateDownloaded: () => () => {},
      onUpdateProgress: () => () => {},
      onUtilityReset: () => () => {},
      clearResourceCache: () => {},
    },

    db: {
      runMigrations: async () => {},  // Server runs migrations on boot
      onMigrationProgress: (cb) => onEvent("db:migrationProgress", cb),
    },

    dialog: {
      selectDirectory: async () => null,
      selectDirectories: async () => null,
    },

    folder: {
      list: () => rpc("/api/folders"),
      create: (name, path) => rpc("/api/folders", { name, path }),
      findDuplicates: (path) => rpc("/api/folders/duplicates", { path }),
      resolveDuplicates: (resolutions) => rpc("/api/folders/duplicates/resolve", { resolutions }),
      delete: (id) => rpcDelete(`/api/folders/${id}`),
      rename: (id, name) => rpcPatch(`/api/folders/${id}`, { name }),
      revealInExplorer: async () => {},
      listSubdirectories: (id) => rpc(`/api/folders/${id}/subdirectories`),
      listSubdirectoriesByPath: async () => [],
      stats: (id) => rpc(`/api/folders/${id}/stats`),
      size: (id) => rpc(`/api/folders/${id}/size`),
      availableDirectories: () => rpc("/api/folders/available"),
    },

    image: {
      readNaiMeta: (path) => rpc(`/api/files/image/meta?path=${encodeURIComponent(path)}`),
      readMetaFromBuffer: async () => null,
      readFile: async (path) => {
        const res = await fetch(`${BASE_URL}/api/files/image?path=${encodeURIComponent(path)}`);
        const buf = await res.arrayBuffer();
        return Buffer.from(buf);
      },
      getSearchPresetStats: () => rpc("/api/images/search-preset-stats"),
      suggestTags: (query) => rpc("/api/images/suggest-tags", query),
      listPage: (query) => rpc("/api/images/page", query),
      listMatchingIds: (query) => rpc("/api/images/matching-ids", query),
      bulkDelete: (ids) => rpc("/api/images/bulk-delete", { ids }),
      listByIds: (ids) => rpc("/api/images/by-ids", { ids }),
      quickVerify: () => rpc("/api/images/quick-verify", {}),
      scan: (options) => rpc("/api/images/scan", options ?? {}),
      setFavorite: (id, isFavorite) => rpc("/api/images/favorite", { id, isFavorite }),
      watch: async () => {},
      listIgnoredDuplicates: () => rpc("/api/images/ignored-duplicates"),
      clearIgnoredDuplicates: () => rpcDelete("/api/images/ignored-duplicates"),
      revealInExplorer: async () => {},
      delete: (path) => rpc("/api/images/delete", { path }),
      computeHashes: () => rpc("/api/images/compute-hashes", {}),
      resetHashes: () => rpc("/api/images/reset-hashes", {}),
      rescanMetadata: () => rpc("/api/images/rescan-metadata", {}),
      rescanImageMetadata: (paths) => rpc("/api/images/rescan-image-metadata", { paths }),
      similarGroups: (threshold, jaccardThreshold) =>
        rpc("/api/images/similar-groups", { threshold, jaccardThreshold }),
      similarGroupForImage: (imageId) => rpc(`/api/images/${imageId}/similar-group`),
      similarReasons: (imageId, candidateImageIds, threshold, jaccardThreshold) =>
        rpc("/api/images/similar-reasons", { imageId, candidateImageIds, threshold, jaccardThreshold }),
      cancelScan: () => rpc("/api/images/scan/cancel", {}),
      onBatch: (cb) => onEvent("image:batch", cb),
      onRemoved: (cb) => onEvent("image:removed", cb),
      onWatchDuplicate: (cb) => onEvent("image:watchDuplicate", cb),
      onQuickVerifyProgress: (cb) => onEvent("image:quickVerifyProgress", cb),
      onHashProgress: (cb) => onEvent("image:hashProgress", cb),
      onSimilarityProgress: (cb) => onEvent("image:similarityProgress", cb),
      onScanProgress: (cb) => onEvent("image:scanProgress", cb),
      onScanPhase: (cb) => onEvent("image:scanPhase", cb),
      onDupCheckProgress: (cb) => onEvent("image:dupCheckProgress", cb),
      onSearchStatsProgress: (cb) => onEvent("image:searchStatsProgress", cb),
      onRescanMetadataProgress: (cb) => onEvent("image:rescanMetadataProgress", cb),
      onScanFolder: (cb) => onEvent("image:scanFolder", cb),
    },

    category: {
      list: () => rpc("/api/categories"),
      create: (name) => rpc("/api/categories", { name }),
      delete: (id) => rpcDelete(`/api/categories/${id}`),
      rename: (id, name) => rpcPatch(`/api/categories/${id}`, { name }),
      addImage: (imageId, categoryId) => rpc("/api/categories/add-image", { imageId, categoryId }),
      removeImage: (imageId, categoryId) => rpc("/api/categories/remove-image", { imageId, categoryId }),
      addImages: (imageIds, categoryId) => rpc("/api/categories/add-images", { imageIds, categoryId }),
      removeImages: (imageIds, categoryId) => rpc("/api/categories/remove-images", { imageIds, categoryId }),
      addByPrompt: (categoryId, query) => rpc("/api/categories/add-by-prompt", { categoryId, query }),
      imageIds: (categoryId) => rpc(`/api/categories/${categoryId}/image-ids`),
      forImage: (imageId) => rpc(`/api/images/${imageId}/categories`),
      commonForImages: (imageIds) => rpc("/api/categories/common-for-images", { imageIds }),
      setColor: (id, color) => rpcPatch(`/api/categories/${id}`, { color }),
    },

    nai: {
      validateApiKey: (apiKey) => rpc("/api/nai/validate-api-key", apiKey),
      getSubscription: () => rpc("/api/nai/subscription"),
      getConfig: () => rpc("/api/nai/config"),
      updateConfig: (patch) => rpcPatch("/api/nai/config", patch),
      generate: (params) => rpc("/api/nai/generate", params),
      onGeneratePreview: (cb) => onEvent("nai:generatePreview", cb),
    },

    promptBuilder: {
      listCategories: () => rpc("/api/prompt/categories"),
      suggestTags: (query) => rpc("/api/prompt/suggest-tags", query),
      createCategory: (name) => rpc("/api/prompt/categories", { name }),
      renameCategory: (id, name) => rpcPatch(`/api/prompt/categories/${id}`, { name }),
      deleteCategory: (id) => rpcDelete(`/api/prompt/categories/${id}`),
      resetCategories: () => rpc("/api/prompt/categories/reset", {}),
      createGroup: (categoryId, name) => rpc("/api/prompt/groups", { categoryId, name }),
      deleteGroup: (id) => rpcDelete(`/api/prompt/groups/${id}`),
      renameGroup: (id, name) => rpcPatch(`/api/prompt/groups/${id}`, { name }),
      createToken: (groupId, label) => rpc("/api/prompt/tokens", { groupId, label }),
      deleteToken: (id) => rpcDelete(`/api/prompt/tokens/${id}`),
      reorderGroups: (categoryId, ids) => rpc("/api/prompt/groups/reorder", { categoryId, ids }),
      reorderTokens: (groupId, ids) => rpc("/api/prompt/tokens/reorder", { groupId, ids }),
      searchTags: (query) => rpc("/api/prompt/search-tags", query),
    },
  };
}
