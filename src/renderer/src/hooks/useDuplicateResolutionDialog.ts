import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type {
  Folder,
  FolderDuplicateGroup,
  FolderDuplicateGroupResolution,
} from "@preload/index.d";

export type DuplicateResolutionMode = "folderAdd" | "watch";
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

type UseDuplicateResolutionDialogOptions = {
  addFolder: (name: string, path: string) => Promise<Folder>;
  onFolderAdded?: (folderId: number) => void;
};

type FolderAddPendingInfo = {
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

export class DuplicateResolutionRequiredError extends Error {
  readonly suppressDialogError = true;

  constructor(duplicateCount: number) {
    super(
      `중복 이미지 ${duplicateCount}개가 발견되었습니다. 폴더 추가를 완료하려면 중복 처리 방식을 선택해 주세요.`,
    );
    this.name = "DuplicateResolutionRequiredError";
  }
}

export function useDuplicateResolutionDialog({
  addFolder,
  onFolderAdded,
}: UseDuplicateResolutionDialogOptions): {
  handleFolderAddWithDuplicateCheck: (
    name: string,
    path: string,
  ) => Promise<void>;
  folderAddResolvedSeq: number;
  dialog: DuplicateResolutionDialogModel;
} {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<DuplicateResolutionMode>("folderAdd");
  const [folderAddPendingInfo, setFolderAddPendingInfo] =
    useState<FolderAddPendingInfo | null>(null);
  const [items, setItems] = useState<FolderDuplicateGroup[]>([]);
  const [choices, setChoices] = useState<
    Record<string, "existing" | "incoming" | "ignore">
  >({});
  const [watchDuplicateQueue, setWatchDuplicateQueue] = useState<
    FolderDuplicateGroup[]
  >([]);
  const [bulkDecision, setBulkDecision] =
    useState<DuplicateBulkDecision>("existing");
  const [resolving, setResolving] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [preview, setPreview] = useState<DuplicatePreview | null>(null);
  const [folderAddResolvedSeq, setFolderAddResolvedSeq] = useState(0);

  const resetDialogState = useCallback(() => {
    setOpen(false);
    setMode("folderAdd");
    setFolderAddPendingInfo(null);
    setItems([]);
    setChoices({});
    setBulkDecision("existing");
    setPageIndex(0);
    setPreview(null);
  }, []);

  const openFolderAddDialog = useCallback(
    (name: string, path: string, duplicates: FolderDuplicateGroup[]) => {
      setMode("folderAdd");
      setFolderAddPendingInfo({ name, path });
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
      const normalizedPath = normalizeFolderPath(path);
      const existingFolders = await window.folder.list();
      if (
        existingFolders.some(
          (folder) => normalizeFolderPath(folder.path) === normalizedPath,
        )
      ) {
        throw new Error("이미 추가된 폴더 경로입니다.");
      }

      const duplicates = await window.folder.findDuplicates(path);
      if (duplicates.length > 0) {
        openFolderAddDialog(name, path, duplicates);
        throw new DuplicateResolutionRequiredError(duplicates.length);
      }

      const folder = await addFolder(name, path);
      onFolderAdded?.(folder.id);
    },
    [addFolder, onFolderAdded, openFolderAddDialog],
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

      if (mode === "folderAdd" && folderAddPendingInfo) {
        const createdFolder = await addFolder(
          folderAddPendingInfo.name,
          folderAddPendingInfo.path,
        );
        onFolderAdded?.(createdFolder.id);
        setFolderAddResolvedSeq((prev) => prev + 1);
      }

      resetDialogState();
    } catch (e: unknown) {
      toast.error(
        `중복 이미지 처리 실패: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setResolving(false);
    }
  }, [
    addFolder,
    choices,
    folderAddPendingInfo,
    items,
    mode,
    onFolderAdded,
    resetDialogState,
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

  useEffect(() => {
    return window.image.onWatchDuplicate((group) => {
      if (open && mode === "watch" && !resolving) {
        setItems((prev) => {
          const merged = mergeGroupList(prev, group);
          setChoices((choicePrev) =>
            syncChoicesWithItems(
              merged,
              choicePrev,
              bulkDecision === "incoming"
                ? "incoming"
                : bulkDecision === "ignore"
                  ? "ignore"
                  : "existing",
            ),
          );
          return merged;
        });
        return;
      }

      setWatchDuplicateQueue((prev) => mergeGroupList(prev, group));
    });
  }, [bulkDecision, mode, open, resolving]);

  useEffect(() => {
    if (open || resolving) return;
    if (watchDuplicateQueue.length === 0) return;
    const queuedItems = [...watchDuplicateQueue];
    setWatchDuplicateQueue([]);
    openWatchDialog(queuedItems);
  }, [open, openWatchDialog, resolving, watchDuplicateQueue]);

  useEffect(() => {
    setPageIndex((prev) => Math.min(prev, Math.max(items.length - 1, 0)));
  }, [items.length]);

  return {
    handleFolderAddWithDuplicateCheck,
    folderAddResolvedSeq,
    dialog: {
      open,
      mode,
      items,
      choices,
      bulkDecision,
      resolving,
      pageIndex,
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
