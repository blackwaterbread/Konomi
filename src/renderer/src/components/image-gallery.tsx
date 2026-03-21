import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronsLeft,
  ChevronsRight,
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
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ImageCard, type ImageData } from "./image-card";
import { OnboardingView } from "./onboarding-view";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface ImageGalleryState {
  images: ImageData[];
  viewMode: "grid" | "compact" | "list";
  sortBy: "recent" | "oldest" | "favorites" | "name";
  totalCount: number;
  searchQuery?: string;
  hasFolders?: boolean;
  isInitializing?: boolean;
  isRefreshing?: boolean;
  selectionScopeKey?: string;
}

interface ImageGalleryActions {
  onViewModeChange: (mode: "grid" | "compact" | "list") => void;
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
  onClearSearch?: () => void;
  onAddFolder?: () => void;
  onLoadAllSelectableImages?: () => Promise<ImageData[]>;
}

interface ImageGalleryPagination {
  pageSize?: number;
  page?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
}

interface ImageGalleryProps {
  gallery: ImageGalleryState;
  actions: ImageGalleryActions;
  pagination?: ImageGalleryPagination;
}

export const ImageGallery = memo(function ImageGallery({
  gallery,
  actions,
  pagination,
}: ImageGalleryProps) {
  const {
    images,
    viewMode,
    sortBy,
    totalCount,
    searchQuery,
    hasFolders = true,
    isInitializing = false,
    isRefreshing = false,
    selectionScopeKey,
  } = gallery;
  const {
    onViewModeChange,
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
    onClearSearch,
    onAddFolder,
    onLoadAllSelectableImages,
  } = actions;
  const {
    pageSize = 50,
    page,
    totalPages,
    onPageChange,
  } = pagination ?? {};
  const { t } = useTranslation();
  const [internalPage, setInternalPage] = useState(1);
  const [pageJumpValue, setPageJumpValue] = useState("1");
  const [pageJumpOpen, setPageJumpOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedImageMap, setSelectedImageMap] = useState<
    Map<string, ImageData>
  >(new Map());
  const [selectingAllResults, setSelectingAllResults] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageJumpButtonRef = useRef<HTMLButtonElement | null>(null);
  const pageJumpPopoverRef = useRef<HTMLDivElement | null>(null);
  const pageJumpInputRef = useRef<HTMLInputElement | null>(null);
  const selectAllRequestSeqRef = useRef(0);
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
    setPageJumpValue(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    setPageJumpOpen(false);
  }, [currentPage]);

  useEffect(() => {
    if (!pageJumpOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (pageJumpButtonRef.current?.contains(target)) return;
      if (pageJumpPopoverRef.current?.contains(target)) return;
      setPageJumpOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPageJumpOpen(false);
      pageJumpButtonRef.current?.focus();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [pageJumpOpen]);

  useEffect(() => {
    if (!pageJumpOpen) return;
    const raf = window.requestAnimationFrame(() => {
      pageJumpInputRef.current?.focus();
      pageJumpInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [pageJumpOpen]);

  useEffect(() => {
    if (!selectionMode) {
      selectAllRequestSeqRef.current += 1;
      setSelectedIds(new Set());
      setSelectedImageMap(new Map());
      setSelectingAllResults(false);
    }
  }, [selectionMode]);

  useEffect(() => {
    selectAllRequestSeqRef.current += 1;
    setSelectedIds(new Set());
    setSelectedImageMap(new Map());
    setSelectingAllResults(false);
  }, [selectionScopeKey]);

  useEffect(() => {
    setSelectedImageMap((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const image of images) {
        if (!selectedIds.has(image.id)) continue;
        if (next.get(image.id) === image) continue;
        next.set(image.id, image);
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [images, selectedIds]);

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
  const allFilteredSelected = totalCount > 0 && selectedCount === totalCount;
  const allPageSelected =
    paged.length > 0 && paged.every((img) => selectedIds.has(img.id));

  const handleSelectImage = useCallback(
    (id: string, selected: boolean) => {
      const targetImage = images.find((image) => image.id === id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (selected) next.add(id);
        else next.delete(id);
        return next;
      });
      setSelectedImageMap((prev) => {
        const next = new Map(prev);
        if (selected && targetImage) next.set(id, targetImage);
        else next.delete(id);
        return next;
      });
    },
    [images],
  );

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
    setSelectedImageMap((prev) => {
      const next = new Map(prev);
      if (allPageSelected) {
        paged.forEach((img) => next.delete(img.id));
      } else {
        paged.forEach((img) => next.set(img.id, img));
      }
      return next;
    });
  }, [allPageSelected, paged]);

  const handleSelectAllFiltered = useCallback(() => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
      setSelectedImageMap(new Map());
      return;
    }
    if (!onLoadAllSelectableImages) return;
    const requestId = ++selectAllRequestSeqRef.current;
    setSelectingAllResults(true);
    void onLoadAllSelectableImages()
      .then((loadedImages) => {
        if (requestId !== selectAllRequestSeqRef.current) return;
        setSelectedIds(new Set(loadedImages.map((img) => img.id)));
        setSelectedImageMap(new Map(loadedImages.map((img) => [img.id, img])));
      })
      .catch(() => {
        // Errors are handled by the caller.
      })
      .finally(() => {
        if (requestId !== selectAllRequestSeqRef.current) return;
        setSelectingAllResults(false);
      });
  }, [allFilteredSelected, onLoadAllSelectableImages]);

  const handleBulkCategory = useCallback(() => {
    if (selectedIds.size === 0) return;
    const selected = Array.from(selectedIds)
      .map((id) => selectedImageMap.get(id))
      .filter((image): image is ImageData => image !== undefined);
    if (selected.length === 0) return;
    onBulkChangeCategory(selected);
  }, [onBulkChangeCategory, selectedIds, selectedImageMap]);

  const handleJumpToPage = useCallback(() => {
    const parsed = Number.parseInt(pageJumpValue, 10);
    if (!Number.isFinite(parsed)) {
      setPageJumpValue(String(currentPage));
      return;
    }
    updatePage(parsed);
    setPageJumpOpen(false);
  }, [currentPage, pageJumpValue, updatePage]);

  return (
    <div
      className="relative flex-1 flex flex-col"
      aria-busy={isRefreshing || isInitializing}
    >
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
                disabled={
                  totalCount === 0 ||
                  selectingAllResults ||
                  !onLoadAllSelectableImages
                }
              >
                {selectingAllResults && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {allFilteredSelected
                  ? t("gallery.deselectAllResults")
                  : t("gallery.selectAllResults", {
                      count: totalCount,
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
        <div className="flex flex-wrap items-center justify-center gap-3 border-t border-border p-4">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title={t("gallery.firstPage")}
            aria-label={t("gallery.firstPage")}
            disabled={currentPage === 1}
            onClick={() => updatePage(1)}
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title={t("gallery.previousPage")}
            aria-label={t("gallery.previousPage")}
            disabled={currentPage === 1}
            onClick={() => updatePage(currentPage - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="relative">
            <button
              ref={pageJumpButtonRef}
              type="button"
              className="rounded-lg border border-border bg-secondary/35 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary/55 cursor-pointer"
              aria-label={t("gallery.jumpToPage")}
              aria-haspopup="dialog"
              aria-expanded={pageJumpOpen}
              onClick={() => setPageJumpOpen((open) => !open)}
            >
              <span className="text-foreground font-medium">{currentPage}</span> /{" "}
              {computedTotalPages}
            </button>
            {pageJumpOpen && (
              <div
                ref={pageJumpPopoverRef}
                className="absolute bottom-full left-1/2 z-10 mb-3 w-44 -translate-x-1/2"
              >
                <div className="relative rounded-xl border border-border/80 bg-popover/95 p-3 shadow-xl backdrop-blur-sm">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                    {t("gallery.jumpToPage")}
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      ref={pageJumpInputRef}
                      type="number"
                      min={1}
                      max={computedTotalPages}
                      inputMode="numeric"
                      value={pageJumpValue}
                      onChange={(e) => setPageJumpValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleJumpToPage();
                        }
                      }}
                      aria-label={t("gallery.jumpToPage")}
                      className="h-8 w-full border-border bg-background px-2 text-center text-sm"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0 px-3"
                      onClick={handleJumpToPage}
                    >
                      {t("gallery.goToPage")}
                    </Button>
                  </div>
                  <div className="absolute left-1/2 top-full h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-border/80 bg-popover/95" />
                </div>
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title={t("gallery.nextPage")}
            aria-label={t("gallery.nextPage")}
            disabled={currentPage === computedTotalPages}
            onClick={() => updatePage(currentPage + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title={t("gallery.lastPage")}
            aria-label={t("gallery.lastPage")}
            disabled={currentPage === computedTotalPages}
            onClick={() => updatePage(computedTotalPages)}
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {isRefreshing && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/36 backdrop-blur-sm">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border/70 bg-background/88 text-primary shadow-xl">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        </div>
      )}
    </div>
  );
});
