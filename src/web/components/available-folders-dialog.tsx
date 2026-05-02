import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Check, Info, Loader2, RefreshCw } from "lucide-react";
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
import { useApi } from "@/api";
import type { Folder as FolderRecord } from "@preload/index.d";

function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

interface AvailableFoldersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: FolderRecord[];
}

interface DetectedDir {
  name: string;
  path: string;
}

export const AvailableFoldersDialog = memo(function AvailableFoldersDialog({
  open,
  onOpenChange,
  folders,
}: AvailableFoldersDialogProps) {
  const { t } = useTranslation();
  const api = useApi();
  const [detected, setDetected] = useState<DetectedDir[]>([]);
  const [loading, setLoading] = useState(false);

  const registeredPaths = useMemo(() => {
    return new Set(folders.map((f) => normalize(f.path)));
  }, [folders]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.folder.availableDirectories();
      setDetected(list);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (open) {
      void refresh();
    } else {
      setDetected([]);
    }
  }, [open, refresh]);

  // While the dialog is open, refresh whenever the data-root watcher detects
  // a new mount or removal — without this, the user sees stale state until
  // they click the manual refresh button.
  useEffect(() => {
    if (!open) return;
    const off = api.folder.onListChanged?.(() => {
      void refresh();
    });
    return () => off?.();
  }, [open, api, refresh]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" mobileSheet>
        <DialogHeader>
          <DialogTitle>{t("availableFolders.title")}</DialogTitle>
        </DialogHeader>

        <div className="flex gap-3 rounded-md border bg-muted/40 p-3">
          <Info className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
          <div className="space-y-1.5 text-xs">
            <p>{t("availableFolders.description")}</p>
            <p className="text-muted-foreground">
              {t("availableFolders.instruction")}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {t("availableFolders.detected", { count: detected.length })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span className="ml-1.5 text-xs">{t("common.refresh")}</span>
          </Button>
        </div>

        <ScrollArea className="max-h-72 rounded-md border">
          {detected.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              {loading
                ? t("availableFolders.loading")
                : t("availableFolders.empty")}
            </div>
          ) : (
            <ul className="divide-y">
              {detected.map((dir) => {
                const registered = registeredPaths.has(normalize(dir.path));
                return (
                  <li
                    key={dir.path}
                    className="flex items-center gap-3 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {dir.name}
                      </div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        {dir.path}
                      </div>
                    </div>
                    {registered ? (
                      <span className="flex items-center gap-1 text-[10px] text-primary">
                        <Check className="h-3 w-3" />
                        {t("availableFolders.registered")}
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">
                        {t("availableFolders.pending")}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{t("common.close")}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
