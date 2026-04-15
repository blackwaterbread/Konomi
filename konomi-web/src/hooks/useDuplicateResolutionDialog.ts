import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import i18n from "@/lib/i18n";
import type {
  Folder,
  FolderDuplicateGroup,
  FolderDuplicateGroupResolution,
} from "@preload/index.d";

export type DuplicateResolutionMode = "folderAdd" | "watch" | "rescan";
export type DuplicateBulkDecision =
  | "existing"
  | "incoming"
  | "ignore"
  | "manual";

export type DuplicatePreview = {
  src: string;
  fileName: string;
  path: string;
  side: string;
};

export type DuplicateResolutionDialogModel = {
  open: boolean;
  mode: DuplicateResolutionMode;
  items: FolderDuplicateGroup[];
  choices: Record<string, "existing" | "incoming" | "ignore">;
  bulkDecision: DuplicateBulkDecision;
  resolving: boolean;
  pageIndex: number;
  preview: DuplicatePreview | null;
  onOpenChange: (open: boolean) => void;
  onApplyAll: (keep: "existing" | "incoming" | "ignore") => void;
  onSelectBulkDecision: (decision: DuplicateBulkDecision) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onSetChoice: (
    itemId: string,
    keep: "existing" | "incoming" | "ignore",
  ) => void;
  onResolve: () => Promise<void>;
  onOpenPreview: (preview: DuplicatePreview) => void;
  onPreviewOpenChange: (open: boolean) => void;
};

export type PendingFolder = {
  name: string;
  path: string;
  subdirectories: { name: string; path: string }[];
};

type UseDuplicateResolutionDialogOptions = {
  addFolder: (name: string, path: string) => Promise<Folder>;
  onFolderAdded?: (folderId: number) => void;
  onFolderRescan?: (folderId: number) => void;
  onCheckingDuplicatesChange?: (checking: boolean) => void;
  seedSubfolders?: (
    folderId: number,
    subdirs: { name: string; path: string }[],
  ) => void;
};

type FolderAddPendingInfo = {
  name: string;
  path: string;
  subdirectories: { name: string; path: string }[];
};

type FolderRescanPendingInfo = {
  id: number;
  name: string;
  path: string;
};

const toLocalSrc = (filePath: string) =>
  `konomi://local/${encodeURIComponent(filePath.replace(/\\/g, "/"))}`;

const normalizeFolderPath = (folderPath: string): string => {
  const normalized = folderPath.replace(/\\/g, "/").replace(/\/+$/, "").trim();
  return navigator.userAgent.toLowerCase().includes("windows")
    ? normalized.toLowerCase()
    : normalized;
};

const mergeDuplicateGroups = (
  a: FolderDuplicateGroup,
  b: FolderDuplicateGroup,
): FolderDuplicateGroup => {
  const existingEntriesMap = new Map(
    a.existingEntries.map((entry) => [entry.imageId, entry]),
  );
  b.existingEntries.forEach((entry) => {
    if (!existingEntriesMap.has(entry.imageId)) {
      existingEntriesMap.set(entry.imageId, entry);
    }
  });

  const incomingEntriesMap = new Map(
    a.incomingEntries.map((entry) => [entry.path, entry]),
  );
  b.incomingEntries.forEach((entry) => {
    if (!incomingEntriesMap.has(entry.path)) {
      incomingEntriesMap.set(entry.path, entry);
    }
  });

  return {
    ...a,
    existingEntries: Array.from(existingEntriesMap.values()),
    incomingEntries: Array.from(incomingEntriesMap.values()),
  };
};

const mergeGroupList = (
  groups: FolderDuplicateGroup[],
  incoming: FolderDuplicateGroup,
): FolderDuplicateGroup[] => {
  const matchIndex = groups.findIndex((group) => group.hash === incoming.hash);
  if (matchIndex === -1) return [...groups, incoming];

  const merged = mergeDuplicateGroups(groups[matchIndex], incoming);
  const next = [...groups];
  next[matchIndex] = merged;
  return next;
};

const createChoicesForItems = (
  items: FolderDuplicateGroup[],
  keep: "existing" | "incoming" | "ignore",
): Record<string, "existing" | "incoming" | "ignore"> =>
  Object.fromEntries(
    items.map((item) => {
      const normalizedKeep =
        keep === "existing" && item.existingEntries.length === 0
          ? "incoming"
          : keep === "incoming" && item.incomingEntries.length === 0
            ? "existing"
            : keep;
      return [item.id, normalizedKeep];
    }),
  );

const syncChoicesWithItems = (
  items: FolderDuplicateGroup[],
  prevChoices: Record<string, "existing" | "incoming" | "ignore">,
  defaultKeep: "existing" | "incoming" | "ignore",
): Record<string, "existing" | "incoming" | "ignore"> => {
  const next: Record<string, "existing" | "incoming" | "ignore"> = {};
  for (const item of items) {
    const fallbackKeep =
      defaultKeep === "existing" && item.existingEntries.length === 0
        ? "incoming"
        : defaultKeep === "incoming" && item.incomingEntries.length === 0
          ? "existing"
          : defaultKeep;
    next[item.id] = prevChoices[item.id] ?? fallbackKeep;
  }
  return next;
};

const getInitialBulkDecision = (
  items: FolderDuplicateGroup[],
): DuplicateBulkDecision => {
  if (items.length <= 1) return "manual";
  const initialChoices = createChoicesForItems(items, "existing");
  const values = Object.values(initialChoices);
  if (values.every((value) => value === "existing")) return "existing";
  if (values.every((value) => value === "incoming")) return "incoming";
  return "manual";
};

export function useDuplicateResolutionDialog({
  addFolder,
  onFolderAdded,
  onFolderRescan,
  onCheckingDuplicatesChange,
  seedSubfolders,
}: UseDuplicateResolutionDialogOptions): {
  handleFolderAddWithDuplicateCheck: (
    name: string,
    path: string,
  ) => Promise<void>;
  handleFolderRescanWithDuplicateCheck: (folder: Folder) => Promise<void>;
  folderAddResolvedSeq: number;
  checkingDuplicates: boolean;
  pendingFolder: PendingFolder | null;
  dialog: DuplicateResolutionDialogModel;
} {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<DuplicateResolutionMode>("folderAdd");
  const [folderAddPendingInfo, setFolderAddPendingInfo] =
    useState<FolderAddPendingInfo | null>(null);
  const [folderRescanPendingInfo, setFolderRescanPendingInfo] =
    useState<FolderRescanPendingInfo | null>(null);
  const [items, setItems] = useState<FolderDuplicateGroup[]>([]);
  const [choices, setChoices] = useState<
    Record<string, "existing" | "incoming" | "ignore">
  >({});
  const [, setWatchDuplicateQueue] = useState<FolderDuplicateGroup[]>([]);
  const [bulkDecision, setBulkDecision] =
    useState<DuplicateBulkDecision>("existing");
  const [resolving, setResolving] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [preview, setPreview] = useState<DuplicatePreview | null>(null);
  const [folderAddResolvedSeq, setFolderAddResolvedSeq] = useState(0);
  const [checkingDuplicates, setCheckingDuplicatesRaw] = useState(false);
  const setCheckingDuplicates = useCallback(
    (value: boolean) => {
      setCheckingDuplicatesRaw(value);
      onCheckingDuplicatesChange?.(value);
    },
    [onCheckingDuplicatesChange],
  );
  const [pendingFolder, setPendingFolder] = useState<PendingFolder | null>(
    null,
  );

  const resetDialogState = useCallback(() => {
    setOpen(false);
    setMode("folderAdd");
    setFolderAddPendingInfo(null);
    setFolderRescanPendingInfo(null);
    setItems([]);
    setChoices({});
    setBulkDecision("existing");
    setPageIndex(0);
    setPreview(null);

    // Drain queued watch duplicates that arrived while dialog was busy.
    // setTimeout ensures the close state commits before we reopen.
    setTimeout(() => {
      setWatchDuplicateQueue((prev) => {
        if (prev.length > 0) {
          openWatchDialogRef.current(prev);
        }
        return prev.length > 0 ? [] : prev;
      });
    }, 0);
  }, []);

  const openFolderAddDialog = useCallback(
    (
      name: string,
      path: string,
      duplicates: FolderDuplicateGroup[],
      subdirectories: { name: string; path: string }[],
    ) => {
      setMode("folderAdd");
      setFolderAddPendingInfo({ name, path, subdirectories });
      setFolderRescanPendingInfo(null);
      setItems(duplicates);
      const nextChoices = createChoicesForItems(duplicates, "existing");
      setChoices(nextChoices);
      setBulkDecision(getInitialBulkDecision(duplicates));
      setPageIndex(0);
      setPreview(null);
      setOpen(true);
    },
    [],
  );

  const openWatchDialog = useCallback((duplicates: FolderDuplicateGroup[]) => {
    if (duplicates.length === 0) return;
    setMode("watch");
    setFolderAddPendingInfo(null);
    setFolderRescanPendingInfo(null);
    setItems(duplicates);
    const nextChoices = createChoicesForItems(duplicates, "existing");
    setChoices(nextChoices);
    setBulkDecision(getInitialBulkDecision(duplicates));
    setPageIndex(0);
    setPreview(null);
    setOpen(true);
  }, []);

  const handleFolderAddWithDuplicateCheck = useCallback(
    async (name: string, path: string) => {
      setCheckingDuplicates(true);
      // Show folder in sidebar immediately while checking duplicates
      const subdirs = await window.folder
        .listSubdirectoriesByPath(path)
        .catch(() => []);
      setPendingFolder({ name, path, subdirectories: subdirs });
      try {
        const normalizedPath = normalizeFolderPath(path);
        const existingFolders = await window.folder.list();
        if (
          existingFolders.some(
            (folder) => normalizeFolderPath(folder.path) === normalizedPath,
          )
        ) {
          toast.error(i18n.t("duplicateResolution.pathAlreadyAdded"));
          return;
        }

        const duplicates = await window.folder.findDuplicates(path);
        if (duplicates.length > 0) {
          openFolderAddDialog(name, path, duplicates, subdirs);
          return;
        }

        const folder = await addFolder(name, path);
        seedSubfolders?.(folder.id, subdirs);
        onFolderAdded?.(folder.id);
      } catch (e: unknown) {
        toast.error(
          e instanceof Error ? e.message : i18n.t("error.folderAddFailed"),
        );
      } finally {
        setCheckingDuplicates(false);
        setPendingFolder(null);
      }
    },
    [
      addFolder,
      onFolderAdded,
      openFolderAddDialog,
      seedSubfolders,
      setCheckingDuplicates,
    ],
  );

  const openFolderRescanDialog = useCallback(
    (folder: Folder, duplicates: FolderDuplicateGroup[]) => {
      setMode("rescan");
      setFolderAddPendingInfo(null);
      setFolderRescanPendingInfo({
        id: folder.id,
        name: folder.name,
        path: folder.path,
      });
      setItems(duplicates);
      const nextChoices = createChoicesForItems(duplicates, "existing");
      setChoices(nextChoices);
      setBulkDecision(getInitialBulkDecision(duplicates));
      setPageIndex(0);
      setPreview(null);
      setOpen(true);
    },
    [],
  );

  const handleFolderRescanWithDuplicateCheck = useCallback(
    async (folder: Folder) => {
      const duplicates = await window.folder.findDuplicates(folder.path);
      if (duplicates.length > 0) {
        openFolderRescanDialog(folder, duplicates);
        return;
      }

      onFolderRescan?.(folder.id);
    },
    [onFolderRescan, openFolderRescanDialog],
  );

  const onApplyAll = useCallback(
    (keep: "existing" | "incoming" | "ignore") => {
      setChoices(createChoicesForItems(items, keep));
      setBulkDecision(keep);
    },
    [items],
  );

  const onSelectBulkDecision = useCallback(
    (decision: DuplicateBulkDecision) => {
      if (decision === "manual") {
        setBulkDecision("manual");
        return;
      }
      setBulkDecision(decision);
      setChoices(createChoicesForItems(items, decision));
    },
    [items],
  );

  const onResolve = useCallback(async () => {
    if (items.length === 0) return;
    if (mode === "folderAdd" && !folderAddPendingInfo) return;
    if (mode === "rescan" && !folderRescanPendingInfo) return;

    setResolving(true);
    try {
      const resolutions: FolderDuplicateGroupResolution[] = items.map(
        (item) => ({
          id: item.id,
          hash: item.hash,
          existingEntries: item.existingEntries.map((entry) => ({
            imageId: entry.imageId,
            path: entry.path,
          })),
          incomingPaths: item.incomingEntries.map((entry) => entry.path),
          keep: choices[item.id] ?? "existing",
        }),
      );

      await window.folder.resolveDuplicates(resolutions);

      const pendingRescanFolderId = folderRescanPendingInfo?.id ?? null;

      if (mode === "folderAdd" && folderAddPendingInfo) {
        const createdFolder = await addFolder(
          folderAddPendingInfo.name,
          folderAddPendingInfo.path,
        );
        seedSubfolders?.(createdFolder.id, folderAddPendingInfo.subdirectories);
        onFolderAdded?.(createdFolder.id);
        setFolderAddResolvedSeq((prev) => prev + 1);
      }

      resetDialogState();
      if (mode === "rescan" && pendingRescanFolderId !== null) {
        onFolderRescan?.(pendingRescanFolderId);
      }
    } catch (e: unknown) {
      toast.error(
        i18n.t("duplicateResolution.resolveFailed", {
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setResolving(false);
    }
  }, [
    addFolder,
    choices,
    folderAddPendingInfo,
    folderRescanPendingInfo,
    items,
    mode,
    onFolderAdded,
    onFolderRescan,
    resetDialogState,
    seedSubfolders,
  ]);

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        setOpen(true);
        return;
      }
      if (resolving || mode === "watch") return;
      resetDialogState();
    },
    [mode, resetDialogState, resolving],
  );

  const onPrevPage = useCallback(() => {
    setPageIndex((prev) => Math.max(prev - 1, 0));
  }, []);

  const onNextPage = useCallback(() => {
    setPageIndex((prev) => Math.min(prev + 1, items.length - 1));
  }, [items.length]);

  const onSetChoice = useCallback(
    (itemId: string, keep: "existing" | "incoming" | "ignore") => {
      setChoices((prev) => ({ ...prev, [itemId]: keep }));
      setBulkDecision("manual");
    },
    [],
  );

  const onOpenPreview = useCallback((nextPreview: DuplicatePreview) => {
    setPreview(nextPreview);
  }, []);

  const onPreviewOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) setPreview(null);
  }, []);

  // Refs for onWatchDuplicate handler — avoids re-subscribing on every state change
  const watchStateRef = useRef({ open, mode, resolving, bulkDecision });
  watchStateRef.current = { open, mode, resolving, bulkDecision };
  const openWatchDialogRef = useRef(openWatchDialog);
  openWatchDialogRef.current = openWatchDialog;

  useEffect(() => {
    return window.image.onWatchDuplicate((group) => {
      const {
        open: isOpen,
        mode: currentMode,
        resolving: isResolving,
        bulkDecision: currentBulk,
      } = watchStateRef.current;

      if (isOpen && currentMode === "watch" && !isResolving) {
        // Dialog is open in watch mode — merge into current items
        setItems((prev) => {
          const merged = mergeGroupList(prev, group);
          setChoices((choicePrev) =>
            syncChoicesWithItems(
              merged,
              choicePrev,
              currentBulk === "incoming"
                ? "incoming"
                : currentBulk === "ignore"
                  ? "ignore"
                  : "existing",
            ),
          );
          return merged;
        });
        return;
      }

      if (isOpen || isResolving) {
        // Dialog is busy with another mode — queue for later
        setWatchDuplicateQueue((prev) => mergeGroupList(prev, group));
        return;
      }

      // Dialog is closed — open it directly
      openWatchDialogRef.current([group]);
    });
  }, []);

  // Clamp pageIndex inline — no useEffect needed since it's a pure derivation
  const clampedPageIndex = Math.min(pageIndex, Math.max(items.length - 1, 0));

  return {
    handleFolderAddWithDuplicateCheck,
    handleFolderRescanWithDuplicateCheck,
    folderAddResolvedSeq,
    checkingDuplicates,
    pendingFolder,
    dialog: {
      open,
      mode,
      items,
      choices,
      bulkDecision,
      resolving,
      pageIndex: clampedPageIndex,
      preview,
      onOpenChange,
      onApplyAll,
      onSelectBulkDecision,
      onPrevPage,
      onNextPage,
      onSetChoice,
      onResolve,
      onOpenPreview,
      onPreviewOpenChange,
    },
  };
}

export function toDuplicatePreview(
  side: string,
  fileName: string,
  filePath: string,
): DuplicatePreview {
  return {
    side,
    fileName,
    path: filePath,
    src: toLocalSrc(filePath),
  };
}
