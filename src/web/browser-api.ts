/**
 * Browser implementation of KonomiApi.
 * Backed by HTTP fetch (request/response) + WebSocket (push events).
 */

import type { KonomiApi } from "@/api";

const BASE_URL = import.meta.env.VITE_API_URL || "";

// ── HTTP helpers ───────────────────────────────────────────────

async function parseBody<T>(res: Response): Promise<T> {
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
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

// ── Background scan coordination ───────────────────────────────
//
// The server runs scans fire-and-forget: POST /api/images/scan returns
// immediately ({ started } or { alreadyRunning }) so the HTTP connection is
// released right away (no reverse-proxy read-timeout on multi-minute scans).
// The actual result arrives over the WebSocket. We resolve when the scan goes
// inactive — `image:scanActive { active: false }`, which the server also
// re-sends as a hello frame on (re)connect, so a completion lost during a
// socket drop still resolves us. `image:scanComplete` carries the cancelled
// flag.
function scanAndWait(
  options?: {
    detectDuplicates?: boolean;
    folderIds?: number[];
    orderedFolderIds?: number[];
    skipFolderIds?: number[];
    subPaths?: string[];
  },
): Promise<{ cancelled: boolean }> {
  return new Promise((resolve, reject) => {
    let cancelled = false;
    let posted = false;
    let sawInactive = false;
    let settled = false;

    const cleanup = () => {
      offComplete();
      offActive();
    };
    const resolveDone = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ cancelled });
    };

    const offComplete = onEvent("image:scanComplete", (d: { cancelled?: boolean }) => {
      cancelled = d?.cancelled ?? false;
    });
    const offActive = onEvent("image:scanActive", (d: { active?: boolean }) => {
      if (d?.active !== false) return;
      sawInactive = true;
      if (posted) resolveDone();
    });

    // Listeners are attached BEFORE the request so a fast scan's completion
    // can't slip through the gap.
    rpc<{
      started?: boolean;
      alreadyRunning?: boolean;
      skippedSubPaths?: string[];
    }>("/api/images/scan", options ?? {})
      .then((res) => {
        posted = true;
        // Subtrees the server refused because another scan holds the lock.
        // Delivered in the response rather than broadcast, because the
        // rejection belongs to this request alone; replay it locally so the
        // same `onScanSkipped` listeners handle it.
        if (res?.skippedSubPaths && res.skippedSubPaths.length > 0) {
          dispatchEvent("image:scanSkipped", { subPaths: res.skippedSubPaths });
        }
        if (res?.started) {
          // Our own fresh scan just started: any inactive seen before now
          // belonged to a prior scan — wait for the next transition.
          sawInactive = false;
        } else if (sawInactive) {
          // Attached to an already-running scan that finished in the gap.
          resolveDone();
        }
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      });
  });
}

// Generic fire-and-forget: POST returns immediately ({ started } /
// { alreadyRunning }); the real result arrives over the WebSocket as
// `completeEvent`. Used for long foreground jobs (rescan-metadata) so the
// HTTP connection isn't held open past a reverse-proxy read timeout. The
// listener is attached before the POST so a fast job's completion can't slip
// through, and the completion event is emitted exactly once per server-side
// run, so there's no prior-event ambiguity (unlike scanActive toggles).
function postAndWait<T>(
  url: string,
  body: unknown,
  completeEvent: string,
  pick: (data: any) => T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const off = onEvent(completeEvent, (d) => {
      if (settled) return;
      settled = true;
      off();
      resolve(pick(d));
    });
    rpc(url, body ?? {}).catch((err) => {
      if (settled) return;
      settled = true;
      off();
      reject(err);
    });
  });
}

// ── Implementation ─────────────────────────────────────────────

export function createBrowserApi(): KonomiApi {
  return {
    appInfo: {
      isElectron: false,
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
      getPendingUpdate: async () => null,
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
      listSubdirectoriesByPath: (folderPath) =>
        rpc(`/api/folders/subdirectories?path=${encodeURIComponent(folderPath)}`),
      stats: (id) => rpc(`/api/folders/${id}/stats`),
      size: (id) => rpc(`/api/folders/${id}/size`),
      availableDirectories: () => rpc("/api/folders/available"),
      onListChanged: (cb) => onEvent("folder:listChanged", cb),
    },

    image: {
      readNaiMeta: (path) => rpc(`/api/files/image/meta?path=${encodeURIComponent(path)}`),
      readMetaFromBuffer: async (data) => {
        const res = await fetch(`${BASE_URL}/api/files/image/meta/buffer`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: new Blob([new Uint8Array(data)]),
        });
        if (!res.ok) throw new Error(`API /api/files/image/meta/buffer: ${res.status}`);
        return parseBody(res);
      },
      readFile: async (path) => {
        const res = await fetch(`${BASE_URL}/api/files/image?path=${encodeURIComponent(path)}`);
        if (!res.ok) throw new Error(`API /api/files/image: ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      },
      getSearchPresetStats: () => rpc("/api/images/search-preset-stats"),
      suggestTags: (query) => rpc("/api/images/suggest-tags", query),
      listPage: (query) => rpc("/api/images/page", query),
      listMatchingIds: (query) => rpc("/api/images/matching-ids", query),
      bulkDelete: (ids) => rpc("/api/images/bulk-delete", { ids }),
      listByIds: (ids) => rpc("/api/images/by-ids", { ids }),
      quickVerify: () => rpc("/api/images/quick-verify", {}),
      scan: (options) => scanAndWait(options),
      setFavorite: (id, isFavorite) => rpc("/api/images/favorite", { id, isFavorite }),
      listIgnoredDuplicates: () => rpc("/api/images/ignored-duplicates"),
      clearIgnoredDuplicates: () => rpcDelete("/api/images/ignored-duplicates"),
      revealInExplorer: async () => {},
      delete: (path) => rpc("/api/images/delete", { path }),
      computeHashes: () => rpc("/api/images/compute-hashes", {}),
      resetHashes: () => rpc("/api/images/reset-hashes", {}),
      rescanMetadata: () =>
        postAndWait(
          "/api/images/rescan-metadata",
          {},
          "image:rescanMetadataComplete",
          (d: { count?: number }) => d?.count ?? 0,
        ),
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
      onAnalysisActive: (cb) => onEvent("image:analysisActive", cb),
      onSimilarityProgress: (cb) => onEvent("image:similarityProgress", cb),
      onScanProgress: (cb) => onEvent("image:scanProgress", cb),
      onScanPhase: (cb) => onEvent("image:scanPhase", cb),
      onDupCheckProgress: (cb) => onEvent("image:dupCheckProgress", cb),
      onSearchStatsProgress: (cb) => onEvent("image:searchStatsProgress", cb),
      onRescanMetadataProgress: (cb) => onEvent("image:rescanMetadataProgress", cb),
      onScanFolder: (cb) => onEvent("image:scanFolder", cb),
      onScanSkipped: (cb) => onEvent("image:scanSkipped", cb),
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
