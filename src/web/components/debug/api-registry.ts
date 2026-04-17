export type ApiMethod = {
  namespace: string;
  method: string;
  label: string;
  params?: string;
  destructive?: boolean;
};

export const API_REGISTRY: ApiMethod[] = [
  // appInfo
  { namespace: "appInfo", method: "isDevMode", label: "appInfo.isDevMode" },
  { namespace: "appInfo", method: "get", label: "appInfo.get" },
  { namespace: "appInfo", method: "getLocale", label: "appInfo.getLocale" },
  { namespace: "appInfo", method: "getDbFileSize", label: "appInfo.getDbFileSize" },
  { namespace: "appInfo", method: "getPromptsDbSchemaVersion", label: "appInfo.getPromptsDbSchemaVersion" },

  // folder
  { namespace: "folder", method: "list", label: "folder.list" },
  { namespace: "folder", method: "create", label: "folder.create", params: '{"name": "", "path": ""}' },
  { namespace: "folder", method: "delete", label: "folder.delete", params: '{"id": 0}', destructive: true },
  { namespace: "folder", method: "rename", label: "folder.rename", params: '{"id": 0, "name": ""}' },
  { namespace: "folder", method: "listSubdirectories", label: "folder.listSubdirectories", params: '{"id": 0}' },
  { namespace: "folder", method: "listSubdirectoriesByPath", label: "folder.listSubdirectoriesByPath", params: '{"folderPath": ""}' },
  { namespace: "folder", method: "revealInExplorer", label: "folder.revealInExplorer", params: '{"idOrPath": 0}' },

  // image
  { namespace: "image", method: "listPage", label: "image.listPage", params: '{"page": 1, "pageSize": 20}' },
  { namespace: "image", method: "listMatchingIds", label: "image.listMatchingIds", params: '{"page": 1, "pageSize": 20}' },
  { namespace: "image", method: "listByIds", label: "image.listByIds", params: '{"ids": []}' },
  { namespace: "image", method: "getSearchPresetStats", label: "image.getSearchPresetStats" },
  { namespace: "image", method: "suggestTags", label: "image.suggestTags", params: '{"prefix": "", "limit": 10}' },
  { namespace: "image", method: "readNaiMeta", label: "image.readNaiMeta", params: '{"path": ""}' },
  { namespace: "image", method: "scan", label: "image.scan", params: '{}' },
  { namespace: "image", method: "cancelScan", label: "image.cancelScan" },
  { namespace: "image", method: "setFavorite", label: "image.setFavorite", params: '{"id": 0, "isFavorite": true}' },
  { namespace: "image", method: "watch", label: "image.watch" },
  { namespace: "image", method: "computeHashes", label: "image.computeHashes" },
  { namespace: "image", method: "resetHashes", label: "image.resetHashes", destructive: true },
  { namespace: "image", method: "rescanMetadata", label: "image.rescanMetadata" },
  { namespace: "image", method: "similarGroups", label: "image.similarGroups", params: '{"threshold": 12, "jaccardThreshold": 0.5}' },
  { namespace: "image", method: "similarReasons", label: "image.similarReasons", params: '{"imageId": 0, "candidateImageIds": [], "threshold": 12, "jaccardThreshold": 0.5}' },
  { namespace: "image", method: "rescanImageMetadata", label: "image.rescanImageMetadata", params: '{"paths": []}' },
  { namespace: "image", method: "listIgnoredDuplicates", label: "image.listIgnoredDuplicates" },
  { namespace: "image", method: "clearIgnoredDuplicates", label: "image.clearIgnoredDuplicates", destructive: true },
  { namespace: "image", method: "bulkDelete", label: "image.bulkDelete", params: '{"ids": []}', destructive: true },

  // category
  { namespace: "category", method: "list", label: "category.list" },
  { namespace: "category", method: "create", label: "category.create", params: '{"name": ""}' },
  { namespace: "category", method: "delete", label: "category.delete", params: '{"id": 0}', destructive: true },
  { namespace: "category", method: "rename", label: "category.rename", params: '{"id": 0, "name": ""}' },
  { namespace: "category", method: "imageIds", label: "category.imageIds", params: '{"categoryId": 0}' },
  { namespace: "category", method: "forImage", label: "category.forImage", params: '{"imageId": 0}' },
  { namespace: "category", method: "setColor", label: "category.setColor", params: '{"id": 0, "color": null}' },

  // promptBuilder
  { namespace: "promptBuilder", method: "listCategories", label: "promptBuilder.listCategories" },
  { namespace: "promptBuilder", method: "suggestTags", label: "promptBuilder.suggestTags", params: '{"prefix": "", "limit": 10}' },
  { namespace: "promptBuilder", method: "searchTags", label: "promptBuilder.searchTags", params: '{"name": "", "page": 1, "pageSize": 20}' },
  { namespace: "promptBuilder", method: "resetCategories", label: "promptBuilder.resetCategories", destructive: true },

  // nai
  { namespace: "nai", method: "getConfig", label: "nai.getConfig" },
  { namespace: "nai", method: "getSubscription", label: "nai.getSubscription" },

  // db
  { namespace: "db", method: "runMigrations", label: "db.runMigrations" },

  // dialog
  { namespace: "dialog", method: "selectDirectory", label: "dialog.selectDirectory" },
  { namespace: "dialog", method: "selectDirectories", label: "dialog.selectDirectories" },
];

export const API_NAMESPACES = [...new Set(API_REGISTRY.map((m) => m.namespace))];

/**
 * Resolves API method parameters from the JSON params template.
 * Each method has its own calling convention based on the original preload API.
 */
export function resolveApiCall(
  entry: ApiMethod,
  parsedParams: Record<string, unknown>,
): unknown[] {
  const ns = entry.namespace;
  const m = entry.method;

  // Methods with no params
  if (!entry.params) return [];

  // Methods that take positional args
  if (ns === "folder" && m === "create") return [parsedParams.name, parsedParams.path];
  if (ns === "folder" && m === "delete") return [parsedParams.id];
  if (ns === "folder" && m === "rename") return [parsedParams.id, parsedParams.name];
  if (ns === "folder" && m === "listSubdirectories") return [parsedParams.id];
  if (ns === "folder" && m === "listSubdirectoriesByPath") return [parsedParams.folderPath];
  if (ns === "folder" && m === "revealInExplorer") return [parsedParams.idOrPath];
  if (ns === "image" && m === "readNaiMeta") return [parsedParams.path];
  if (ns === "image" && m === "setFavorite") return [parsedParams.id, parsedParams.isFavorite];
  if (ns === "image" && m === "listByIds") return [parsedParams.ids];
  if (ns === "image" && m === "bulkDelete") return [parsedParams.ids];
  if (ns === "image" && m === "similarGroups") return [parsedParams.threshold, parsedParams.jaccardThreshold];
  if (ns === "image" && m === "similarReasons") return [parsedParams.imageId, parsedParams.candidateImageIds, parsedParams.threshold, parsedParams.jaccardThreshold];
  if (ns === "image" && m === "rescanImageMetadata") return [parsedParams.paths];
  if (ns === "category" && m === "create") return [parsedParams.name];
  if (ns === "category" && m === "delete") return [parsedParams.id];
  if (ns === "category" && m === "rename") return [parsedParams.id, parsedParams.name];
  if (ns === "category" && m === "imageIds") return [parsedParams.categoryId];
  if (ns === "category" && m === "forImage") return [parsedParams.imageId];
  if (ns === "category" && m === "setColor") return [parsedParams.id, parsedParams.color];

  // Default: single object param
  return [parsedParams];
}
