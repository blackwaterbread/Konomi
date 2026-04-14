import { AlertTriangle, ImageIcon, Images, Loader2, Search, Tag, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ImageData } from "@/components/image-card";
import { rowToImageData } from "@/lib/image-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Category } from "@preload/index.d";

interface CategoryDialogProps {
  image: ImageData | null;
  bulkImageIds?: number[] | null;
  categories: Category[];
  onClose: () => void;
}

function getImageFileName(path: string): string {
  const segments = path.split(/[/\\]/);
  return segments[segments.length - 1] || path;
}

export function CategoryDialog({
  image,
  bulkImageIds,
  categories,
  onClose,
}: CategoryDialogProps) {
  const { t } = useTranslation();

  const targetImageIds = useMemo(() => {
    if (bulkImageIds && bulkImageIds.length > 0) return bulkImageIds;
    return image ? [parseInt(image.id, 10)] : [];
  }, [image, bulkImageIds]);

  const isBulk = targetImageIds.length > 1;

  // For bulk mode, load preview data for the first few images
  const [previewImages, setPreviewImages] = useState<ImageData[]>([]);
  useEffect(() => {
    if (!isBulk || targetImageIds.length === 0) {
      setPreviewImages([]);
      return;
    }
    const previewIds = targetImageIds.slice(0, 4);
    window.image
      .listByIds(previewIds)
      .then((rows) => setPreviewImages(rows.map(rowToImageData)))
      .catch(() => setPreviewImages([]));
  }, [isBulk, targetImageIds]);

  const singleImage = !isBulk ? image : null;
  const hiddenPreviewCount = Math.max(
    0,
    targetImageIds.length - Math.min(4, targetImageIds.length),
  );
  const userCategories = useMemo(
    () => categories.filter((category) => !category.isBuiltin),
    [categories],
  );
  const [searchQuery, setSearchQuery] = useState("");
  const filteredUserCategories = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return userCategories;
    return userCategories.filter((c) => c.name.toLowerCase().includes(q));
  }, [userCategories, searchQuery]);
  const dialogDescription = isBulk
    ? t("categoryDialog.bulkDescription", { count: targetImageIds.length })
    : t("categoryDialog.singleDescription");

  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const checkedCount = checkedIds.size;

  useEffect(() => {
    if (targetImageIds.length === 0) {
      setCheckedIds(new Set());
      setLoading(false);
      setLoadError(null);
      setSearchQuery("");
      return;
    }

    setLoading(true);
    setLoadError(null);

    const loadPromise =
      targetImageIds.length === 1
        ? window.category.forImage(targetImageIds[0])
        : window.category.commonForImages(targetImageIds);

    loadPromise
      .then((ids) => setCheckedIds(new Set(ids)))
      .catch((e: unknown) =>
        setLoadError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => setLoading(false));
  }, [targetImageIds]);

  const handleToggle = (categoryId: number, checked: boolean) => {
    if (targetImageIds.length === 0) return;

    const applyPromise =
      targetImageIds.length === 1
        ? checked
          ? window.category.addImage(targetImageIds[0], categoryId)
          : window.category.removeImage(targetImageIds[0], categoryId)
        : checked
          ? window.category.addImages(targetImageIds, categoryId)
          : window.category.removeImages(targetImageIds, categoryId);

    if (checked) {
      setCheckedIds((prev) => new Set([...prev, categoryId]));
      applyPromise.catch((e: unknown) => {
        toast.error(
          t("categoryDialog.addFailed", {
            message: e instanceof Error ? e.message : String(e),
          }),
        );
        setCheckedIds((prev) => {
          const next = new Set(prev);
          next.delete(categoryId);
          return next;
        });
      });
      return;
    }

    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.delete(categoryId);
      return next;
    });

    applyPromise.catch((e: unknown) => {
      toast.error(
        t("categoryDialog.removeFailed", {
          message: e instanceof Error ? e.message : String(e),
        }),
      );
      setCheckedIds((prev) => new Set([...prev, categoryId]));
    });
  };

  return (
    <Dialog
      open={targetImageIds.length > 0}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="w-[min(95vw,56rem)] max-w-3xl overflow-hidden p-0">
        <div className="flex flex-col">
          <section className="border-b border-border/60 px-6 py-4 sm:px-7">
            <DialogHeader className="mb-0 space-y-1.5">
              <DialogTitle className="text-lg tracking-tight">
                {isBulk
                  ? t("categoryDialog.title.bulk")
                  : t("categoryDialog.title.single")}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                {dialogDescription}
              </DialogDescription>
            </DialogHeader>

            <div className="mt-3 flex items-center gap-2">
              {isBulk ? (
                <>
                  {previewImages.map((targetImage, index) => {
                    const fileName = getImageFileName(targetImage.path);
                    const showOverflowCount =
                      hiddenPreviewCount > 0 &&
                      index === previewImages.length - 1;

                    return (
                      <div
                        key={targetImage.id}
                        className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border/60 bg-secondary/30"
                      >
                        {targetImage.src ? (
                          <img
                            src={targetImage.src}
                            alt={fileName}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                            <Images className="h-4 w-4" />
                          </div>
                        )}
                        {showOverflowCount && (
                          <div className="absolute inset-0 flex items-center justify-center bg-background/72 backdrop-blur-[2px]">
                            <span className="text-xs font-semibold text-foreground">
                              +{hiddenPreviewCount}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <span className="ml-1 text-xs text-muted-foreground">
                    {t("categoryDialog.imageCount", {
                      count: targetImageIds.length,
                    })}
                  </span>
                </>
              ) : singleImage ? (
                <>
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border/60 bg-secondary/30">
                    {singleImage.src ? (
                      <img
                        src={singleImage.src}
                        alt={getImageFileName(singleImage.path)}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <ImageIcon className="h-4 w-4" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {getImageFileName(singleImage.path)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {singleImage.prompt?.trim() ||
                        `${singleImage.width} x ${singleImage.height}`}
                    </p>
                  </div>
                </>
              ) : null}
            </div>
          </section>

          <section className="space-y-5 px-6 py-5 sm:px-7">
            {loading ? (
              <div className="flex min-h-64 items-center justify-center rounded-2xl border border-border/60 bg-secondary/20 px-6 py-10">
                <div className="flex flex-col items-center gap-3 text-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {t("categoryDialog.loading")}
                  </p>
                </div>
              </div>
            ) : loadError ? (
              <div className="rounded-2xl border border-destructive/25 bg-destructive/5 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                  <p className="pt-1 text-sm leading-relaxed text-destructive">
                    {loadError}
                  </p>
                </div>
              </div>
            ) : userCategories.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-secondary/20 px-5 py-10 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-background text-muted-foreground shadow-sm">
                  <Tag className="h-5 w-5" />
                </div>
                <p className="mt-4 text-sm font-medium text-foreground">
                  {t("categoryDialog.empty")}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("categoryDialog.emptyDescription")}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {t("categoryDialog.categoriesLabel")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {isBulk
                        ? t("categoryDialog.commonHint")
                        : t("categoryDialog.liveApply")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="rounded-full px-3 py-1">
                      {t("categoryDialog.categoryCount", {
                        count: userCategories.length,
                      })}
                    </Badge>
                    <Badge
                      variant="secondary"
                      className="rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-primary"
                    >
                      {t("categoryDialog.selectedCount", {
                        count: checkedCount,
                      })}
                    </Badge>
                  </div>
                </div>

                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t("categoryDialog.searchPlaceholder")}
                    className="pl-9 pr-8"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                      onClick={() => setSearchQuery("")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <ScrollArea className="max-h-[24rem]">
                  <div className="space-y-2 pr-3">
                    {filteredUserCategories.length === 0 && searchQuery ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        {t("categoryDialog.noResults")}
                      </p>
                    ) : null}
                    {filteredUserCategories.map((category) => {
                      const checked = checkedIds.has(category.id);

                      return (
                        <label
                          key={category.id}
                          className={cn(
                            "group flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition-colors",
                            checked
                              ? "border-primary/35 bg-primary/10 shadow-sm"
                              : "border-border/60 bg-card/60 hover:border-primary/25 hover:bg-secondary/35",
                          )}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(nextChecked) =>
                              handleToggle(category.id, !!nextChecked)
                            }
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate text-sm font-medium text-foreground">
                                {category.name}
                              </span>
                              {checked && (
                                <Badge className="rounded-full border border-primary/15 bg-primary/90 px-2.5 py-0.5 text-[11px] text-primary-foreground">
                                  {t("categoryDialog.applied")}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            )}

            <DialogFooter className="mt-0 border-t border-border/60 pt-4">
              <p className="mr-auto text-xs text-muted-foreground">
                {t("categoryDialog.liveApply")}
              </p>
              <Button variant="ghost" onClick={onClose}>
                {t("common.close")}
              </Button>
            </DialogFooter>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
