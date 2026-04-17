import { memo, useCallback, useEffect, useState } from "react";
import { FolderPlus, Loader2, Check, CheckIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useApi } from "@/api";

interface AvailableFoldersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  registeredPaths: Set<string>;
  onAdd: (dirs: { name: string; path: string }[]) => void;
}

export const AvailableFoldersDialog = memo(function AvailableFoldersDialog({
  open,
  onOpenChange,
  registeredPaths,
  onAdd,
}: AvailableFoldersDialogProps) {
  const { t } = useTranslation();
  const api = useApi();
  const [directories, setDirectories] = useState<{ name: string; path: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSelected(new Set());
    api.folder.availableDirectories().then((dirs) => {
      setDirectories(dirs);
      setLoading(false);
    }).catch(() => {
      setDirectories([]);
      setLoading(false);
    });
  }, [open, api.folder]);

  const unregistered = directories.filter((d) => !registeredPaths.has(d.path));

  const handleToggle = useCallback((path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selected.size === unregistered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(unregistered.map((d) => d.path)));
    }
  }, [selected.size, unregistered]);

  const handleAdd = useCallback(() => {
    const dirs = directories.filter((d) => selected.has(d.path));
    if (dirs.length > 0) {
      onAdd(dirs);
      onOpenChange(false);
    }
  }, [directories, onAdd, onOpenChange, selected]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("availableFolders.title")}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : directories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FolderPlus className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm">{t("availableFolders.empty")}</p>
            <p className="text-xs mt-1">{t("availableFolders.emptyHint")}</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs text-muted-foreground">
                {t("availableFolders.description")}
              </p>
              {unregistered.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-6"
                  onClick={handleSelectAll}
                >
                  {selected.size === unregistered.length
                    ? t("availableFolders.deselectAll")
                    : t("availableFolders.selectAll")}
                </Button>
              )}
            </div>
            <ScrollArea className="h-64 border rounded-md bg-muted/40">
              <div className="p-1.5 space-y-0.5">
                {directories.map((dir) => {
                  const isRegistered = registeredPaths.has(dir.path);
                  const isSelected = selected.has(dir.path);
                  return (
                    <button
                      key={dir.path}
                      type="button"
                      disabled={isRegistered}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2 rounded-md text-left text-sm transition-colors",
                        isRegistered
                          ? "opacity-50 cursor-not-allowed"
                          : isSelected
                            ? "bg-primary/15 ring-1 ring-primary/50 hover:bg-primary/25 cursor-pointer"
                            : "hover:bg-muted-foreground/10 cursor-pointer",
                      )}
                      onClick={() => !isRegistered && handleToggle(dir.path)}
                    >
                      {isRegistered ? (
                        <Check className="h-4 w-4 text-muted-foreground shrink-0" />
                      ) : (
                        <div
                          className={cn(
                            "size-4 shrink-0 rounded-sm border transition-colors flex items-center justify-center",
                            isSelected
                              ? "bg-primary border-primary text-primary-foreground"
                              : "border-muted-foreground/40",
                          )}
                        >
                          {isSelected && <CheckIcon className="size-3.5" />}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{dir.name}</p>
                        <p className="text-xs text-muted-foreground font-mono truncate">
                          {dir.path}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{t("common.cancel")}</Button>
          </DialogClose>
          <Button
            onClick={handleAdd}
            disabled={selected.size === 0 || loading}
          >
            {t("availableFolders.add", { count: selected.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
