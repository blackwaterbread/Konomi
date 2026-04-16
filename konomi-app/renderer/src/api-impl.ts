/**
 * Electron implementation of KonomiApi.
 * Delegates to window.* globals injected by preload/contextBridge.
 */

import type { KonomiApi } from "@/api";

export function createElectronApi(): KonomiApi {
  return {
    appInfo: window.appInfo,
    db: window.db,
    dialog: window.dialog,
    folder: {
      ...window.folder,
      availableDirectories: async () => [],
    },
    image: window.image,
    category: window.category,
    nai: window.nai,
    promptBuilder: window.promptBuilder,
  };
}
