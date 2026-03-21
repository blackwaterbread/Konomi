import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ImageListQuery } from "@preload/index.d";
import { useGalleryImages } from "@/hooks/useGalleryImages";
import { rowToImageData } from "@/lib/image-utils";
import i18n from "@/lib/i18n";

type ViewMode = "grid" | "compact" | "list";
type SortBy = "recent" | "oldest" | "favorites" | "name";

interface GalleryQueryFragment {
  onlyRecent: boolean;
  customCategoryId: number | null;
  builtinCategory: "favorites" | "random" | null;
  randomSeed: number;
}

interface UseGalleryControllerOptions {
  pageSize: number;
  recentDays: number;
  selectedFolderIds: Set<number>;
  queryFragment: GalleryQueryFragment;
  resolutionFilters: Array<{ width: number; height: number }>;
  modelFilters: string[];
  folderCount: number | null;
}

export function useGalleryController({
  pageSize,
  recentDays,
  selectedFolderIds,
  queryFragment,
  resolutionFilters,
  modelFilters,
  folderCount,
}: UseGalleryControllerOptions) {
  const [searchQuery, setSearchQuery] = useState("");
  const [galleryOverlayState, setGalleryOverlayState] = useState<{
    reason: "page" | "search";
    phase: "queued" | "loading";
  } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortBy, setSortBy] = useState<SortBy>("recent");
  const galleryOverlayEnterRafRef = useRef<number | null>(null);
  const galleryOverlayActionRafRef = useRef<number | null>(null);

  const listBaseQuery = useMemo<Omit<ImageListQuery, "page">>(
    () => ({
      pageSize,
      folderIds: [...selectedFolderIds].sort((a, b) => a - b),
      searchQuery,
      sortBy,
      onlyRecent: queryFragment.onlyRecent,
      recentDays,
      customCategoryId: queryFragment.customCategoryId,
      builtinCategory: queryFragment.builtinCategory,
      randomSeed: queryFragment.randomSeed,
      resolutionFilters,
      modelFilters,
    }),
    [
      modelFilters,
      pageSize,
      queryFragment.builtinCategory,
      queryFragment.customCategoryId,
      queryFragment.onlyRecent,
      queryFragment.randomSeed,
      recentDays,
      resolutionFilters,
      searchQuery,
      selectedFolderIds,
      sortBy,
    ],
  );

  const {
    images,
    setImages,
    totalImageCount,
    galleryPage,
    setGalleryPage,
    galleryTotalPages,
    hasLoadedOnce,
    isLoading: isGalleryLoading,
    schedulePageRefresh,
  } = useGalleryImages(listBaseQuery);

  const gallerySelectionScopeKey = useMemo(
    () =>
      JSON.stringify({
        folderIds: [...selectedFolderIds].sort((a, b) => a - b),
        searchQuery,
        onlyRecent: queryFragment.onlyRecent,
        recentDays,
        customCategoryId: queryFragment.customCategoryId,
        builtinCategory: queryFragment.builtinCategory,
        randomSeed: queryFragment.randomSeed,
        resolutionFilters,
        modelFilters,
        totalImageCount,
      }),
    [
      modelFilters,
      queryFragment.builtinCategory,
      queryFragment.customCategoryId,
      queryFragment.onlyRecent,
      queryFragment.randomSeed,
      recentDays,
      resolutionFilters,
      searchQuery,
      selectedFolderIds,
      totalImageCount,
    ],
  );

  const clearPendingGalleryOverlayFrames = useCallback(() => {
    if (galleryOverlayEnterRafRef.current !== null) {
      cancelAnimationFrame(galleryOverlayEnterRafRef.current);
      galleryOverlayEnterRafRef.current = null;
    }
    if (galleryOverlayActionRafRef.current !== null) {
      cancelAnimationFrame(galleryOverlayActionRafRef.current);
      galleryOverlayActionRafRef.current = null;
    }
  }, []);

  const queueGalleryBlockingAction = useCallback(
    (reason: "page" | "search", action: () => void) => {
      clearPendingGalleryOverlayFrames();
      setGalleryOverlayState({ reason, phase: "queued" });
      galleryOverlayEnterRafRef.current = requestAnimationFrame(() => {
        galleryOverlayEnterRafRef.current = null;
        galleryOverlayActionRafRef.current = requestAnimationFrame(() => {
          galleryOverlayActionRafRef.current = null;
          action();
        });
      });
    },
    [clearPendingGalleryOverlayFrames],
  );

  useEffect(
    () => () => {
      clearPendingGalleryOverlayFrames();
    },
    [clearPendingGalleryOverlayFrames],
  );

  useEffect(() => {
    if (!galleryOverlayState) return;
    if (isGalleryLoading) {
      if (galleryOverlayState.phase !== "loading") {
        setGalleryOverlayState((prev) =>
          prev ? { ...prev, phase: "loading" } : prev,
        );
      }
      return;
    }
    if (galleryOverlayState.phase === "loading") {
      setGalleryOverlayState(null);
    }
  }, [galleryOverlayState, isGalleryLoading]);

  const handleSearchChange = useCallback(
    (nextQuery: string) => {
      if (nextQuery === searchQuery) return;
      queueGalleryBlockingAction("search", () => {
        setGalleryPage(1);
        setSearchQuery(nextQuery);
      });
    },
    [queueGalleryBlockingAction, searchQuery, setGalleryPage],
  );

  const handleGalleryPageChange = useCallback(
    (nextPage: number) => {
      if (nextPage === galleryPage) return;
      queueGalleryBlockingAction("page", () => {
        setGalleryPage(nextPage);
      });
    },
    [galleryPage, queueGalleryBlockingAction, setGalleryPage],
  );

  const handleClearSearch = useCallback(() => {
    handleSearchChange("");
  }, [handleSearchChange]);

  const handleLoadAllSelectableImages = useCallback(async () => {
    try {
      const rows = await window.image.listMatching(listBaseQuery);
      return rows.map(rowToImageData);
    } catch (error: unknown) {
      toast.error(
        i18n.t("error.imageListLoadFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      throw error;
    }
  }, [listBaseQuery]);

  const imageGalleryState = useMemo(
    () => ({
      images,
      viewMode,
      sortBy,
      totalCount: totalImageCount,
      searchQuery: searchQuery || undefined,
      hasFolders: folderCount === null || folderCount > 0,
      isInitializing: !hasLoadedOnce && isGalleryLoading,
      isRefreshing: galleryOverlayState !== null,
      selectionScopeKey: gallerySelectionScopeKey,
    }),
    [
      folderCount,
      galleryOverlayState,
      gallerySelectionScopeKey,
      hasLoadedOnce,
      images,
      isGalleryLoading,
      searchQuery,
      sortBy,
      totalImageCount,
      viewMode,
    ],
  );

  const imageGalleryPagination = useMemo(
    () => ({
      pageSize,
      page: galleryPage,
      totalPages: galleryTotalPages,
      onPageChange: handleGalleryPageChange,
    }),
    [galleryPage, galleryTotalPages, handleGalleryPageChange, pageSize],
  );

  const galleryCommands = useMemo(
    () => ({
      onViewModeChange: setViewMode,
      onSortChange: setSortBy,
      onClearSearch: handleClearSearch,
      onLoadAllSelectableImages: handleLoadAllSelectableImages,
    }),
    [handleClearSearch, handleLoadAllSelectableImages],
  );

  return {
    images,
    setImages,
    sortBy,
    searchQuery,
    handleSearchChange,
    schedulePageRefresh,
    imageGalleryState,
    imageGalleryPagination,
    galleryCommands,
  };
}
