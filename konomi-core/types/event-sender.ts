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
  active: boolean;
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
};
