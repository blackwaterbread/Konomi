import {
  Folder,
  Clock,
  Plus,
  FolderPlus,
  GripVertical,
  Trash2,
  Loader2,
  Eye,
  ExternalLink,
  Star,
  Tag,
  Shuffle,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useFolderDialog } from "@/hooks/useFolderDialog";
import { useDuplicateResolutionDialog } from "@/hooks/useDuplicateResolutionDialog";
import { useFolders } from "@/hooks/useFolders";
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
import { useTranslation } from "react-i18next";

interface SidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
  selectedFolderIds?: Set<number>;
  onFolderToggle?: (id: number) => void;
  onFolderRemoved?: (id: number) => void;
  onFolderAdded?: (folderId: number) => void;
  onFolderCancelled?: (id: number) => void;
  onFolderRescan?: (id: number) => void;
  rollbackRequest?: { id: number; folderIds: number[] } | null;
  scanningFolderIds?: Set<number>;
  scanning?: boolean;
  categories: Category[];
  selectedCategoryId: number | null;
  onCategorySelect: (id: number | null) => void;
  onCategoryCreate: (name: string) => void;
  onCategoryRename: (id: number, name: string) => void;
  onCategoryDelete: (id: number) => void;
  onCategoryReorder: (ids: number[]) => void;
  onCategoryAddByPrompt: (id: number, query: string) => void;
  onRandomRefresh: () => void;
  isAnalyzing?: boolean;
  onFolderCountChange?: (count: number | null) => void;
  folderDialogRequest?: number;
}

const views = [
  { id: "all", icon: Folder },
  { id: "recent", icon: Clock },
] as const;

export function Sidebar({
  activeView,
  onViewChange,
  selectedFolderIds,
  onFolderToggle,
  onFolderRemoved,
  onFolderAdded,
  onFolderCancelled,
  onFolderRescan,
  rollbackRequest,
  scanningFolderIds,
  scanning,
  categories,
  selectedCategoryId,
  onCategorySelect,
  onCategoryCreate,
  onCategoryRename,
  onCategoryDelete,
  onCategoryReorder,
  onCategoryAddByPrompt,
  onRandomRefresh,
  isAnalyzing,
  onFolderCountChange,
  folderDialogRequest,
}: SidebarProps) {
  const { t } = useTranslation();
  const {
    folders,
    hasLoaded,
    addFolder,
    removeFolder,
    renameFolder,
    reorderFolders,
  } = useFolders();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(
    null,
  );
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const categoryInputRef = useRef<HTMLInputElement>(null);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [isNewCategoryOpen, setIsNewCategoryOpen] = useState(false);
  const [addByPromptCategoryId, setAddByPromptCategoryId] = useState<
    number | null
  >(null);
  const [addByPromptQuery, setAddByPromptQuery] = useState("");
  const processedRollbackRequestIdRef = useRef<number | null>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [deleteFolderPending, setDeleteFolderPending] = useState(false);
  const [draggingFolderId, setDraggingFolderId] = useState<number | null>(null);
  const [folderDropTargetId, setFolderDropTargetId] = useState<number | null>(
    null,
  );
  const [draggingCategoryId, setDraggingCategoryId] = useState<number | null>(
    null,
  );
  const [categoryDropTargetId, setCategoryDropTargetId] = useState<
    number | null
  >(null);

  const duplicateResolution = useDuplicateResolutionDialog({
    addFolder,
    onFolderAdded,
    onFolderRescan,
  });
  const folder = useFolderDialog(
    duplicateResolution.handleFolderAddWithDuplicateCheck,
  );
  const handleFolderDialogOpenChange = folder.handleOpenChange;

  useEffect(() => {
    if (duplicateResolution.folderAddResolvedSeq === 0) return;
    handleFolderDialogOpenChange(false);
  }, [duplicateResolution.folderAddResolvedSeq, handleFolderDialogOpenChange]);

  useEffect(() => {
    onFolderCountChange?.(hasLoaded ? folders.length : null);
  }, [folders.length, hasLoaded, onFolderCountChange]);

  const folderDialogRequestRef = useRef(0);
  useEffect(() => {
    if (
      folderDialogRequest &&
      folderDialogRequest !== folderDialogRequestRef.current
    ) {
      folderDialogRequestRef.current = folderDialogRequest;
      folder.handleOpenChange(true);
    }
  }, [folderDialogRequest, folder]);

  const handleRemoveFolder = async (id: number) => {
    try {
      await removeFolder(id);
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
        await removeFolder(id);
        onFolderCancelled?.(id);
      } catch (e: unknown) {
        toast.error(
          t("sidebar.errors.folderCancelFailed", {
            message: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    },
    [onFolderCancelled, removeFolder, t],
  );

  const handleFolderRescanRequest = useCallback(
    async (folderToRescan: FolderRecord) => {
      try {
        await duplicateResolution.handleFolderRescanWithDuplicateCheck(
          folderToRescan,
        );
      } catch (e: unknown) {
        toast.error(
          t("error.scanFailed", {
            message: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    },
    [duplicateResolution, t],
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

  const handleCreateCategory = () => {
    const name = newCategoryName.trim();
    if (!name) return;
    onCategoryCreate(name);
    setNewCategoryName("");
    setIsNewCategoryOpen(false);
  };

  const handleAddByPromptSubmit = () => {
    if (addByPromptCategoryId === null || !addByPromptQuery.trim()) return;
    onCategoryAddByPrompt(addByPromptCategoryId, addByPromptQuery.trim());
    setAddByPromptQuery("");
    setAddByPromptCategoryId(null);
  };

  const handleFolderDragEnd = () => {
    setDraggingFolderId(null);
    setFolderDropTargetId(null);
  };

  const handleFolderDrop = (targetId: number) => {
    if (draggingFolderId === null || draggingFolderId === targetId) {
      handleFolderDragEnd();
      return;
    }

    const currentIds = folders.map((folder) => folder.id);
    const from = currentIds.indexOf(draggingFolderId);
    const to = currentIds.indexOf(targetId);
    if (from < 0 || to < 0) {
      handleFolderDragEnd();
      return;
    }

    const nextIds = [...currentIds];
    const [moved] = nextIds.splice(from, 1);
    nextIds.splice(to, 0, moved);
    reorderFolders(nextIds);
    handleFolderDragEnd();
  };

  const handleCategoryDragEnd = () => {
    setDraggingCategoryId(null);
    setCategoryDropTargetId(null);
  };

  const handleCategoryDrop = (targetId: number) => {
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
  };

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
                      onCategorySelect(null);
                    }}
                  >
                    <Icon className="h-4 w-4" />
                    {t(`sidebar.views.${view.id}`)}
                  </Button>
                );
              })}
            </div>

            {/* Folders */}
            <div
              className="pt-4 border-t border-border"
              data-tour="sidebar-folders"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground select-none">
                  <FolderPlus className="h-4 w-4" />
                  {t("sidebar.sections.folders")}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => folder.handleOpenChange(true)}
                  disabled={scanning || isAnalyzing}
                  title={
                    isAnalyzing ? t("sidebar.folders.addDisabled") : undefined
                  }
                >
                  {scanning || isAnalyzing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                </Button>
              </div>
              {folders.length === 0 ? (
                <p className="text-xs text-muted-foreground px-8 select-none">
                  {t("sidebar.folders.empty")}
                </p>
              ) : (
                <div className="space-y-1">
                  {folders.map((f) => {
                    const isScanning = scanningFolderIds?.has(f.id) ?? false;
                    const isSelected = selectedFolderIds?.has(f.id) ?? false;
                    const isDragTarget =
                      draggingFolderId !== null &&
                      draggingFolderId !== f.id &&
                      folderDropTargetId === f.id;
                    return (
                      <ContextMenu key={f.id}>
                        <ContextMenuTrigger asChild>
                          <div
                            draggable={editingId !== f.id}
                            onDragStart={(e) => {
                              setDraggingFolderId(f.id);
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            onDragOver={(e) => {
                              if (
                                draggingFolderId === null ||
                                draggingFolderId === f.id
                              )
                                return;
                              e.preventDefault();
                              if (folderDropTargetId !== f.id) {
                                setFolderDropTargetId(f.id);
                              }
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              handleFolderDrop(f.id);
                            }}
                            onDragEnd={handleFolderDragEnd}
                            className={cn(
                              "group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-sidebar-accent",
                              isDragTarget &&
                                "bg-sidebar-accent ring-1 ring-primary/40",
                              draggingFolderId === f.id && "opacity-60",
                            )}
                          >
                            <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0 cursor-grab active:cursor-grabbing" />
                            <Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            {editingId === f.id ? (
                              <input
                                ref={inputRef}
                                className="flex-1 min-w-0 text-sm bg-transparent border-b border-primary outline-none text-foreground"
                                value={editingName}
                                autoFocus
                                onChange={(e) => setEditingName(e.target.value)}
                                onBlur={async () => {
                                  if (
                                    editingName.trim() &&
                                    editingName.trim() !== f.name
                                  ) {
                                    try {
                                      await renameFolder(
                                        f.id,
                                        editingName.trim(),
                                      );
                                    } catch (e: unknown) {
                                      toast.error(
                                        t("sidebar.errors.folderRenameFailed", {
                                          message:
                                            e instanceof Error
                                              ? e.message
                                              : String(e),
                                        }),
                                      );
                                      setEditingName(f.name);
                                    }
                                  }
                                  setEditingId(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter")
                                    inputRef.current?.blur();
                                  if (e.key === "Escape") {
                                    setEditingName(f.name);
                                    setEditingId(null);
                                  }
                                }}
                              />
                            ) : (
                              <span
                                className="flex-1 min-w-0 text-sm text-foreground truncate cursor-text"
                                onClick={() => {
                                  if (!isScanning) {
                                    setEditingId(f.id);
                                    setEditingName(f.name);
                                  }
                                }}
                              >
                                {f.name}
                              </span>
                            )}
                            {editingId === f.id ? null : isScanning ? (
                              <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin shrink-0" />
                            ) : (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className={cn(
                                    "h-5 w-5",
                                    isSelected
                                      ? "text-primary"
                                      : "text-muted-foreground hover:text-primary",
                                  )}
                                  onClick={() => onFolderToggle?.(f.id)}
                                >
                                  <Eye className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                                  onClick={() =>
                                    setDeleteFolderTarget({
                                      id: f.id,
                                      name: f.name,
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
                              void handleRevealFolderInExplorer(f.id);
                            }}
                          >
                            <ExternalLink className="h-4 w-4" />
                            {t("sidebar.folders.openInExplorer")}
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            disabled={scanning || isAnalyzing}
                            onSelect={() => {
                              void handleFolderRescanRequest(f);
                            }}
                          >
                            {t("sidebar.folders.rescan")}
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            disabled={isScanning}
                            onSelect={() => {
                              setEditingId(f.id);
                              setEditingName(f.name);
                            }}
                          >
                            {t("sidebar.folders.rename")}
                          </ContextMenuItem>
                          <ContextMenuItem
                            className="text-destructive focus:text-destructive"
                            disabled={scanning}
                            onSelect={() =>
                              setDeleteFolderTarget({
                                id: f.id,
                                name: f.name,
                              })
                            }
                          >
                            {t("sidebar.folders.delete")}
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Categories */}
            <div
              className="border-t border-border pt-4"
              data-tour="sidebar-categories"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground select-none">
                  <Tag className="h-4 w-4" />
                  {t("sidebar.sections.categories")}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => setIsNewCategoryOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-1">
                {categories.map((cat) => {
                  const isSelected = selectedCategoryId === cat.id;
                  const isDraggable =
                    !cat.isBuiltin && editingCategoryId !== cat.id;
                  const isDragTarget =
                    draggingCategoryId !== null &&
                    draggingCategoryId !== cat.id &&
                    categoryDropTargetId === cat.id &&
                    !cat.isBuiltin;
                  return (
                    <div
                      key={cat.id}
                      draggable={isDraggable}
                      onDragStart={(e) => {
                        if (!isDraggable) return;
                        setDraggingCategoryId(cat.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(e) => {
                        if (
                          draggingCategoryId === null ||
                          draggingCategoryId === cat.id ||
                          cat.isBuiltin
                        ) {
                          return;
                        }
                        e.preventDefault();
                        if (categoryDropTargetId !== cat.id) {
                          setCategoryDropTargetId(cat.id);
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (!cat.isBuiltin) {
                          handleCategoryDrop(cat.id);
                        } else {
                          handleCategoryDragEnd();
                        }
                      }}
                      onDragEnd={handleCategoryDragEnd}
                      className={cn(
                        "group flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors",
                        editingCategoryId === cat.id
                          ? "bg-sidebar-accent"
                          : "cursor-pointer",
                        isDraggable && "cursor-grab active:cursor-grabbing",
                        isDragTarget && "ring-1 ring-primary/40",
                        draggingCategoryId === cat.id && "opacity-60",
                        isSelected && editingCategoryId !== cat.id
                          ? "bg-sidebar-accent text-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                      )}
                      onClick={() => {
                        if (editingCategoryId !== cat.id)
                          onCategorySelect(isSelected ? null : cat.id);
                      }}
                    >
                      {cat.isBuiltin ? (
                        <span className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                      )}
                      {cat.isBuiltin && cat.order === 1 ? (
                        <Shuffle className="h-3.5 w-3.5 shrink-0" />
                      ) : cat.isBuiltin ? (
                        <Star
                          className={cn(
                            "h-3.5 w-3.5 shrink-0",
                            isSelected && "fill-current",
                          )}
                        />
                      ) : (
                        <Tag className="h-3.5 w-3.5 shrink-0" />
                      )}
                      {editingCategoryId === cat.id ? (
                        <input
                          ref={categoryInputRef}
                          className="flex-1 min-w-0 text-sm bg-transparent border-b border-primary outline-none text-foreground"
                          value={editingCategoryName}
                          autoFocus
                          onChange={(e) =>
                            setEditingCategoryName(e.target.value)
                          }
                          onBlur={() => {
                            if (
                              editingCategoryName.trim() &&
                              editingCategoryName.trim() !== cat.name
                            ) {
                              onCategoryRename(
                                cat.id,
                                editingCategoryName.trim(),
                              );
                            }
                            setEditingCategoryId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter")
                              categoryInputRef.current?.blur();
                            if (e.key === "Escape") {
                              setEditingCategoryName(cat.name);
                              setEditingCategoryId(null);
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span
                          className={cn(
                            "flex-1 text-sm truncate",
                            !cat.isBuiltin && "cursor-text",
                          )}
                          onClick={(e) => {
                            if (!cat.isBuiltin) {
                              e.stopPropagation();
                              setEditingCategoryId(cat.id);
                              setEditingCategoryName(cat.name);
                            }
                          }}
                        >
                          {cat.isBuiltin
                            ? t(
                                cat.order === 1
                                  ? "sidebar.categories.randomPick"
                                  : "sidebar.categories.favorites",
                              )
                            : cat.name}
                        </span>
                      )}
                      {cat.isBuiltin && cat.order === 1 && isSelected && (
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
                      {!cat.isBuiltin && editingCategoryId !== cat.id && (
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 text-muted-foreground hover:text-foreground"
                            title={t("sidebar.categories.addByPrompt")}
                            onClick={(e) => {
                              e.stopPropagation();
                              setAddByPromptCategoryId(cat.id);
                              setAddByPromptQuery("");
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
                              onCategoryDelete(cat.id);
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {categories.length === 0 && (
                  <p className="text-xs text-muted-foreground px-1">
                    {t("sidebar.categories.empty")}
                  </p>
                )}
              </div>
            </div>
          </div>
        </ScrollArea>
      </aside>

      {/* New Category Dialog */}
      <Dialog open={isNewCategoryOpen} onOpenChange={setIsNewCategoryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("sidebar.dialog.newCategoryTitle")}</DialogTitle>
          </DialogHeader>
          <Input
            placeholder={t("sidebar.dialog.newCategoryPlaceholder")}
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateCategory();
            }}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{t("common.cancel")}</Button>
            </DialogClose>
            <Button
              onClick={handleCreateCategory}
              disabled={!newCategoryName.trim()}
            >
              {t("sidebar.dialog.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add by Prompt Dialog */}
      <Dialog
        open={addByPromptCategoryId !== null}
        onOpenChange={(open) => {
          if (!open) setAddByPromptCategoryId(null);
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
              value={addByPromptQuery}
              onChange={(e) => setAddByPromptQuery(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddByPromptSubmit();
              }}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{t("common.cancel")}</Button>
            </DialogClose>
            <Button
              onClick={handleAddByPromptSubmit}
              disabled={!addByPromptQuery.trim()}
            >
              {t("sidebar.dialog.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DuplicateResolutionDialog {...duplicateResolution.dialog} />

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

      <Dialog
        modal={false}
        open={folder.open}
        onOpenChange={folder.handleOpenChange}
      >
        <DialogContent closeDisabled={folder.isSubmitting}>
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
                value={folder.name}
                onChange={(e) => folder.setName(e.target.value)}
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
                  value={folder.path}
                  className="flex-1 font-mono text-xs"
                  readOnly
                />
                <Button
                  variant="outline"
                  onClick={folder.handleBrowse}
                  disabled={folder.isSubmitting}
                >
                  {t("sidebar.dialog.browse")}
                </Button>
              </div>
            </div>
            {folder.submitError && (
              <p className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2">
                {folder.submitError}
              </p>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" disabled={folder.isSubmitting}>
                {t("common.cancel")}
              </Button>
            </DialogClose>
            <Button onClick={folder.handleSubmit} disabled={!folder.canSubmit}>
              {folder.isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : null}
              {folder.isSubmitting
                ? t("sidebar.dialog.loadingFiles")
                : t("sidebar.dialog.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
