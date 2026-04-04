import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ImageListQuery } from "@preload/index.d";
import { useGalleryImages } from "@/hooks/useGalleryImages";
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
  seedFilters: number[];
  excludeTags: string[];
  folderCount: number | null;
  subfolderFilters?: ImageListQuery["subfolderFilters"];
}

export function useGalleryController({
  pageSize,
  recentDays,
  selectedFolderIds,
  queryFragment,
  resolutionFilters,
  modelFilters,
  seedFilters,
  excludeTags,
  folderCount,
  subfolderFilters,
}: UseGalleryControllerOptions) {
  const [searchQuery, setSearchQuery] = useState("");
  const [galleryOverlayVisible, setGalleryOverlayVisible] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortBy, setSortBy] = useState<SortBy>("recent");
  const galleryOverlayEnterRafRef = useRef<number | null>(null);
  const galleryOverlayActionRafRef = useRef<number | null>(null);
  const galleryOverlayPhaseRef = useRef<"queued" | "loading" | null>(null);

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
      seedFilters,
      excludeTags,
      subfolderFilters,
    }),
    [
      modelFilters,
      seedFilters,
      excludeTags,
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
      subfolderFilters,
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
    loadTokens,
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
        seedFilters,
        excludeTags,
        totalImageCount,
      }),
    [
      modelFilters,
      seedFilters,
      excludeTags,
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
    galleryOverlayPhaseRef.current = null;
  }, []);

  const queueGalleryBlockingAction = useCallback(
    (action: () => void) => {
      clearPendingGalleryOverlayFrames();
      galleryOverlayPhaseRef.current = "queued";
      setGalleryOverlayVisible(true);
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
    if (!galleryOverlayVisible) return;
    if (isGalleryLoading) {
      galleryOverlayPhaseRef.current = "loading";
      return;
    }
    if (galleryOverlayPhaseRef.current === "loading") {
      galleryOverlayPhaseRef.current = null;
      setGalleryOverlayVisible(false);
    }
  }, [galleryOverlayVisible, isGalleryLoading]);

  const handleSearchChange = useCallback(
    (nextQuery: string) => {
      if (nextQuery === searchQuery) return;
      queueGalleryBlockingAction(() => {
        setGalleryPage(1);
        setSearchQuery(nextQuery);
      });
    },
    [queueGalleryBlockingAction, searchQuery, setGalleryPage],
  );

  const handleGalleryPageChange = useCallback(
    (nextPage: number) => {
      if (nextPage === galleryPage) return;
      queueGalleryBlockingAction(() => {
        setGalleryPage(nextPage);
      });
    },
    [galleryPage, queueGalleryBlockingAction, setGalleryPage],
  );

  const handleClearSearch = useCallback(() => {
    handleSearchChange("");
  }, [handleSearchChange]);

  const handleLoadAllSelectableIds = useCallback(async () => {
    try {
      return await window.image.listMatchingIds(listBaseQuery);
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
      isRefreshing: galleryOverlayVisible,
      selectionScopeKey: gallerySelectionScopeKey,
    }),
    [
      folderCount,
      galleryOverlayVisible,
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
      onLoadAllSelectableIds: handleLoadAllSelectableIds,
      onLoadTokens: loadTokens,
    }),
    [handleClearSearch, handleLoadAllSelectableIds, loadTokens],
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
