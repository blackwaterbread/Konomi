import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DuplicateResolutionDialogModel } from "@/hooks/useDuplicateResolutionDialog";
import { toDuplicatePreview } from "@/hooks/useDuplicateResolutionDialog";

type DuplicateResolutionDialogProps = DuplicateResolutionDialogModel;

export function DuplicateResolutionDialog({
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
}: DuplicateResolutionDialogProps) {
  const { t } = useTranslation();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const currentItem = items[pageIndex] ?? null;
  const showItems = Boolean(
    currentItem && (items.length === 1 || bulkDecision === "manual"),
  );
  const sectionMinHeightClass = "min-h-[30rem]";
  const sectionMessageMinHeightClass = "min-h-[calc(30rem-1.5rem)]";
  const previewSide = t("duplicateResolution.previewSide");
  const currentPreview = currentItem
    ? toDuplicatePreview(
        previewSide,
        currentItem.previewFileName,
        currentItem.previewPath,
      )
    : null;

  const hasDestructiveAction = useMemo(
    () =>
      items.some((item) => {
        const keep = choices[item.id] ?? "existing";
        if (keep === "ignore") return false;
        if (keep === "existing") return item.incomingEntries.length > 0;
        return (
          item.existingEntries.length > 0 || item.incomingEntries.length > 1
        );
      }),
    [choices, items],
  );

  const handleResolveClick = () => {
    if (resolving || items.length === 0) return;
    if (!hasDestructiveAction) {
      void onResolve();
      return;
    }
    setConfirmDeleteOpen(true);
  };

  const handleConfirmResolve = async () => {
    setConfirmDeleteOpen(false);
    await onResolve();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-5xl"
          closeDisabled={resolving || mode === "watch"}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="-mb-6">
              {mode === "watch"
                ? t("duplicateResolution.title.watch")
                : mode === "rescan"
                  ? t("duplicateResolution.title.rescan")
                  : t("duplicateResolution.title.folderAdd")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground select-none">
              {mode === "watch"
                ? t("duplicateResolution.description.watch")
                : mode === "rescan"
                  ? t("duplicateResolution.description.rescan", {
                      count: items.length,
                    })
                  : t("duplicateResolution.description.folderAdd", {
                      count: items.length,
                    })}
            </p>
            {items.length > 1 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-foreground/80 select-none">
                  {t("duplicateResolution.bulkLabel")}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant={
                      bulkDecision === "existing" ? "default" : "outline"
                    }
                    size="sm"
                    onClick={() => onApplyAll("existing")}
                    disabled={resolving}
                  >
                    {t("duplicateResolution.bulk.existing")}
                  </Button>
                  <Button
                    variant={
                      bulkDecision === "incoming" ? "default" : "outline"
                    }
                    size="sm"
                    onClick={() => onApplyAll("incoming")}
                    disabled={resolving}
                  >
                    {t("duplicateResolution.bulk.incoming")}
                  </Button>
                  <Button
                    variant={bulkDecision === "ignore" ? "default" : "outline"}
                    size="sm"
                    onClick={() => onApplyAll("ignore")}
                    disabled={resolving}
                  >
                    {t("duplicateResolution.bulk.ignore")}
                  </Button>
                  <Button
                    variant={bulkDecision === "manual" ? "default" : "outline"}
                    size="sm"
                    onClick={() => onSelectBulkDecision("manual")}
                    disabled={resolving}
                  >
                    {t("duplicateResolution.bulk.manual")}
                  </Button>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-foreground/80 select-none">
                {t("duplicateResolution.listLabel")}
              </p>
              <div
                className={`rounded-lg border border-border/60 bg-card p-3 ${sectionMinHeightClass}`}
              >
                {showItems && currentItem && currentPreview ? (
                  <div className="h-full space-y-3">
                    <div className="flex items-center justify-between">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onPrevPage}
                        disabled={resolving || pageIndex === 0}
                      >
                        <ChevronLeft className="h-4 w-4" />
                        {t("duplicateResolution.previous")}
                      </Button>
                      <p className="text-sm text-muted-foreground tabular-nums">
                        {pageIndex + 1} / {items.length}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onNextPage}
                        disabled={resolving || pageIndex >= items.length - 1}
                      >
                        {t("duplicateResolution.next")}
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="space-y-3">
                      <button
                        type="button"
                        className="w-full rounded-md border border-border/50 bg-secondary/20 overflow-hidden"
                        onClick={() => onOpenPreview(currentPreview)}
                        disabled={resolving}
                      >
                        <img
                          src={currentPreview.src}
                          alt={currentItem.previewFileName}
                          className="w-full h-56 object-contain bg-black/10 cursor-zoom-in"
                        />
                      </button>

                      <div className="rounded-md border border-border/60 bg-secondary/10 px-3 py-2 text-xs text-muted-foreground space-y-2 max-h-40 overflow-y-auto">
                        <p>
                          {t("duplicateResolution.summary", {
                            existingCount: currentItem.existingEntries.length,
                            incomingCount: currentItem.incomingEntries.length,
                          })}
                        </p>
                        {currentItem.existingEntries.length > 0 && (
                          <div>
                            <p className="font-semibold text-foreground/70">
                              {t("duplicateResolution.pathLabel.existing")}
                            </p>
                            {currentItem.existingEntries.map((entry) => (
                              <p key={entry.path} className="break-all pl-2">
                                {entry.path}
                              </p>
                            ))}
                          </div>
                        )}
                        {currentItem.incomingEntries.length > 0 && (
                          <div>
                            <p className="font-semibold text-foreground/70">
                              {t("duplicateResolution.pathLabel.incoming")}
                            </p>
                            {currentItem.incomingEntries.map((entry) => (
                              <p key={entry.path} className="break-all pl-2">
                                {entry.path}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2">
                        <Button
                          variant={
                            (choices[currentItem.id] ?? "existing") ===
                            "existing"
                              ? "default"
                              : "outline"
                          }
                          size="sm"
                          onClick={() =>
                            onSetChoice(currentItem.id, "existing")
                          }
                          disabled={
                            resolving ||
                            currentItem.existingEntries.length === 0
                          }
                        >
                          {t("duplicateResolution.choice.existing")}
                        </Button>
                        <Button
                          variant={
                            (choices[currentItem.id] ?? "existing") ===
                            "incoming"
                              ? "default"
                              : "outline"
                          }
                          size="sm"
                          onClick={() =>
                            onSetChoice(currentItem.id, "incoming")
                          }
                          disabled={
                            resolving ||
                            currentItem.incomingEntries.length === 0
                          }
                        >
                          {t("duplicateResolution.choice.incoming")}
                        </Button>
                        <Button
                          variant={
                            (choices[currentItem.id] ?? "existing") === "ignore"
                              ? "default"
                              : "outline"
                          }
                          size="sm"
                          onClick={() => onSetChoice(currentItem.id, "ignore")}
                          disabled={resolving}
                        >
                          {t("duplicateResolution.choice.ignore")}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    className={`flex items-center justify-center px-4 ${sectionMessageMinHeightClass}`}
                  >
                    <p className="text-center text-xl text-muted-foreground select-none">
                      {t("duplicateResolution.manualEmpty")}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            {mode !== "watch" && (
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={resolving}
              >
                {t("common.cancel")}
              </Button>
            )}
            <Button
              onClick={handleResolveClick}
              disabled={resolving || items.length === 0}
            >
              {resolving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : null}
              {mode === "watch"
                ? t("duplicateResolution.applySelection")
                : mode === "rescan"
                  ? t("duplicateResolution.resolveAndRescanFolder")
                  : t("duplicateResolution.resolveAndAddFolder")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmDeleteOpen}
        onOpenChange={(nextOpen) => {
          if (!resolving) setConfirmDeleteOpen(nextOpen);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("duplicateResolution.confirmDelete.title")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("duplicateResolution.confirmDelete.description")}
          </p>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" disabled={resolving}>
                {t("common.cancel")}
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleConfirmResolve}
              disabled={resolving}
            >
              {t("duplicateResolution.confirmDelete.continue")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={preview !== null} onOpenChange={onPreviewOpenChange}>
        <DialogContent
          className="max-w-6xl w-[96vw]"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>
              {t("duplicateResolution.previewTitle", {
                side: preview?.side ?? "",
              })}
            </DialogTitle>
          </DialogHeader>
          {preview && (
            <div className="space-y-3">
              <div className="max-h-[72vh] overflow-auto rounded-md border border-border/60 bg-secondary/20 p-2">
                <img
                  src={preview.src}
                  alt={preview.fileName}
                  className="max-w-full max-h-[68vh] mx-auto object-contain"
                />
              </div>
              <p className="text-xs text-muted-foreground break-all">
                {preview.fileName}
                <br />
                {preview.path}
              </p>
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{t("common.close")}</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
