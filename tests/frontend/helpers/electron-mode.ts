let electronMode = false;

// Code reached through a component reads `useApi().appInfo.isElectron`, but
// plain helpers such as `imageUrl` read the `window.appInfo` global directly.
// Both have to move together or a test sees one platform and asserts the other.
function syncWindowAppInfo(value: boolean): void {
  const appInfo = (globalThis as { appInfo?: { isElectron: boolean } }).appInfo;
  if (appInfo) appInfo.isElectron = value;
}

export function setElectronMode(value: boolean): void {
  electronMode = value;
  syncWindowAppInfo(value);
}

export function resetElectronMode(): void {
  setElectronMode(false);
}

export function isElectronMode(): boolean {
  return electronMode;
}

export function withElectronMode<T>(fn: () => T): T {
  const previous = electronMode;
  setElectronMode(true);
  try {
    return fn();
  } finally {
    setElectronMode(previous);
  }
}
