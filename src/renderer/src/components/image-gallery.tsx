import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Grid3X3,
  LayoutGrid,
  List,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  SquareCheckBig,
  Tags,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ImageCard, type ImageData } from "./image-card";
import { OnboardingView } from "./onboarding-view";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface ImageGalleryProps {
  images: ImageData[];
  viewMode: "grid" | "compact" | "list";
  onViewModeChange: (mode: "grid" | "compact" | "list") => void;
  sortBy: "recent" | "oldest" | "favorites" | "name";
  onSortChange: (sort: "recent" | "oldest" | "favorites" | "name") => void;
  onToggleFavorite: (id: string) => void;
  onCopyPrompt: (prompt: string) => void;
  onImageClick: (image: ImageData) => void;
  onReveal: (path: string) => void;
  onDelete: (id: string) => void;
  onChangeCategory: (image: ImageData) => void;
  onBulkChangeCategory: (images: ImageData[]) => void;
  onSendToGenerator?: (image: ImageData) => void;
  onSendToSource?: (image: ImageData) => void;
  onAddTagToSearch?: (tag: string) => void;
  onAddTagToGenerator?: (tag: string) => void;
  totalCount: number;
  pageSize?: number;
  page?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
  searchQuery?: string;
  onClearSearch?: () => void;
  hasFolders?: boolean;
  onAddFolder?: () => void;
  isInitializing?: boolean;
}

export const ImageGallery = memo(function ImageGallery({
  images,
  viewMode,
  onViewModeChange,
  sortBy,
  onSortChange,
  onToggleFavorite,
  onCopyPrompt,
  onImageClick,
  onReveal,
  onDelete,
  onChangeCategory,
  onBulkChangeCategory,
  onSendToGenerator,
  onSendToSource,
  onAddTagToSearch,
  onAddTagToGenerator,
  totalCount,
  pageSize = 50,
  page,
  totalPages,
  onPageChange,
  searchQuery,
  onClearSearch,
  hasFolders = true,
  onAddFolder,
  isInitializing = false,
}: ImageGalleryProps) {
  const { t } = useTranslation();
  const [internalPage, setInternalPage] = useState(1);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const controlledPagination =
    typeof page === "number" &&
    typeof totalPages === "number" &&
    typeof onPageChange === "function";
  const currentPage = controlledPagination ? page : internalPage;
  const computedTotalPages = controlledPagination
    ? Math.max(1, totalPages)
    : Math.max(1, Math.ceil(images.length / pageSize));

  useEffect(() => {
    if (!controlledPagination) setInternalPage(1);
  }, [images, controlledPagination]);

  useEffect(() => {
    const viewport = scrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]",
    );
    if (viewport) viewport.scrollTop = 0;
  }, [currentPage]);

  useEffect(() => {
    const imageIdSet = new Set(images.map((img) => img.id));
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (imageIdSet.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [images]);

  useEffect(() => {
    if (!selectionMode) {
      setSelectedIds(new Set());
    }
  }, [selectionMode]);

  useEffect(() => {
    if (currentPage <= computedTotalPages) return;
    if (controlledPagination) onPageChange?.(computedTotalPages);
    else setInternalPage(computedTotalPages);
  }, [computedTotalPages, controlledPagination, currentPage, onPageChange]);

  const paged = useMemo(
    () =>
      controlledPagination
        ? images
        : images.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [images, controlledPagination, currentPage, pageSize],
  );

  const updatePage = useCallback(
    (nextPage: number) => {
      const clamped = Math.max(1, Math.min(computedTotalPages, nextPage));
      if (controlledPagination) onPageChange?.(clamped);
      else setInternalPage(clamped);
    },
    [computedTotalPages, controlledPagination, onPageChange],
  );

  const selectedCount = selectedIds.size;
  const allFilteredSelected =
    images.length > 0 && selectedCount === images.length;
  const allPageSelected =
    paged.length > 0 && paged.every((img) => selectedIds.has(img.id));

  const handleSelectImage = useCallback((id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleSelectCurrentPage = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        paged.forEach((img) => next.delete(img.id));
      } else {
        paged.forEach((img) => next.add(img.id));
      }
      return next;
    });
  }, [allPageSelected, paged]);

  const handleSelectAllFiltered = useCallback(() => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(images.map((img) => img.id)));
  }, [allFilteredSelected, images]);

  const handleBulkCategory = useCallback(() => {
    if (selectedIds.size === 0) return;
    const selected = images.filter((img) => selectedIds.has(img.id));
    if (selected.length === 0) return;
    onBulkChangeCategory(selected);
  }, [images, onBulkChangeCategory, selectedIds]);

  return (
    <div className="relative flex-1 flex flex-col">
      <div
        className="flex flex-col gap-3 p-4 border-b border-border bg-background"
        data-tour="gallery-toolbar"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground select-none">
              {t("gallery.totalImages", { count: totalCount })}
            </span>
            {searchQuery && (
              <button
                onClick={onClearSearch}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
              >
                {t("gallery.resetSearch")}
              </button>
            )}
            {selectionMode && (
              <span className="text-sm text-muted-foreground select-none">
                {t("gallery.selectedCount", { count: selectedCount })}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Select value={sortBy} onValueChange={onSortChange}>
              <SelectTrigger className="w-36 bg-secondary border-border">
                <SlidersHorizontal className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                <SelectItem value="recent">
                  {t("gallery.sort.recent")}
                </SelectItem>
                <SelectItem value="oldest">
                  {t("gallery.sort.oldest")}
                </SelectItem>
                <SelectItem value="name">{t("gallery.sort.name")}</SelectItem>
                <SelectItem value="favorites">
                  {t("gallery.sort.favorites")}
                </SelectItem>
              </SelectContent>
            </Select>

            <div className="flex items-center bg-secondary rounded-lg p-1">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-8 w-8",
                  viewMode === "grid"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => onViewModeChange("grid")}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-8 w-8",
                  viewMode === "compact"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => onViewModeChange("compact")}
              >
                <Grid3X3 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-8 w-8",
                  viewMode === "list"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => onViewModeChange("list")}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={selectionMode ? "secondary" : "outline"}
            size="sm"
            onClick={() => setSelectionMode((prev) => !prev)}
          >
            <SquareCheckBig className="h-4 w-4" />
            {selectionMode
              ? t("gallery.exitSelectionMode")
              : t("gallery.selectionMode")}
          </Button>

          {selectionMode && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectCurrentPage}
              >
                {allPageSelected
                  ? t("gallery.deselectCurrentPage")
                  : t("gallery.selectCurrentPage")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectAllFiltered}
                disabled={images.length === 0}
              >
                {allFilteredSelected
                  ? t("gallery.deselectAllResults")
                  : t("gallery.selectAllResults", {
                      count: images.length,
                    })}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedIds(new Set())}
                disabled={selectedCount === 0}
              >
                {t("gallery.clearSelection")}
              </Button>
              <Button
                size="sm"
                onClick={handleBulkCategory}
                disabled={selectedCount === 0}
              >
                <Tags className="h-4 w-4" />
                {t("gallery.changeCategoryForSelection")}
              </Button>
            </>
          )}
        </div>
      </div>

      {paged.length > 0 ? (
        <ScrollArea ref={scrollRef} className="flex-1 min-h-0">
          <div className="p-4">
            <div
              className={cn(
                "grid gap-4",
                viewMode === "grid" &&
                  "grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
                viewMode === "compact" &&
                  "grid-cols-3 md:grid-cols-4 lg:grid-cols-6",
                viewMode === "list" && "grid-cols-1 w-full",
              )}
            >
              {paged.map((image) => (
                <ImageCard
                  key={image.id}
                  image={image}
                  viewMode={viewMode}
                  onToggleFavorite={onToggleFavorite}
                  onCopyPrompt={onCopyPrompt}
                  onClick={onImageClick}
                  onReveal={onReveal}
                  onDelete={onDelete}
                  onChangeCategory={onChangeCategory}
                  onSendToGenerator={onSendToGenerator}
                  onSendToSource={onSendToSource}
                  onAddTagToSearch={onAddTagToSearch}
                  onAddTagToGenerator={onAddTagToGenerator}
                  selectionMode={selectionMode}
                  selected={selectedIds.has(image.id)}
                  onSelectChange={handleSelectImage}
                />
              ))}
            </div>
          </div>
        </ScrollArea>
      ) : isInitializing ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-4 select-none">
          <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mb-4">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2">
            {t("gallery.initializingTitle")}
          </h3>
          <p className="text-sm text-muted-foreground max-w-md">
            {t("gallery.initializingDescription")}
          </p>
        </div>
      ) : !hasFolders && onAddFolder ? (
        <OnboardingView onAddFolder={onAddFolder} />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-4 select-none">
          <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mb-4">
            <Grid3X3 className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2">
            {t("gallery.emptyTitle")}
          </h3>
          <p className="text-sm text-muted-foreground max-w-md">
            {t("gallery.emptyDescription")}
          </p>
        </div>
      )}

      {computedTotalPages > 1 && (
        <div className="flex items-center justify-center gap-3 p-4 border-t border-border">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={currentPage === 1}
            onClick={() => updatePage(currentPage - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">{currentPage}</span> /{" "}
            {computedTotalPages}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={currentPage === computedTotalPages}
            onClick={() => updatePage(currentPage + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
});
