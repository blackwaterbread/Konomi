import {
  Folder,
  Clock,
  Plus,
  FolderPlus,
  GripVertical,
  Trash2,
  Loader2,
  Eye,
  EyeClosed,
  ExternalLink,
  Star,
  Tag,
  Shuffle,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  X,
} from "lucide-react";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useFolderDialog } from "@/hooks/useFolderDialog";
import {
  useDuplicateResolutionDialog,
  type PendingFolder,
} from "@/hooks/useDuplicateResolutionDialog";
import { Button } from "@/components/ui/button";
import { DuplicateResolutionDialog } from "@/components/duplicate-resolution-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Category, Folder as FolderRecord } from "@preload/index.d";
import type { Subfolder } from "@/hooks/useSubfolderState";
import { useTranslation } from "react-i18next";

interface SidebarViewState {
  activeView: string;
  onViewChange: (view: string) => void;
}

interface SidebarFolderState {
  folders: FolderRecord[];
  selectedFolderIds?: Set<number>;
  collapsedFolderIds?: Set<number>;
  rollbackRequest?: { id: number; folderIds: number[] } | null;
  scanningFolderIds?: Set<number>;
  scanning?: boolean;
  subfoldersByFolder?: Map<number, Subfolder[]>;
  isSubfolderVisible?: (path: string, folderId: number) => boolean;
  isRootVisible?: (folderId: number) => boolean;
  isFolderPartial?: (folderId: number) => boolean;
}

interface SidebarFolderActions {
  createFolder: (name: string, path: string) => Promise<FolderRecord>;
  addFolders: (paths: string[]) => Promise<{
    added: FolderRecord[];
    errors: { path: string; message: string }[];
  }>;
  deleteFolder: (id: number) => Promise<void>;
  renameFolder: (id: number, name: string) => Promise<void>;
  reorderFolders: (ids: number[]) => void;
  onFolderToggle?: (id: number) => void;
  onFolderToggleCollapse?: (id: number) => void;
  onFolderRemoved?: (id: number) => void;
  onFolderAdded?: (folderId: number) => void;
  onFolderCancelled?: (id: number) => void;
  onFolderRescan?: (id: number) => void;
  onSubfolderToggle?: (path: string, folderId: number) => void;
  onRootToggle?: (folderId: number) => void;
  seedSubfolders?: (
    folderId: number,
    subdirs: { name: string; path: string }[],
  ) => void;
}

interface SidebarCategoryState {
  categories: Category[];
  selectedCategoryId: number | null;
}

interface SidebarCategoryActions {
  onCategorySelect: (id: number | null) => void;
  onCategoryCreate: (name: string) => void;
  onCategoryRename: (id: number, name: string) => void;
  onCategoryDelete: (id: number) => void;
  onCategoryReorder: (ids: number[]) => void;
  onCategoryAddByPrompt: (id: number, query: string) => void;
  onRandomRefresh: () => void;
}

interface SidebarProps {
  view: SidebarViewState;
  folderState: SidebarFolderState;
  folderActions: SidebarFolderActions;
  categoryState: SidebarCategoryState;
  categoryActions: SidebarCategoryActions;
  isAnalyzing?: boolean;
  onCheckingDuplicatesChange?: (checking: boolean) => void;
}

export interface SidebarHandle {
  openFolderDialog: () => void;
}

const views = [
  { id: "all", icon: Folder },
  { id: "recent", icon: Clock },
] as const;

interface SidebarNewCategoryDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}

const SidebarNewCategoryDialog = memo(function SidebarNewCategoryDialog({
  open,
  onClose,
  onCreate,
}: SidebarNewCategoryDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");

  const handleCreate = useCallback(() => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setName("");
    onCreate(trimmedName);
  }, [name, onCreate]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setName("");
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("sidebar.dialog.newCategoryTitle")}</DialogTitle>
        </DialogHeader>
        <Input
          placeholder={t("sidebar.dialog.newCategoryPlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate();
          }}
        />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{t("common.cancel")}</Button>
          </DialogClose>
          <Button onClick={handleCreate} disabled={!name.trim()}>
            {t("sidebar.dialog.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

interface SidebarAddByPromptDialogProps {
  categoryId: number | null;
  onClose: () => void;
  onSubmit: (categoryId: number, query: string) => void;
}

const SidebarAddByPromptDialog = memo(function SidebarAddByPromptDialog({
  categoryId,
  onClose,
  onSubmit,
}: SidebarAddByPromptDialogProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const open = categoryId !== null;

  const handleSubmit = useCallback(() => {
    if (categoryId === null) return;
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;
    setQuery("");
    onSubmit(categoryId, trimmedQuery);
  }, [categoryId, onSubmit, query]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setQuery("");
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("sidebar.dialog.addByPromptTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">
            {t("sidebar.dialog.addByPromptDescription")}
          </p>
          <Input
            placeholder={t("sidebar.dialog.addByPromptPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{t("common.cancel")}</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={!query.trim()}>
            {t("sidebar.dialog.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

interface SidebarNewFolderDialogProps {
  openRequest: number;
  closeRequest: number;
  onSubmit: (name: string, path: string) => Promise<void>;
}

const SidebarNewFolderDialog = memo(function SidebarNewFolderDialog({
  openRequest,
  closeRequest,
  onSubmit,
}: SidebarNewFolderDialogProps) {
  const { t } = useTranslation();
  const {
    open,
    name,
    path,
    canSubmit,
    setName,
    handleBrowse,
    handleSubmit,
    handleOpenChange,
  } = useFolderDialog(onSubmit);
  const lastOpenRequestRef = useRef(0);
  const lastCloseRequestRef = useRef(0);

  useEffect(() => {
    if (openRequest === 0 || openRequest === lastOpenRequestRef.current) {
      return;
    }

    lastOpenRequestRef.current = openRequest;
    handleOpenChange(true);
  }, [handleOpenChange, openRequest]);

  useEffect(() => {
    if (closeRequest === 0 || closeRequest === lastCloseRequestRef.current) {
      return;
    }

    lastCloseRequestRef.current = closeRequest;
    handleOpenChange(false);
  }, [closeRequest, handleOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("sidebar.dialog.newFolderTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">
              {t("sidebar.dialog.name")}
            </label>
            <Input
              placeholder={t("sidebar.dialog.namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">
              {t("sidebar.dialog.path")}
            </label>
            <div className="flex gap-2">
              <Input
                placeholder={t("sidebar.dialog.pathPlaceholder")}
                value={path}
                className="flex-1 font-mono text-xs"
                readOnly
              />
              <Button variant="outline" onClick={handleBrowse}>
                {t("sidebar.dialog.browse")}
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{t("common.cancel")}</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {t("sidebar.dialog.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

interface MultiFolderEntry {
  path: string;
  name: string;
}

function pathToName(folderPath: string): string {
  return (
    folderPath.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ||
    folderPath
  );
}

interface SidebarMultiFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (
    paths: string[],
  ) => Promise<{ errors: { path: string; message: string }[] }>;
}

const SidebarMultiFolderDialog = memo(function SidebarMultiFolderDialog({
  open,
  onOpenChange,
  onSubmit,
}: SidebarMultiFolderDialogProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<MultiFolderEntry[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitErrors, setSubmitErrors] = useState<
    { path: string; message: string }[]
  >([]);

  const reset = useCallback(() => {
    setEntries([]);
    setSubmitErrors([]);
    setIsSubmitting(false);
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next && isSubmitting) return;
      if (!next) reset();
      onOpenChange(next);
    },
    [isSubmitting, onOpenChange, reset],
  );

  const handleBrowse = useCallback(async () => {
    if (isSubmitting) return;
    try {
      const paths = await window.dialog.selectDirectories();
      if (!paths || paths.length === 0) return;
      setEntries((prev) => {
        const existing = new Set(prev.map((e) => e.path));
        const newEntries = paths
          .filter((p) => !existing.has(p))
          .map((p) => ({ path: p, name: pathToName(p) }));
        return [...prev, ...newEntries];
      });
    } catch {
      // dialog cancelled
    }
  }, [isSubmitting]);

  const handleRemove = useCallback((path: string) => {
    setEntries((prev) => prev.filter((e) => e.path !== path));
    setSubmitErrors((prev) => prev.filter((e) => e.path !== path));
  }, []);

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);
    setSubmitErrors([]);
    const paths = entries.map((e) => e.path);
    const { errors } = await onSubmit(paths);
    setIsSubmitting(false);
    if (errors.length > 0) {
      setSubmitErrors(errors);
      setEntries((prev) =>
        prev.filter((e) => errors.some((err) => err.path === e.path)),
      );
    } else {
      reset();
      onOpenChange(false);
    }
  }, [entries, onOpenChange, onSubmit, reset]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent closeDisabled={isSubmitting}>
        <DialogHeader>
          <DialogTitle>{t("sidebar.dialog.multiFolderTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {entries.length > 0 && (
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {entries.map((entry) => {
                const error = submitErrors.find((e) => e.path === entry.path);
                return (
                  <div
                    key={entry.path}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-3 py-2",
                      error && "border-destructive/40 bg-destructive/5",
                    )}
                  >
                    <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {entry.name}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono truncate">
                        {entry.path}
                      </p>
                      {error && (
                        <p className="text-xs text-destructive mt-0.5">
                          {error.message}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={() => handleRemove(entry.path)}
                      disabled={isSubmitting}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
          {entries.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <FolderPlus className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">{t("sidebar.dialog.multiFolderEmpty")}</p>
            </div>
          )}
          <Button
            variant="outline"
            className="w-full"
            onClick={handleBrowse}
            disabled={isSubmitting}
          >
            <FolderPlus className="h-4 w-4 mr-2" />
            {t("sidebar.dialog.multiFolderBrowse")}
          </Button>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={isSubmitting}>
              {t("common.cancel")}
            </Button>
          </DialogClose>
          <Button
            onClick={handleSubmit}
            disabled={entries.length === 0 || isSubmitting}
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            ) : null}
            {isSubmitting
              ? t("sidebar.dialog.loadingFiles")
              : t("sidebar.dialog.addCount", {
                  count: entries.length,
                })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

interface SidebarFolderRowProps {
  folder: FolderRecord;
  isScanning: boolean;
  isSelected: boolean;
  isPartial?: boolean;
  dragTargetPosition: "before" | "after" | null;
  isDragging: boolean;
  scanning?: boolean;
  isAnalyzing?: boolean;
  depth?: number;
  hasChildren?: boolean;
  isCollapsed?: boolean;
  onRename: (id: number, name: string) => Promise<void>;
  onToggle?: (id: number) => void;
  onToggleCollapse?: (id: number) => void;
  onDeleteRequest: (target: { id: number; name: string }) => void;
  onReveal: (folderId: number) => void;
  onRescan: (folder: FolderRecord) => void;
  onDragStart?: (id: number) => void;
  onDragOver?: (id: number, position: "before" | "after") => void;
  onDrop?: (id: number, position: "before" | "after") => void;
  onDragEnd?: () => void;
  isRootVisible?: boolean;
  onRootToggle?: (id: number) => void;
}

const SidebarFolderRow = memo(function SidebarFolderRow({
  folder,
  isScanning,
  isSelected,
  isPartial = false,
  dragTargetPosition,
  isDragging,
  scanning,
  isAnalyzing,
  depth = 0,
  hasChildren = false,
  isCollapsed = false,
  onRename,
  onToggle,
  onToggleCollapse,
  onDeleteRequest,
  onReveal,
  onRescan,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isRootVisible,
  onRootToggle,
}: SidebarFolderRowProps) {
  const { t } = useTranslation();
  /* 
  간편하게 폴더/카테고리 Sidebar에서 Input 입력으로 이름 바꿀 수 있는 기능이었는데 이런저런 이유로 비활성화
  그리고 이거 요상한 버그가 있는데 카테고리 Input에 이름 바꾸면 위에 Folder까지 리렌더링 되는데, 
  폴더 Input에 먼저 입력이 들어가고 난 뒤에 카테고리 Input 변경하면 또 리렌더링이 의도한대로 작동한다. 
  고치다가 걍 버릴거라 냅둠
  
  const inputRef = useRef<HTMLInputElement>(null);
  const skipCommitRef = useRef(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingName, setEditingName] = useState(folder.name);

  useEffect(() => {
    if (!isEditing) {
      setEditingName(folder.name);
    }
  }, [folder.name, isEditing]);

  const handleStartEditing = useCallback(() => {
    if (isScanning) return;
    setEditingName(folder.name);
    setIsEditing(true);
  }, [folder.name, isScanning]);

  const handleCancelEditing = useCallback(() => {
    skipCommitRef.current = true;
    setEditingName(folder.name);
    setIsEditing(false);
  }, [folder.name]);

  const handleCommitEditing = useCallback(async () => {
    const trimmedName = editingName.trim();

    if (trimmedName && trimmedName !== folder.name) {
      try {
        await onRename(folder.id, trimmedName);
      } catch (e: unknown) {
        toast.error(
          t("sidebar.errors.folderRenameFailed", {
            message: e instanceof Error ? e.message : String(e),
          }),
        );
        setEditingName(folder.name);
      }
    } else {
      setEditingName(folder.name);
    }

    setIsEditing(false);
  }, [editingName, folder.id, folder.name, onRename, t]);
  */

  const inputRef = useRef<HTMLInputElement>(null);
  const skipCommitRef = useRef(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const isEditing = editingName !== null;
  const currentEditingName = editingName ?? folder.name;

  const handleStartEditing = useCallback(() => {
    if (isScanning) return;
    setEditingName(folder.name);
  }, [folder.name, isScanning]);

  const handleCancelEditing = useCallback(() => {
    skipCommitRef.current = true;
    setEditingName(null);
  }, []);

  const handleCommitEditing = useCallback(async () => {
    const trimmedName = currentEditingName.trim();

    if (trimmedName && trimmedName !== folder.name) {
      try {
        await onRename(folder.id, trimmedName);
      } catch (e: unknown) {
        toast.error(
          t("sidebar.errors.folderRenameFailed", {
            message: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    }

    setEditingName(null);
  }, [currentEditingName, folder.id, folder.name, onRename, t]);

  const depthPadding = [
    "px-2",
    "pl-5 pr-2",
    "pl-8 pr-2",
    "pl-11 pr-2",
  ] as const;
  const paddingClass = depthPadding[Math.min(depth, 3)];
  // depth >= 2에서는 eye 아이콘도 hover에서만 표시 (공간 절약)
  const eyeHoverOnly = depth >= 2;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          draggable={!isEditing && depth === 0}
          onDragStart={(e) => {
            if (isEditing || depth !== 0) return;
            onDragStart?.(folder.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            if (isEditing || depth !== 0) return;
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            const pos =
              e.clientY < rect.top + rect.height / 2 ? "before" : "after";
            onDragOver?.(folder.id, pos);
          }}
          onDrop={(e) => {
            if (depth !== 0) return;
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            const pos =
              e.clientY < rect.top + rect.height / 2 ? "before" : "after";
            onDrop?.(folder.id, pos);
          }}
          onDragEnd={() => onDragEnd?.()}
          className={cn(
            "group relative flex items-center gap-2 py-1.5 rounded-md cursor-pointer hover:bg-sidebar-accent",
            paddingClass,
            dragTargetPosition === "before" &&
              "before:absolute before:left-2 before:right-2 before:top-0 before:h-0.5 before:bg-primary before:rounded-full",
            dragTargetPosition === "after" &&
              "after:absolute after:left-2 after:right-2 after:bottom-0 after:h-0.5 after:bg-primary after:rounded-full",
            isDragging && "opacity-60",
          )}
        >
          {/* 왼쪽 아이콘: 자식 있으면 chevron, root이면 grip, 그 외 spacer */}
          {hasChildren ? (
            <button
              className="h-3.5 w-3.5 shrink-0 flex items-center justify-center text-muted-foreground/70 hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse?.(folder.id);
              }}
            >
              {isCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
          ) : depth === 0 ? (
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0 cursor-grab active:cursor-grabbing" />
          ) : (
            <span className="h-3.5 w-3.5 shrink-0" />
          )}
          <Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          {isEditing ? (
            <input
              ref={inputRef}
              className="flex-1 min-w-0 text-sm bg-transparent border-b border-primary outline-none text-foreground"
              value={currentEditingName}
              autoFocus
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={() => {
                if (skipCommitRef.current) {
                  skipCommitRef.current = false;
                  return;
                }
                void handleCommitEditing();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") inputRef.current?.blur();
                if (e.key === "Escape") {
                  handleCancelEditing();
                }
              }}
            />
          ) : (
            <span className="flex-1 min-w-0 text-sm text-foreground truncate cursor-pointer">
              {folder.name}
            </span>
          )}
          {isEditing ? null : isScanning ? (
            <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin shrink-0" />
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-5 w-5",
                  eyeHoverOnly && "opacity-0 group-hover:opacity-100",
                  isPartial || isSelected
                    ? "text-primary"
                    : "text-muted-foreground hover:text-primary",
                )}
                onClick={() => onToggle?.(folder.id)}
                title={t("sidebar.folders.toggleAll")}
              >
                {isPartial ? (
                  <EyeClosed className="h-3 w-3" />
                ) : (
                  <Eye className="h-3 w-3" />
                )}
              </Button>
              {hasChildren && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-5 w-5",
                    isRootVisible !== false
                      ? "text-primary"
                      : "text-muted-foreground hover:text-primary",
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRootToggle?.(folder.id);
                  }}
                  title={t("sidebar.folders.toggleRoot")}
                >
                  <Folder className="h-2.5 w-2.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                onClick={() =>
                  onDeleteRequest({
                    id: folder.id,
                    name: folder.name,
                  })
                }
                disabled={scanning}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem
          onSelect={() => {
            onReveal(folder.id);
          }}
        >
          <ExternalLink className="h-4 w-4" />
          {t("sidebar.folders.openInExplorer")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={scanning || isAnalyzing}
          onSelect={() => {
            onRescan(folder);
          }}
        >
          {t("sidebar.folders.rescan")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={isScanning} onSelect={handleStartEditing}>
          {t("sidebar.folders.rename")}
        </ContextMenuItem>
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          disabled={scanning}
          onSelect={() =>
            onDeleteRequest({
              id: folder.id,
              name: folder.name,
            })
          }
        >
          {t("sidebar.folders.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

interface SidebarSubfolderRowProps {
  subfolder: Subfolder;
  isVisible: boolean;
  onToggle?: (path: string, folderId: number) => void;
}

const SidebarSubfolderRow = memo(function SidebarSubfolderRow({
  subfolder,
  isVisible,
  onToggle,
}: SidebarSubfolderRowProps) {
  return (
    <div
      className={cn(
        "group flex items-center gap-2 pl-5 pr-2 py-0.5 rounded-md cursor-pointer hover:bg-sidebar-accent",
        isVisible
          ? "text-muted-foreground hover:text-foreground"
          : "text-muted-foreground/40 hover:text-muted-foreground",
      )}
      onClick={() => onToggle?.(subfolder.path, subfolder.folderId)}
    >
      <span className="h-3.5 w-3.5 shrink-0" />
      <Folder className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 min-w-0 text-sm truncate">{subfolder.name}</span>
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-5 w-5",
          isVisible
            ? "opacity-0 group-hover:opacity-100 text-primary"
            : "text-muted-foreground/40 hover:text-primary",
        )}
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.(subfolder.path, subfolder.folderId);
        }}
      >
        <Eye className="h-3 w-3" />
      </Button>
    </div>
  );
});

interface SidebarCategoryRowProps {
  category: Category;
  isSelected: boolean;
  isDragTarget: boolean;
  isDragging: boolean;
  onSelect: (id: number | null) => void;
  onRename: (id: number, name: string) => void;
  onDelete: (id: number) => void;
  onAddByPrompt: (id: number) => void;
  onRandomRefresh: () => void;
  onDragStart: (id: number) => void;
  onDragOver: (id: number) => void;
  onDrop: (id: number) => void;
  onDragEnd: () => void;
}

const SidebarCategoryRow = memo(function SidebarCategoryRow({
  category,
  isSelected,
  isDragTarget,
  isDragging,
  onSelect,
  onRename,
  onDelete,
  onAddByPrompt,
  onRandomRefresh,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: SidebarCategoryRowProps) {
  const { t } = useTranslation();
  const isDraggable = !category.isBuiltin;

  // Category inline rename notes:
  // Add your comments here.
  /*
  const inputRef = useRef<HTMLInputElement>(null);
  const skipCommitRef = useRef(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingName, setEditingName] = useState(category.name);
  const isDraggable = !category.isBuiltin && !isEditing;

  useEffect(() => {
    if (!isEditing) {
      setEditingName(category.name);
    }
  }, [category.name, isEditing]);

  const handleStartEditing = useCallback(() => {
    if (category.isBuiltin) return;
    setEditingName(category.name);
    setIsEditing(true);
  }, [category.isBuiltin, category.name]);

  const handleCancelEditing = useCallback(() => {
    skipCommitRef.current = true;
    setEditingName(category.name);
    setIsEditing(false);
  }, [category.name]);

  const handleCommitEditing = useCallback(() => {
    const trimmedName = editingName.trim();
    if (trimmedName && trimmedName !== category.name) {
      onRename(category.id, trimmedName);
    } else {
      setEditingName(category.name);
    }
    setIsEditing(false);
  }, [category.id, category.name, editingName, onRename]);
  */

  const inputRef = useRef<HTMLInputElement>(null);
  const skipCommitRef = useRef(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const isEditing = editingName !== null;
  const currentEditingName = editingName ?? category.name;
  const isContextRenameEnabled = !category.isBuiltin;
  const isInteractiveDraggable = !category.isBuiltin && !isEditing;

  const handleStartEditing = useCallback(() => {
    if (!isContextRenameEnabled) return;
    setEditingName(category.name);
  }, [category.name, isContextRenameEnabled]);

  const handleCancelEditing = useCallback(() => {
    skipCommitRef.current = true;
    setEditingName(null);
  }, []);

  const handleCommitEditing = useCallback(() => {
    const trimmedName = currentEditingName.trim();
    if (trimmedName && trimmedName !== category.name) {
      onRename(category.id, trimmedName);
    }
    setEditingName(null);
  }, [category.id, category.name, currentEditingName, onRename]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          draggable={isInteractiveDraggable}
          onDragStart={(e) => {
            if (!isInteractiveDraggable) return;
            onDragStart(category.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            if (!isInteractiveDraggable) return;
            e.preventDefault();
            onDragOver(category.id);
          }}
          onDrop={(e) => {
            e.preventDefault();
            onDrop(category.id);
          }}
          onDragEnd={onDragEnd}
          className={cn(
            "group flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors",
            "cursor-pointer",
            isDraggable && "cursor-grab active:cursor-grabbing",
            isDragTarget && "ring-1 ring-primary/40",
            isDragging && "opacity-60",
            isSelected
              ? "bg-sidebar-accent text-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
          )}
          onClick={() => {
            if (!isEditing) {
              onSelect(isSelected ? null : category.id);
            }
          }}
        >
          {category.isBuiltin ? (
            <span className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
          )}
          {category.isBuiltin && category.order === 1 ? (
            <Shuffle className="h-3.5 w-3.5 shrink-0" />
          ) : category.isBuiltin ? (
            <Star
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                isSelected && "fill-current",
              )}
            />
          ) : (
            <Tag className="h-3.5 w-3.5 shrink-0" />
          )}
          {isEditing ? (
            <input
              ref={inputRef}
              className="flex-1 min-w-0 text-sm bg-transparent border-b border-primary outline-none text-foreground"
              value={currentEditingName}
              autoFocus
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={() => {
                if (skipCommitRef.current) {
                  skipCommitRef.current = false;
                  return;
                }
                handleCommitEditing();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") inputRef.current?.blur();
                if (e.key === "Escape") {
                  handleCancelEditing();
                }
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="flex-1 text-sm truncate cursor-pointer">
              {category.isBuiltin
                ? t(
                    category.order === 1
                      ? "sidebar.categories.randomPick"
                      : "sidebar.categories.favorites",
                  )
                : category.name}
            </span>
          )}
          {category.isBuiltin && category.order === 1 && isSelected && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-muted-foreground hover:text-foreground"
              title={t("sidebar.categories.reroll")}
              onClick={(e) => {
                e.stopPropagation();
                onRandomRefresh();
              }}
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          )}
          {!category.isBuiltin && !isEditing && (
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground hover:text-foreground"
                title={t("sidebar.categories.addByPrompt")}
                onClick={(e) => {
                  e.stopPropagation();
                  onAddByPrompt(category.id);
                }}
              >
                <Plus className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(category.id);
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      {!category.isBuiltin && (
        <ContextMenuContent className="w-48">
          <ContextMenuItem onSelect={handleStartEditing}>
            {t("sidebar.folders.rename")}
          </ContextMenuItem>
          <ContextMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => onDelete(category.id)}
          >
            {t("sidebar.folders.delete")}
          </ContextMenuItem>
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
});

interface SidebarFoldersSectionProps {
  folders: FolderRecord[];
  selectedFolderIds?: Set<number>;
  collapsedFolderIds?: Set<number>;
  scanningFolderIds?: Set<number>;
  draggingFolderId: number | null;
  folderDropTargetId: number | null;
  folderDropPosition: "before" | "after";
  scanning?: boolean;
  checkingDuplicates?: boolean;
  isAnalyzing?: boolean;
  pendingFolder?: PendingFolder | null;
  subfoldersByFolder?: Map<number, Subfolder[]>;
  isSubfolderVisible?: (path: string, folderId: number) => boolean;
  isRootVisible?: (folderId: number) => boolean;
  isFolderPartial?: (folderId: number) => boolean;
  onOpenNewFolder: () => void;
  onAddMultipleFolders: () => void;
  onToggle?: (id: number) => void;
  onToggleCollapse?: (id: number) => void;
  onRename: (id: number, name: string) => Promise<void>;
  onDeleteRequest: (target: { id: number; name: string }) => void;
  onReveal: (folderId: number) => void;
  onRescan: (folder: FolderRecord) => void;
  onDragStart: (id: number) => void;
  onDragOver: (id: number, position: "before" | "after") => void;
  onDrop: (id: number, position: "before" | "after") => void;
  onDragEnd: () => void;
  onSubfolderToggle?: (path: string, folderId: number) => void;
  onRootToggle?: (folderId: number) => void;
}

const SidebarFoldersSection = memo(function SidebarFoldersSection({
  folders,
  selectedFolderIds,
  collapsedFolderIds,
  scanningFolderIds,
  draggingFolderId,
  folderDropTargetId,
  folderDropPosition,
  scanning,
  checkingDuplicates,
  isAnalyzing,
  pendingFolder,
  subfoldersByFolder,
  isSubfolderVisible,
  isRootVisible,
  isFolderPartial,
  onOpenNewFolder,
  onAddMultipleFolders,
  onToggle,
  onToggleCollapse,
  onRename,
  onDeleteRequest,
  onReveal,
  onRescan,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onSubfolderToggle,
  onRootToggle,
}: SidebarFoldersSectionProps) {
  const { t } = useTranslation();
  const addDisabled = scanning || checkingDuplicates || isAnalyzing;

  return (
    <div className="pt-4 border-t border-border" data-tour="sidebar-folders">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground select-none">
          <FolderPlus className="h-4 w-4" />
          {t("sidebar.sections.folders")}
        </div>
        {addDisabled ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground"
            disabled
            title={isAnalyzing ? t("sidebar.folders.addDisabled") : undefined}
          >
            <Loader2 className="h-4 w-4 animate-spin" />
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <DropdownMenuItem onSelect={onOpenNewFolder}>
                {t("sidebar.folders.addOne")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onAddMultipleFolders}>
                {t("sidebar.folders.addMultiple")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {folders.length === 0 && !pendingFolder ? (
        <p className="text-xs text-muted-foreground px-8 select-none">
          {t("sidebar.folders.empty")}
        </p>
      ) : (
        <div className="space-y-1">
          {folders.map((folder) => {
            const subfolders = subfoldersByFolder?.get(folder.id) ?? [];
            const hasChildren = subfolders.length > 0;
            const isCollapsed = collapsedFolderIds?.has(folder.id) ?? false;
            const isDropTarget =
              draggingFolderId !== null &&
              draggingFolderId !== folder.id &&
              folderDropTargetId === folder.id;

            return (
              <div key={folder.id}>
                <SidebarFolderRow
                  folder={folder}
                  depth={0}
                  hasChildren={hasChildren}
                  isCollapsed={isCollapsed}
                  isScanning={scanningFolderIds?.has(folder.id) ?? false}
                  isSelected={selectedFolderIds?.has(folder.id) ?? false}
                  isPartial={isFolderPartial?.(folder.id) ?? false}
                  dragTargetPosition={isDropTarget ? folderDropPosition : null}
                  isDragging={draggingFolderId === folder.id}
                  scanning={scanning || checkingDuplicates}
                  isAnalyzing={isAnalyzing}
                  onRename={onRename}
                  onToggle={onToggle}
                  onToggleCollapse={onToggleCollapse}
                  onDeleteRequest={onDeleteRequest}
                  onReveal={onReveal}
                  onRescan={onRescan}
                  onDragStart={onDragStart}
                  onDragOver={onDragOver}
                  onDrop={onDrop}
                  onDragEnd={onDragEnd}
                  isRootVisible={isRootVisible?.(folder.id) ?? true}
                  onRootToggle={onRootToggle}
                />
                {hasChildren && !isCollapsed && (
                  <div className="mt-1">
                    {subfolders.map((sf) => (
                      <SidebarSubfolderRow
                        key={sf.path}
                        subfolder={sf}
                        isVisible={
                          isSubfolderVisible?.(sf.path, sf.folderId) ?? true
                        }
                        onToggle={onSubfolderToggle}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {pendingFolder && (
            <div key="__pending__" className="select-none">
              <div className="group flex items-center gap-1 px-2 py-1 text-xs rounded-md text-muted-foreground opacity-70">
                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                <span className="truncate flex-1 ml-0.5">
                  {pendingFolder.name}
                </span>
              </div>
              {pendingFolder.subdirectories.length > 0 && (
                <div className="mt-1">
                  {pendingFolder.subdirectories.map((sub) => (
                    <div
                      key={sub.path}
                      className="flex items-center gap-1 pl-7 pr-2 py-0.5 text-xs text-muted-foreground opacity-50"
                    >
                      <Folder className="h-3 w-3 shrink-0" />
                      <span className="truncate">{sub.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

interface SidebarCategoriesSectionProps {
  categories: Category[];
  selectedCategoryId: number | null;
  draggingCategoryId: number | null;
  categoryDropTargetId: number | null;
  onOpenNewCategory: () => void;
  onSelect: (id: number | null) => void;
  onRename: (id: number, name: string) => void;
  onDelete: (id: number) => void;
  onAddByPrompt: (id: number) => void;
  onRandomRefresh: () => void;
  onDragStart: (id: number) => void;
  onDragOver: (id: number) => void;
  onDrop: (id: number) => void;
  onDragEnd: () => void;
}

const SidebarCategoriesSection = memo(function SidebarCategoriesSection({
  categories,
  selectedCategoryId,
  draggingCategoryId,
  categoryDropTargetId,
  onOpenNewCategory,
  onSelect,
  onRename,
  onDelete,
  onAddByPrompt,
  onRandomRefresh,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: SidebarCategoriesSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="border-t border-border pt-4" data-tour="sidebar-categories">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground select-none">
          <Tag className="h-4 w-4" />
          {t("sidebar.sections.categories")}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={onOpenNewCategory}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="space-y-1">
        {categories.map((category) => {
          const isSelected = selectedCategoryId === category.id;
          const isDragTarget =
            draggingCategoryId !== null &&
            draggingCategoryId !== category.id &&
            categoryDropTargetId === category.id &&
            !category.isBuiltin;

          return (
            <SidebarCategoryRow
              key={category.id}
              category={category}
              isSelected={isSelected}
              isDragTarget={isDragTarget}
              isDragging={draggingCategoryId === category.id}
              onSelect={onSelect}
              onRename={onRename}
              onDelete={onDelete}
              onAddByPrompt={onAddByPrompt}
              onRandomRefresh={onRandomRefresh}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
            />
          );
        })}
        {categories.length === 0 && (
          <p className="text-xs text-muted-foreground px-1">
            {t("sidebar.categories.empty")}
          </p>
        )}
      </div>
    </div>
  );
});

export const Sidebar = memo(
  forwardRef<SidebarHandle, SidebarProps>(function Sidebar(
    {
      view,
      folderState,
      folderActions,
      categoryState,
      categoryActions,
      isAnalyzing,
      onCheckingDuplicatesChange,
    },
    ref,
  ) {
    const { t } = useTranslation();
    const { activeView, onViewChange } = view;
    const {
      folders,
      selectedFolderIds,
      collapsedFolderIds,
      rollbackRequest,
      scanningFolderIds,
      scanning,
      subfoldersByFolder,
      isSubfolderVisible,
      isRootVisible,
      isFolderPartial,
    } = folderState;
    const {
      createFolder,
      addFolders,
      deleteFolder,
      renameFolder,
      reorderFolders,
      onFolderToggle,
      onFolderToggleCollapse,
      onFolderRemoved,
      onFolderAdded,
      onFolderCancelled,
      onFolderRescan,
      onSubfolderToggle,
      onRootToggle,
      seedSubfolders,
    } = folderActions;
    const { categories, selectedCategoryId } = categoryState;
    const {
      onCategorySelect,
      onCategoryCreate,
      onCategoryRename,
      onCategoryDelete,
      onCategoryReorder,
      onCategoryAddByPrompt,
      onRandomRefresh,
    } = categoryActions;
    const [isNewCategoryOpen, setIsNewCategoryOpen] = useState(false);
    const [addByPromptCategoryId, setAddByPromptCategoryId] = useState<
      number | null
    >(null);
    const [folderOpenRequest, setFolderOpenRequest] = useState(0);
    const processedRollbackRequestIdRef = useRef<number | null>(null);
    const [deleteFolderTarget, setDeleteFolderTarget] = useState<{
      id: number;
      name: string;
    } | null>(null);
    const [deleteFolderPending, setDeleteFolderPending] = useState(false);
    const [draggingFolderId, setDraggingFolderId] = useState<number | null>(
      null,
    );
    const [folderDropTargetId, setFolderDropTargetId] = useState<number | null>(
      null,
    );
    const [folderDropPosition, setFolderDropPosition] = useState<
      "before" | "after"
    >("after");
    const [draggingCategoryId, setDraggingCategoryId] = useState<number | null>(
      null,
    );
    const [categoryDropTargetId, setCategoryDropTargetId] = useState<
      number | null
    >(null);

    const {
      dialog: duplicateResolutionDialog,
      folderAddResolvedSeq,
      checkingDuplicates,
      pendingFolder,
      handleFolderAddWithDuplicateCheck,
      handleFolderRescanWithDuplicateCheck,
    } = useDuplicateResolutionDialog({
      addFolder: createFolder,
      onFolderAdded,
      onFolderRescan,
      seedSubfolders,
    });

    useEffect(() => {
      onCheckingDuplicatesChange?.(checkingDuplicates);
    }, [checkingDuplicates, onCheckingDuplicatesChange]);

    const handleRemoveFolder = async (id: number) => {
      try {
        await deleteFolder(id);
        onFolderRemoved?.(id);
        return true;
      } catch (e: unknown) {
        toast.error(
          t("sidebar.errors.folderDeleteFailed", {
            message: e instanceof Error ? e.message : String(e),
          }),
        );
        return false;
      }
    };

    const handleDeleteFolderDialogOpenChange = (open: boolean) => {
      if (!open && !deleteFolderPending) {
        setDeleteFolderTarget(null);
      }
    };

    const handleConfirmDeleteFolder = async () => {
      if (!deleteFolderTarget || deleteFolderPending) return;
      setDeleteFolderPending(true);
      const deleted = await handleRemoveFolder(deleteFolderTarget.id);
      if (deleted) {
        setDeleteFolderTarget(null);
      }
      setDeleteFolderPending(false);
    };

    const handleCancelFolder = useCallback(
      async (id: number) => {
        try {
          await deleteFolder(id);
          onFolderCancelled?.(id);
        } catch (e: unknown) {
          toast.error(
            t("sidebar.errors.folderCancelFailed", {
              message: e instanceof Error ? e.message : String(e),
            }),
          );
        }
      },
      [deleteFolder, onFolderCancelled, t],
    );

    const handleFolderRescanRequest = useCallback(
      async (folderToRescan: FolderRecord) => {
        try {
          await handleFolderRescanWithDuplicateCheck(folderToRescan);
        } catch (e: unknown) {
          toast.error(
            t("error.scanFailed", {
              message: e instanceof Error ? e.message : String(e),
            }),
          );
        }
      },
      [handleFolderRescanWithDuplicateCheck, t],
    );

    const handleRevealFolderInExplorer = useCallback(
      async (folderId: number) => {
        try {
          await window.folder.revealInExplorer(folderId);
        } catch (e: unknown) {
          toast.error(
            t("error.folderRevealFailed", {
              message: e instanceof Error ? e.message : String(e),
            }),
          );
        }
      },
      [t],
    );

    useEffect(() => {
      if (!rollbackRequest) return;
      if (processedRollbackRequestIdRef.current === rollbackRequest.id) return;
      processedRollbackRequestIdRef.current = rollbackRequest.id;

      void (async () => {
        for (const folderId of rollbackRequest.folderIds) {
          await handleCancelFolder(folderId);
        }
      })();
    }, [handleCancelFolder, rollbackRequest]);

    const handleOpenFolderDialog = useCallback(() => {
      setFolderOpenRequest((current) => current + 1);
    }, []);

    const [multiFolderOpen, setMultiFolderOpen] = useState(false);

    const handleAddMultipleFolders = useCallback(() => {
      setMultiFolderOpen(true);
    }, []);

    const handleMultiFolderSubmit = useCallback(
      async (paths: string[]) => {
        const { added, errors } = await addFolders(paths);
        for (const folder of added) {
          onFolderAdded?.(folder.id);
        }
        if (added.length > 0) {
          toast.success(
            t("sidebar.folders.addedMultiple", { count: added.length }),
          );
        }
        return { errors };
      },
      [addFolders, onFolderAdded, t],
    );

    useImperativeHandle(
      ref,
      () => ({
        openFolderDialog: handleOpenFolderDialog,
      }),
      [handleOpenFolderDialog],
    );

    const handleCloseNewCategoryDialog = useCallback(() => {
      setIsNewCategoryOpen(false);
    }, []);

    const handleCreateCategory = useCallback(
      (name: string) => {
        const trimmedName = name.trim();
        if (!trimmedName) return;
        onCategoryCreate(trimmedName);
        setIsNewCategoryOpen(false);
      },
      [onCategoryCreate],
    );

    const handleCloseAddByPromptDialog = useCallback(() => {
      setAddByPromptCategoryId(null);
    }, []);

    const handleAddByPromptSubmit = useCallback(
      (categoryId: number, query: string) => {
        const trimmedQuery = query.trim();
        if (!trimmedQuery) return;
        onCategoryAddByPrompt(categoryId, trimmedQuery);
        setAddByPromptCategoryId(null);
      },
      [onCategoryAddByPrompt],
    );

    const handleFolderRename = useCallback(
      async (id: number, name: string) => {
        await renameFolder(id, name);
      },
      [renameFolder],
    );

    const handleDeleteFolderRequest = useCallback(
      (target: { id: number; name: string }) => {
        setDeleteFolderTarget(target);
      },
      [],
    );

    const handleOpenAddByPromptDialog = useCallback((id: number) => {
      setAddByPromptCategoryId(id);
    }, []);

    const handleOpenNewCategoryDialog = useCallback(() => {
      setIsNewCategoryOpen(true);
    }, []);

    const handleFolderDragStart = useCallback((id: number) => {
      setDraggingFolderId(id);
    }, []);

    const handleFolderDragOver = useCallback(
      (id: number, position: "before" | "after") => {
        if (draggingFolderId === null || draggingFolderId === id) return;
        setFolderDropTargetId((prev) => (prev === id ? prev : id));
        setFolderDropPosition(position);
      },
      [draggingFolderId],
    );

    const handleFolderDragEnd = useCallback(() => {
      setDraggingFolderId(null);
      setFolderDropTargetId(null);
      setFolderDropPosition("after");
    }, []);

    const handleFolderDrop = useCallback(
      (targetId: number, position: "before" | "after") => {
        if (draggingFolderId === null || draggingFolderId === targetId) {
          handleFolderDragEnd();
          return;
        }

        const currentIds = folders.map((folder) => folder.id);
        const from = currentIds.indexOf(draggingFolderId);
        let to = currentIds.indexOf(targetId);
        if (from < 0 || to < 0) {
          handleFolderDragEnd();
          return;
        }

        const nextIds = [...currentIds];
        nextIds.splice(from, 1);
        // After removing, recalculate target index
        to = nextIds.indexOf(targetId);
        const insertAt = position === "before" ? to : to + 1;
        nextIds.splice(insertAt, 0, draggingFolderId);
        reorderFolders(nextIds);
        handleFolderDragEnd();
      },
      [draggingFolderId, folders, handleFolderDragEnd, reorderFolders],
    );

    const handleCategoryDragStart = useCallback((id: number) => {
      setDraggingCategoryId(id);
    }, []);

    const handleCategoryDragOver = useCallback(
      (id: number) => {
        if (draggingCategoryId === null || draggingCategoryId === id) return;
        setCategoryDropTargetId((prev) => (prev === id ? prev : id));
      },
      [draggingCategoryId],
    );

    const handleCategoryDragEnd = useCallback(() => {
      setDraggingCategoryId(null);
      setCategoryDropTargetId(null);
    }, []);

    const handleCategoryDrop = useCallback(
      (targetId: number) => {
        if (draggingCategoryId === null || draggingCategoryId === targetId) {
          handleCategoryDragEnd();
          return;
        }

        const customIds = categories
          .filter((cat) => !cat.isBuiltin)
          .map((cat) => cat.id);
        const from = customIds.indexOf(draggingCategoryId);
        const to = customIds.indexOf(targetId);
        if (from < 0 || to < 0) {
          handleCategoryDragEnd();
          return;
        }

        const nextIds = [...customIds];
        const [moved] = nextIds.splice(from, 1);
        nextIds.splice(to, 0, moved);
        onCategoryReorder(nextIds);
        handleCategoryDragEnd();
      },
      [
        categories,
        draggingCategoryId,
        handleCategoryDragEnd,
        onCategoryReorder,
      ],
    );

    return (
      <>
        <aside className="w-full h-full border-r border-border bg-sidebar flex flex-col">
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-4 space-y-6">
              {/* Views */}
              <div className="space-y-1" data-tour="sidebar-views">
                {views.map((view) => {
                  const Icon = view.icon;
                  return (
                    <Button
                      key={view.id}
                      variant="ghost"
                      className={cn(
                        "w-full justify-start gap-3 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent",
                        activeView === view.id &&
                          selectedCategoryId === null &&
                          "bg-sidebar-accent text-foreground",
                      )}
                      onClick={() => {
                        onViewChange(view.id);
                      }}
                    >
                      <Icon className="h-4 w-4" />
                      {t(`sidebar.views.${view.id}`)}
                    </Button>
                  );
                })}
              </div>

              <SidebarFoldersSection
                folders={folders}
                selectedFolderIds={selectedFolderIds}
                collapsedFolderIds={collapsedFolderIds}
                scanningFolderIds={scanningFolderIds}
                draggingFolderId={draggingFolderId}
                folderDropTargetId={folderDropTargetId}
                folderDropPosition={folderDropPosition}
                scanning={scanning}
                checkingDuplicates={checkingDuplicates}
                isAnalyzing={isAnalyzing}
                pendingFolder={pendingFolder}
                subfoldersByFolder={subfoldersByFolder}
                isSubfolderVisible={isSubfolderVisible}
                isRootVisible={isRootVisible}
                isFolderPartial={isFolderPartial}
                onOpenNewFolder={handleOpenFolderDialog}
                onAddMultipleFolders={handleAddMultipleFolders}
                onToggle={onFolderToggle}
                onToggleCollapse={onFolderToggleCollapse}
                onRename={handleFolderRename}
                onDeleteRequest={handleDeleteFolderRequest}
                onReveal={handleRevealFolderInExplorer}
                onRescan={handleFolderRescanRequest}
                onDragStart={handleFolderDragStart}
                onDragOver={handleFolderDragOver}
                onDrop={handleFolderDrop}
                onDragEnd={handleFolderDragEnd}
                onSubfolderToggle={onSubfolderToggle}
                onRootToggle={onRootToggle}
              />

              <SidebarCategoriesSection
                categories={categories}
                selectedCategoryId={selectedCategoryId}
                draggingCategoryId={draggingCategoryId}
                categoryDropTargetId={categoryDropTargetId}
                onOpenNewCategory={handleOpenNewCategoryDialog}
                onSelect={onCategorySelect}
                onRename={onCategoryRename}
                onDelete={onCategoryDelete}
                onAddByPrompt={handleOpenAddByPromptDialog}
                onRandomRefresh={onRandomRefresh}
                onDragStart={handleCategoryDragStart}
                onDragOver={handleCategoryDragOver}
                onDrop={handleCategoryDrop}
                onDragEnd={handleCategoryDragEnd}
              />
            </div>
          </ScrollArea>
        </aside>

        <SidebarNewCategoryDialog
          open={isNewCategoryOpen}
          onClose={handleCloseNewCategoryDialog}
          onCreate={handleCreateCategory}
        />

        <SidebarAddByPromptDialog
          key={addByPromptCategoryId ?? "closed"}
          categoryId={addByPromptCategoryId}
          onClose={handleCloseAddByPromptDialog}
          onSubmit={handleAddByPromptSubmit}
        />

        <DuplicateResolutionDialog {...duplicateResolutionDialog} />

        <Dialog
          open={deleteFolderTarget !== null}
          onOpenChange={handleDeleteFolderDialogOpenChange}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("sidebar.dialog.deleteFolderTitle")}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {t("sidebar.dialog.deleteFolderDescription", {
                name: deleteFolderTarget?.name ?? "",
              })}
            </p>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost" disabled={deleteFolderPending}>
                  {t("common.cancel")}
                </Button>
              </DialogClose>
              <Button
                variant="destructive"
                onClick={handleConfirmDeleteFolder}
                disabled={deleteFolderPending}
              >
                {deleteFolderPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : null}
                {deleteFolderPending
                  ? t("sidebar.dialog.deleting")
                  : t("common.delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <SidebarNewFolderDialog
          openRequest={folderOpenRequest}
          closeRequest={folderAddResolvedSeq}
          onSubmit={handleFolderAddWithDuplicateCheck}
        />
        <SidebarMultiFolderDialog
          open={multiFolderOpen}
          onOpenChange={setMultiFolderOpen}
          onSubmit={handleMultiFolderSubmit}
        />
      </>
    );
  }),
);

Sidebar.displayName = "Sidebar";
