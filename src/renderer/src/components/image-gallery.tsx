import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  ChevronsLeft,
  ChevronsRight,
  Grid3X3,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  SquareCheckBig,
  Tags,
  Trash2,
  Loader2,
  RotateCw,
  Minus,
  Plus,
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

type ViewMode = "grid" | "list";
type SortBy = "recent" | "oldest" | "favorites" | "name";
export type GalleryDensity = "normal" | "compact" | "dense" | "minimal" | "micro";

const GALLERY_PADDING_PX = 16;
const GRID_VIRTUAL_OVERSCAN_ROWS = 2;
const LIST_VIRTUAL_OVERSCAN_ROWS = 4;
const MIN_VIRTUALIZED_ROWS = 3;

function getGalleryDensity(columnCount: number): GalleryDensity {
  if (columnCount <= 4) return "normal";
  if (columnCount <= 6) return "compact";
  if (columnCount <= 10) return "dense";
  if (columnCount <= 16) return "minimal";
  return "micro";
}

function getGalleryGapPx(density: GalleryDensity): number {
  switch (density) {
    case "normal":
    case "compact":
      return 16;
    case "dense":
      return 8;
    case "minimal":
      return 4;
    case "micro":
      return 2;
  }
}

function getScrollAreaViewport(
  root: HTMLElement | null,
): HTMLDivElement | null {
  if (!root) return null;
  return root.querySelector<HTMLDivElement>(
    '[data-slot="scroll-area-viewport"], [data-radix-scroll-area-viewport]',
  );
}

function getGalleryColumnCount(
  viewportWidth: number,
  galleryColumns?: "auto" | number,
): number {
  if (typeof galleryColumns === "number") return galleryColumns;
  if (viewportWidth >= 1024) return 4;
  if (viewportWidth >= 768) return 3;
  return 2;
}

function estimateGalleryRowHeight(
  viewportWidth: number,
  columnCount: number,
  density: GalleryDensity,
): number {
  if (columnCount <= 1) return 80;
  const gapPx = getGalleryGapPx(density);
  const contentWidth = Math.max(
    0,
    viewportWidth - GALLERY_PADDING_PX * 2 - gapPx * (columnCount - 1),
  );
  const cardWidth = columnCount > 0 ? contentWidth / columnCount : contentWidth;
  const useSquare = density === "minimal" || density === "micro";
  const imageHeight = useSquare ? cardWidth : cardWidth * (4 / 3);
  const footerHeight =
    density === "normal" ? 84 : density === "compact" ? 48 : 0;
  return Math.max(1, imageHeight + footerHeight + gapPx);
}

function getVisibleGalleryRowRange({
  scrollTop,
  viewportHeight,
  rowHeight,
  rowCount,
  overscanRows,
  shouldVirtualize,
}: {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  rowCount: number;
  overscanRows: number;
  shouldVirtualize: boolean;
}) {
  if (!shouldVirtualize) {
    return {
      startRow: 0,
      endRow: rowCount,
    };
  }

  return {
    startRow: Math.max(
      0,
      Math.floor(scrollTop / Math.max(1, rowHeight)) - overscanRows,
    ),
    endRow: Math.min(
      rowCount,
      Math.ceil((scrollTop + viewportHeight) / Math.max(1, rowHeight)) +
        overscanRows,
    ),
  };
}

interface ImageGalleryState {
  images: ImageData[];
  sortBy: SortBy;
  totalCount: number;
  searchQuery?: string;
  hasFolders?: boolean;
  isInitializing?: boolean;
  isRefreshing?: boolean;
  selectionScopeKey?: string;
}

interface ImageGalleryActions {
  onSortChange: (sort: SortBy) => void;
  onToggleFavorite: (id: string) => void;
  onCopyPrompt: (prompt: string) => void;
  onImageClick: (image: ImageData) => void;
  onReveal: (path: string) => void;
  onDelete: (id: string) => void;
  onChangeCategory: (image: ImageData) => void;
  onBulkChangeCategory: (ids: number[]) => void;
  onBulkDelete: (ids: number[]) => void;
  onRescanMetadata?: (path: string) => void;
  onBulkRescanMetadata?: (ids: number[]) => void;
  onSendToGenerator?: (image: ImageData) => void;
  onSendToSource?: (image: ImageData) => void;
  onAddTagToSearch?: (tag: string) => void;
  onAddTagToGenerator?: (tag: string) => void;
  onClearSearch?: () => void;
  onAddFolder?: () => void;
  onLoadAllSelectableIds?: () => Promise<number[]>;

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
  scanning?: boolean;
  syncing?: boolean;
  enableVirtualization?: boolean;
  focusIndex?: number | null;
  onColumnCountChange?: (count: number) => void;
  galleryColumns?: "auto" | number;
  onGalleryColumnsChange?: (value: "auto" | number) => void;
}

interface GalleryToolbarProps {
  totalCount: number;
  searchQuery?: string;
  selectionMode: boolean;
  selectedCount: number;
  sortBy: SortBy;
  allPageSelected: boolean;
  allFilteredSelected: boolean;
  selectingAllResults: boolean;
  canSelectAllResults: boolean;
  onClearSearch?: () => void;
  onSortChange: (sort: SortBy) => void;
  onToggleSelectionMode: () => void;
  onSelectCurrentPage: () => void;
  onSelectAllFiltered: () => void;
  onClearSelection: () => void;
  onBulkCategory: () => void;
  onBulkRescanMetadata: () => void;
  onBulkDelete: () => void;
  galleryColumns?: "auto" | number;
  onGalleryColumnsChange?: (value: "auto" | number) => void;
}

const GalleryToolbar = memo(function GalleryToolbar({
  totalCount,
  searchQuery,
  selectionMode,
  selectedCount,
  sortBy,
  allPageSelected,
  allFilteredSelected,
  selectingAllResults,
  canSelectAllResults,
  onClearSearch,
  onSortChange,
  onToggleSelectionMode,
  onSelectCurrentPage,
  onSelectAllFiltered,
  onClearSelection,
  onBulkCategory,
  onBulkRescanMetadata,
  onBulkDelete,
  galleryColumns,
  onGalleryColumnsChange,
}: GalleryToolbarProps) {
  const { t } = useTranslation();
  const isCustomColumns = typeof galleryColumns === "number";

  return (
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
              <SelectItem value="recent">{t("gallery.sort.recent")}</SelectItem>
              <SelectItem value="oldest">{t("gallery.sort.oldest")}</SelectItem>
              <SelectItem value="name">{t("gallery.sort.name")}</SelectItem>
              <SelectItem value="favorites">
                {t("gallery.sort.favorites")}
              </SelectItem>
            </SelectContent>
          </Select>

          {onGalleryColumnsChange && (
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                disabled={isCustomColumns && galleryColumns <= 1}
                onClick={() => {
                  const current = isCustomColumns ? galleryColumns : 4;
                  const next = Math.max(1, current - 1);
                  onGalleryColumnsChange(next);
                }}
                title={t("gallery.columnSize.larger")}
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <span
                className="text-xs text-muted-foreground select-none tabular-nums w-8 text-center cursor-pointer hover:text-foreground transition-colors"
                title={t("gallery.columnSize.reset")}
                onClick={() => onGalleryColumnsChange("auto")}
              >
                {isCustomColumns
                  ? galleryColumns === 1
                    ? t("gallery.columnSize.list")
                    : galleryColumns
                  : t("gallery.columnSize.auto")}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                disabled={isCustomColumns && galleryColumns >= 25}
                onClick={() => {
                  const current = isCustomColumns ? galleryColumns : 4;
                  const next = Math.min(25, current + 1);
                  onGalleryColumnsChange(next);
                }}
                title={t("gallery.columnSize.smaller")}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={selectionMode ? "secondary" : "outline"}
          size="sm"
          onClick={onToggleSelectionMode}
        >
          <SquareCheckBig className="h-4 w-4" />
          {selectionMode
            ? t("gallery.exitSelectionMode")
            : t("gallery.selectionMode")}
        </Button>

        {selectionMode && (
          <>
            <Button variant="outline" size="sm" onClick={onSelectCurrentPage}>
              {allPageSelected
                ? t("gallery.deselectCurrentPage")
                : t("gallery.selectCurrentPage")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onSelectAllFiltered}
              disabled={!canSelectAllResults}
            >
              {selectingAllResults && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {allFilteredSelected
                ? t("gallery.deselectAllResults")
                : t("gallery.selectAllResults", { count: totalCount })}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearSelection}
              disabled={selectedCount === 0}
            >
              {t("gallery.clearSelection")}
            </Button>
            <Button
              size="sm"
              onClick={onBulkCategory}
              disabled={selectedCount === 0}
            >
              <Tags className="h-4 w-4" />
              {t("gallery.changeCategoryForSelection")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onBulkRescanMetadata}
              disabled={selectedCount === 0}
            >
              <RotateCw className="h-4 w-4" />
              {t("gallery.rescanSelection")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={onBulkDelete}
              disabled={selectedCount === 0}
            >
              <Trash2 className="h-4 w-4" />
              {t("gallery.deleteSelection")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
});

const GalleryFocusWrapper = memo(function GalleryFocusWrapper({
  isFocused,
  isMeasure,
  children,
}: {
  isFocused: boolean;
  isMeasure: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isFocused && ref.current) {
      ref.current.scrollIntoView({ block: "nearest" });
    }
  }, [isFocused]);

  return (
    <div
      ref={ref}
      data-gallery-card-measure={isMeasure ? "true" : undefined}
      className={cn(
        "rounded-lg transition-shadow",
        isFocused && "ring-2 ring-primary ring-offset-1 ring-offset-background",
      )}
    >
      {children}
    </div>
  );
});

interface GalleryResultsProps {
  paged: ImageData[];
  scrollRef: RefObject<HTMLDivElement | null>;
  onToggleFavorite: (id: string) => void;
  onCopyPrompt: (prompt: string) => void;
  onImageClick: (image: ImageData) => void;
  onReveal: (path: string) => void;
  onDelete: (id: string) => void;
  onChangeCategory: (image: ImageData) => void;
  onSendToGenerator?: (image: ImageData) => void;
  onSendToSource?: (image: ImageData) => void;
  onAddTagToSearch?: (tag: string) => void;
  onAddTagToGenerator?: (tag: string) => void;
  selectionMode: boolean;
  selectedIds: Set<string>;
  selectedCount: number;
  onSelectChange: (id: string, selected: boolean) => void;
  onBulkDelete: () => void;
  onBulkCategory: () => void;
  onRescanMetadata?: (path: string) => void;
  onBulkRescanMetadata: () => void;

  isInitializing: boolean;
  isRefreshing: boolean;
  scanning: boolean;
  hasFolders: boolean;
  onAddFolder?: () => void;
  enableVirtualization: boolean;
  focusIndex?: number | null;
  onColumnCountChange?: (count: number) => void;
  galleryColumns?: "auto" | number;
}

const GalleryResults = memo(function GalleryResults({
  paged,
  scrollRef,
  onToggleFavorite,
  onCopyPrompt,
  onImageClick,
  onReveal,
  onDelete,
  onChangeCategory,
  onSendToGenerator,
  onSendToSource,
  onAddTagToSearch,
  onAddTagToGenerator,
  selectionMode,
  selectedIds,
  selectedCount,
  onSelectChange,
  onBulkDelete,
  onBulkCategory,
  onRescanMetadata,
  onBulkRescanMetadata,
  isInitializing,
  isRefreshing,
  scanning,
  hasFolders,
  onAddFolder,
  enableVirtualization,
  focusIndex,
  onColumnCountChange,
  galleryColumns,
}: GalleryResultsProps) {
  const { t } = useTranslation();
  const [viewportSize, setViewportSize] = useState({
    width: 0,
    height: 0,
  });
  const [visibleRowRange, setVisibleRowRange] = useState({
    startRow: 0,
    endRow: 0,
  });
  const [measuredRowHeight, setMeasuredRowHeight] = useState<number | null>(
    null,
  );

  const columnCount = useMemo(
    () => getGalleryColumnCount(viewportSize.width, galleryColumns),
    [viewportSize.width, galleryColumns],
  );
  const viewMode: ViewMode = columnCount <= 1 ? "list" : "grid";
  const density = useMemo(() => getGalleryDensity(columnCount), [columnCount]);
  const gapPx = getGalleryGapPx(density);

  useEffect(() => {
    if (columnCount > 0) onColumnCountChange?.(columnCount);
  }, [columnCount, onColumnCountChange]);

  const estimatedRowHeight = useMemo(
    () => estimateGalleryRowHeight(viewportSize.width, columnCount, density),
    [columnCount, density, viewportSize.width],
  );
  const rowHeight = measuredRowHeight ?? estimatedRowHeight;
  const rowCount = Math.ceil(paged.length / columnCount);
  const overscanRows =
    viewMode === "list"
      ? LIST_VIRTUAL_OVERSCAN_ROWS
      : GRID_VIRTUAL_OVERSCAN_ROWS;
  // Virtualization is opt-in (Debug Panel > Actions) because at typical page sizes
  // the mount/unmount cost during scroll outweighs the DOM-count savings.
  const shouldVirtualize =
    enableVirtualization &&
    viewportSize.height > 0 &&
    paged.length > columnCount * MIN_VIRTUALIZED_ROWS;
  const visibleStartRow = visibleRowRange.startRow;
  const visibleEndRow = visibleRowRange.endRow || rowCount;
  const visibleStartIndex = visibleStartRow * columnCount;
  const visibleEndIndex = Math.min(paged.length, visibleEndRow * columnCount);
  const visibleImages = shouldVirtualize
    ? paged.slice(visibleStartIndex, visibleEndIndex)
    : paged;
  const topSpacerHeight = shouldVirtualize ? visibleStartRow * rowHeight : 0;
  const bottomSpacerHeight = shouldVirtualize
    ? Math.max(0, (rowCount - visibleEndRow) * rowHeight)
    : 0;

  const updateVisibleRows = useCallback(
    (scrollTop: number, viewportHeight: number) => {
      const next = getVisibleGalleryRowRange({
        scrollTop,
        viewportHeight,
        rowHeight,
        rowCount,
        overscanRows,
        shouldVirtualize,
      });
      setVisibleRowRange((prev) =>
        prev.startRow === next.startRow && prev.endRow === next.endRow
          ? prev
          : next,
      );
    },
    [overscanRows, rowCount, rowHeight, shouldVirtualize],
  );

  useEffect(() => {
    const viewport = getScrollAreaViewport(scrollRef.current);
    if (!viewport) return;

    let rafId: number | null = null;
    const updateViewportState = () => {
      rafId = null;
      const nextSize = {
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      };
      setViewportSize((prev) =>
        prev.width === nextSize.width && prev.height === nextSize.height
          ? prev
          : nextSize,
      );
      updateVisibleRows(viewport.scrollTop, nextSize.height);
    };

    const scheduleUpdate = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(updateViewportState);
    };

    updateViewportState();
    viewport.addEventListener("scroll", scheduleUpdate, {
      passive: true,
    });
    window.addEventListener("resize", scheduleUpdate);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        scheduleUpdate();
      });
      resizeObserver.observe(viewport);
    }

    return () => {
      viewport.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      resizeObserver?.disconnect();
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [scrollRef, updateVisibleRows]);

  useEffect(() => {
    setMeasuredRowHeight(null);
  }, [columnCount, viewMode]);

  useEffect(() => {
    if (!shouldVirtualize) return;
    const root = scrollRef.current;
    if (!root) return;

    const raf = window.requestAnimationFrame(() => {
      const measuredCard = root.querySelector<HTMLElement>(
        '[data-gallery-card-measure="true"]',
      );
      if (!measuredCard) return;
      const nextRowHeight =
        measuredCard.getBoundingClientRect().height + gapPx;
      setMeasuredRowHeight((prev) =>
        prev !== null && Math.abs(prev - nextRowHeight) < 1
          ? prev
          : nextRowHeight,
      );
    });

    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [gapPx, scrollRef, shouldVirtualize, viewMode, viewportSize.width]);

  if (paged.length > 0) {
    return (
      <ScrollArea ref={scrollRef} className="flex-1 min-h-0">
        <div style={{ padding: density === "micro" ? 8 : GALLERY_PADDING_PX }}>
          {topSpacerHeight > 0 && (
            <div style={{ height: topSpacerHeight }} aria-hidden="true" />
          )}
          <div
            className={cn(
              "grid",
              viewMode === "list" && "grid-cols-1 w-full",
            )}
            style={
              viewMode === "grid"
                ? {
                    gap: gapPx,
                    gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                  }
                : { gap: gapPx }
            }
          >
            {visibleImages.map((image, index) => {
              const pagedIndex = visibleStartIndex + index;
              const isFocused = focusIndex === pagedIndex;
              const card = (
                <ImageCard
                  key={image.id}
                  image={image}
                  viewMode={viewMode}
                  density={density}
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
                  onSelectChange={onSelectChange}
                  selectedCount={selectedCount}
                  onBulkDelete={onBulkDelete}
                  onBulkCategory={onBulkCategory}
                  onRescanMetadata={onRescanMetadata}
                  onBulkRescanMetadata={onBulkRescanMetadata}
                />
              );

              return (
                <GalleryFocusWrapper
                  key={image.id}
                  isFocused={isFocused}
                  isMeasure={index === 0}
                >
                  {card}
                </GalleryFocusWrapper>
              );
            })}
          </div>
          {bottomSpacerHeight > 0 && (
            <div style={{ height: bottomSpacerHeight }} aria-hidden="true" />
          )}
        </div>
      </ScrollArea>
    );
  }

  if (isInitializing) {
    return (
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
    );
  }

  if (!hasFolders && onAddFolder) {
    return <OnboardingView onAddFolder={onAddFolder} />;
  }

  if (scanning) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-4 select-none">
        <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mb-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
        <h3 className="text-lg font-medium text-foreground mb-2">
          {t("gallery.scanningTitle")}
        </h3>
        <p className="text-sm text-muted-foreground max-w-md">
          {t("gallery.scanningDescription")}
        </p>
      </div>
    );
  }

  if (isRefreshing) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border/70 bg-background/88 text-primary shadow-xl">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </div>
    );
  }

  return (
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
  );
});

interface GalleryPaginationProps {
  currentPage: number;
  computedTotalPages: number;
  onPageChange: (page: number) => void;
}

const GalleryPagination = memo(function GalleryPagination({
  currentPage,
  computedTotalPages,
  onPageChange,
}: GalleryPaginationProps) {
  const { t } = useTranslation();
  const [pageJumpValue, setPageJumpValue] = useState(String(currentPage));
  const [pageJumpOpen, setPageJumpOpen] = useState(false);
  const pageJumpButtonRef = useRef<HTMLButtonElement | null>(null);
  const pageJumpPopoverRef = useRef<HTMLDivElement | null>(null);
  const pageJumpInputRef = useRef<HTMLInputElement | null>(null);

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

  const handleJumpToPage = useCallback(() => {
    const parsed = Number.parseInt(pageJumpValue, 10);
    if (!Number.isFinite(parsed)) {
      setPageJumpValue(String(currentPage));
      return;
    }
    onPageChange(parsed);
    setPageJumpOpen(false);
  }, [currentPage, onPageChange, pageJumpValue]);

  if (computedTotalPages <= 1) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-3 border-t border-border p-4">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        title={t("gallery.firstPage")}
        aria-label={t("gallery.firstPage")}
        disabled={currentPage === 1}
        onClick={() => onPageChange(1)}
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
        onClick={() => onPageChange(currentPage - 1)}
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
        onClick={() => onPageChange(currentPage + 1)}
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
        onClick={() => onPageChange(computedTotalPages)}
      >
        <ChevronsRight className="h-4 w-4" />
      </Button>
    </div>
  );
});

export const ImageGallery = memo(function ImageGallery({
  gallery,
  actions,
  pagination,
  scanning = false,
  syncing = false,
  enableVirtualization = false,
  focusIndex,
  onColumnCountChange,
  galleryColumns,
  onGalleryColumnsChange,
}: ImageGalleryProps) {
  const {
    images,
    sortBy,
    totalCount,
    searchQuery,
    hasFolders = true,
    isInitializing = false,
    isRefreshing = false,
    selectionScopeKey,
  } = gallery;
  const { t } = useTranslation();
  const {
    onSortChange,
    onToggleFavorite,
    onCopyPrompt,
    onImageClick,
    onReveal,
    onDelete,
    onChangeCategory,
    onBulkChangeCategory,
    onBulkDelete,
    onRescanMetadata,
    onBulkRescanMetadata,
    onSendToGenerator,
    onSendToSource,
    onAddTagToSearch,
    onAddTagToGenerator,
    onClearSearch,
    onAddFolder,
    onLoadAllSelectableIds,
  } = actions;
  const { pageSize = 50, page, totalPages, onPageChange } = pagination ?? {};
  const [internalPage, setInternalPage] = useState(1);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectingAllResults, setSelectingAllResults] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
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
    const viewport = getScrollAreaViewport(scrollRef.current);
    if (viewport) viewport.scrollTop = 0;
  }, [currentPage]);

  const resetSelectionState = useCallback(() => {
    selectAllRequestSeqRef.current += 1;
    setSelectedIds(new Set());
    setSelectingAllResults(false);
  }, []);

  useEffect(() => {
    if (!selectionMode) {
      resetSelectionState();
    }
  }, [resetSelectionState, selectionMode]);

  useEffect(() => {
    resetSelectionState();
  }, [resetSelectionState, selectionScopeKey]);

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

  const pagedRef = useRef(paged);
  useEffect(() => {
    pagedRef.current = paged;
  }, [paged]);

  const selectedIdsRef = useRef(selectedIds);
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  const handleSelectImage = useCallback((id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleSelectCurrentPage = useCallback(() => {
    const currentPaged = pagedRef.current;
    const isAllSelected =
      currentPaged.length > 0 &&
      currentPaged.every((img) => selectedIdsRef.current.has(img.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (isAllSelected) {
        currentPaged.forEach((img) => next.delete(img.id));
      } else {
        currentPaged.forEach((img) => next.add(img.id));
      }
      return next;
    });
  }, []);

  const handleSelectAllFiltered = useCallback(() => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
      return;
    }
    if (!onLoadAllSelectableIds) return;
    const requestId = ++selectAllRequestSeqRef.current;
    setSelectingAllResults(true);
    void onLoadAllSelectableIds()
      .then((loadedIds) => {
        if (requestId !== selectAllRequestSeqRef.current) return;
        setSelectedIds(new Set(loadedIds.map(String)));
      })
      .catch(() => {
        // Errors are handled by the caller.
      })
      .finally(() => {
        if (requestId !== selectAllRequestSeqRef.current) return;
        setSelectingAllResults(false);
      });
  }, [allFilteredSelected, onLoadAllSelectableIds]);

  const handleBulkCategory = useCallback(() => {
    if (selectedIds.size === 0) return;
    const numericIds = Array.from(selectedIds).map((id) => parseInt(id, 10));
    onBulkChangeCategory(numericIds);
  }, [onBulkChangeCategory, selectedIds]);

  const handleBulkDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    const numericIds = Array.from(selectedIds).map((id) => parseInt(id, 10));
    onBulkDelete(numericIds);
  }, [onBulkDelete, selectedIds]);

  const handleBulkRescanMetadata = useCallback(() => {
    if (selectedIds.size === 0 || !onBulkRescanMetadata) return;
    const numericIds = Array.from(selectedIds).map((id) => parseInt(id, 10));
    onBulkRescanMetadata(numericIds);
  }, [onBulkRescanMetadata, selectedIds]);

  const handleToggleSelectionMode = useCallback(() => {
    setSelectionMode((prev) => !prev);
  }, []);

  const handleClearSelection = useCallback(() => {
    resetSelectionState();
  }, [resetSelectionState]);

  const canSelectAllResults =
    totalCount > 0 && !selectingAllResults && !!onLoadAllSelectableIds;

  return (
    <div
      className="relative flex-1 flex flex-col"
      aria-busy={isRefreshing || isInitializing}
    >
      <GalleryToolbar
        totalCount={totalCount}
        searchQuery={searchQuery}
        selectionMode={selectionMode}
        selectedCount={selectedCount}
        sortBy={sortBy}
        allPageSelected={allPageSelected}
        allFilteredSelected={allFilteredSelected}
        selectingAllResults={selectingAllResults}
        canSelectAllResults={canSelectAllResults}
        onClearSearch={onClearSearch}
        onSortChange={onSortChange}
        onToggleSelectionMode={handleToggleSelectionMode}
        onSelectCurrentPage={handleSelectCurrentPage}
        onSelectAllFiltered={handleSelectAllFiltered}
        onClearSelection={handleClearSelection}
        onBulkCategory={handleBulkCategory}
        onBulkRescanMetadata={handleBulkRescanMetadata}
        onBulkDelete={handleBulkDelete}
        galleryColumns={galleryColumns}
        onGalleryColumnsChange={onGalleryColumnsChange}
      />

      {syncing && (
        <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-muted-foreground bg-muted/50 border-b border-border">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("gallery.syncingBanner")}
        </div>
      )}

      {scanning && images.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-muted-foreground bg-muted/50 border-b border-border">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("gallery.scanningBanner")}
        </div>
      )}

      <GalleryResults
        paged={paged}
        scrollRef={scrollRef}
        onToggleFavorite={onToggleFavorite}
        onCopyPrompt={onCopyPrompt}
        onImageClick={onImageClick}
        onReveal={onReveal}
        onDelete={onDelete}
        onChangeCategory={onChangeCategory}
        onSendToGenerator={onSendToGenerator}
        onSendToSource={onSendToSource}
        onAddTagToSearch={onAddTagToSearch}
        onAddTagToGenerator={onAddTagToGenerator}
        selectionMode={selectionMode}
        selectedIds={selectedIds}
        selectedCount={selectedCount}
        onSelectChange={handleSelectImage}
        onBulkDelete={handleBulkDelete}
        onBulkCategory={handleBulkCategory}
        onRescanMetadata={onRescanMetadata}
        onBulkRescanMetadata={handleBulkRescanMetadata}
        isInitializing={isInitializing}
        isRefreshing={isRefreshing}
        scanning={scanning}
        hasFolders={hasFolders}
        onAddFolder={onAddFolder}
        enableVirtualization={enableVirtualization}
        focusIndex={focusIndex}
        onColumnCountChange={onColumnCountChange}
        galleryColumns={galleryColumns}
      />

      <GalleryPagination
        currentPage={currentPage}
        computedTotalPages={computedTotalPages}
        onPageChange={updatePage}
      />

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
