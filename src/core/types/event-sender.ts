// ---------------------------------------------------------------------------
// EventSender — communication layer interface
// ---------------------------------------------------------------------------
// Consumers implement this to push real-time events to clients.
// Desktop: IPC via webContents.send()
// Web: WebSocket broadcast

export type EventSender = {
  send(channel: string, data: unknown): void;
};

// ---------------------------------------------------------------------------
// Known event channels and their payloads
// ---------------------------------------------------------------------------

export type ScanProgressEvent = {
  scanned: number;
  total: number;
};

export type ScanFolderEvent = {
  folderId: number;
  folderName?: string;
  /** Set when only this subtree of the folder is being scanned. */
  subPath?: string;
  active: boolean;
};

/**
 * Why a requested `subPath` was not scanned. The three are not interchangeable
 * to a user: `"unreadable"` points at their filesystem, `"busy"` says to try
 * again in a moment, and `"outside"` says the subtree is no longer part of a
 * scanned folder. Reporting any of them as `"unreadable"` sends people looking
 * for a permissions problem that does not exist.
 */
export type ScanSkippedReason = "unreadable" | "busy" | "outside";

/**
 * Requested `subPaths` the scan did not cover. Pushed rather than returned
 * because the web client resolves its scan on a WebSocket event and never sees
 * the return value.
 *
 * The web sender broadcasts, so this reaches sessions that requested nothing;
 * `subPaths` is only ever non-empty for a subtree-scoped request, so a client
 * drops any entry it did not ask for.
 */
export type ScanSkippedEvent = {
  subPaths: string[];
  reason: ScanSkippedReason;
};

export type ImageBatchEvent = {
  rows: Array<{
    id: number;
    path: string;
    folderId: number;
    prompt: string;
    negativePrompt: string;
    source: string;
    model: string;
    seed: string;
    width: number;
    height: number;
    isFavorite: boolean;
    fileModifiedAt: Date;
    createdAt: Date;
  }>;
};

export type ImageRemovedEvent = {
  path: string;
};

export type KonomiEventMap = {
  "image:batch": ImageBatchEvent;
  "image:removed": ImageRemovedEvent;
  "image:scanProgress": ScanProgressEvent;
  "image:scanFolder": ScanFolderEvent;
  "image:scanSkipped": ScanSkippedEvent;
};
