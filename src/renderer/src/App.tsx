import {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  useDeferredValue,
  startTransition,
} from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Header } from "@/components/header";
import { Sidebar } from "@/components/sidebar";
import type { SidebarHandle } from "@/components/sidebar";
import { ImageGallery } from "@/components/image-gallery";
import { ImageDetail } from "@/components/image-detail";
import { SettingsView } from "@/components/settings-view";
import { CategoryDialog } from "@/components/category-dialog";
import {
  GenerationView,
  type GenerationViewHandle,
} from "@/components/generation-view";
import { FeatureTour } from "@/components/feature-tour";
import { InitialLanguageScreen } from "@/components/initial-language-screen";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSettings, type Settings } from "@/hooks/useSettings";
import { useNaiGenSettings } from "@/hooks/useNaiGenSettings";
import { useGalleryImages } from "@/hooks/useGalleryImages";
import { useScanning } from "@/hooks/useScanning";
import { useImageAnalysis } from "@/hooks/useImageAnalysis";
import { useCategories } from "@/hooks/useCategories";
import { useSidebarFolders } from "@/hooks/useSidebarFolders";
import { useSidebarFolderActions } from "@/hooks/useSidebarFolderActions";
import { useSimilarImages } from "@/hooks/useSimilarImages";
import type { ImageData } from "@/components/image-card";
import type { ImageListQuery } from "@preload/index.d";
import type { AdvancedFilter } from "@/lib/advanced-filter";
import { createLogger } from "@/lib/logger";
import { rowToImageData } from "@/lib/image-utils";
import { dispatchSearchInputAppendTag } from "@/lib/search-input-event";
import { applyAppLanguagePreference } from "@/lib/i18n";
import { useTranslation } from "react-i18next";

const log = createLogger("renderer/App");
const INITIAL_LANGUAGE_SCREEN_COMPLETED_KEY =
  "konomi-initial-language-selection-completed";
const SIMILARITY_SETTING_KEYS = new Set<keyof Settings>([
  "similarityThreshold",
  "useAdvancedSimilarityThresholds",
  "visualSimilarityThreshold",
  "promptSimilarityThreshold",
]);

function isSimilaritySettingsPatch(patch: Partial<Settings>): boolean {
  return (Object.keys(patch) as Array<keyof Settings>).some((key) =>
    SIMILARITY_SETTING_KEYS.has(key),
  );
}

function includesSimilaritySettingsReset(keys?: (keyof Settings)[]): boolean {
  if (!keys || keys.length === 0) return true;
  return keys.some((key) => SIMILARITY_SETTING_KEYS.has(key));
}

function resolveIsDarkTheme(theme: Settings["theme"] | undefined): boolean {
  const resolvedTheme = theme ?? "dark";
  if (resolvedTheme === "auto") {
    return (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  }

  return resolvedTheme === "dark";
}

interface AppProps {
  initialFolderCount?: number | null;
}

export default function App({ initialFolderCount = null }: AppProps) {
  const { settings, updateSettings, resetSettings } = useSettings();
  const { t } = useTranslation();
  const { outputFolder, setOutputFolder } = useNaiGenSettings();
  const [searchQuery, setSearchQuery] = useState("");
  const [galleryOverlayState, setGalleryOverlayState] = useState<{
    reason: "page" | "search";
    phase: "queued" | "loading";
  } | null>(null);
  const {
    selectedFolderIds,
    toggleFolder,
    addSelectedFolder,
    removeSelectedFolder,
    folderCount,
    incrementFolderCount,
    decrementFolderCount,
  } = useSidebarFolders(initialFolderCount);
  const [activeView, setActiveView] = useState("all");
  const [viewMode, setViewMode] = useState<"grid" | "compact" | "list">("grid");
  const [sortBy, setSortBy] = useState<
    "recent" | "oldest" | "favorites" | "name"
  >("recent");
  const [selectedImageSnapshot, setSelectedImage] = useState<ImageData | null>(
    null,
  );
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<
    "gallery" | "generator" | "settings"
  >("gallery");
  const [isDarkTheme, setIsDarkTheme] = useState(() =>
    resolveIsDarkTheme(settings.theme),
  );
  const [tourOpen, setTourOpen] = useState(
    () => localStorage.getItem("konomi-tour-completed") !== "true",
  );
  const [initialLanguageScreenOpen, setInitialLanguageScreenOpen] = useState(
    () =>
      localStorage.getItem("konomi-tour-completed") !== "true" &&
      localStorage.getItem(INITIAL_LANGUAGE_SCREEN_COMPLETED_KEY) !== "true",
  );
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      return Number(localStorage.getItem("konomi-sidebar-width")) || 288;
    } catch {
      return 288;
    }
  });
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const currentSidebarWidth = useRef(sidebarWidth);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true;
      dragStartX.current = e.clientX;
      dragStartWidth.current = sidebarWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [sidebarWidth],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const next = Math.max(
        180,
        Math.min(480, dragStartWidth.current + e.clientX - dragStartX.current),
      );
      currentSidebarWidth.current = next;
      setSidebarWidth(next);
    };
    const onUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        localStorage.setItem(
          "konomi-sidebar-width",
          String(currentSidebarWidth.current),
        );
      } catch {
        /* ignore */
      }
    };
    const onUnload = () => {
      try {
        localStorage.setItem(
          "konomi-sidebar-width",
          String(currentSidebarWidth.current),
        );
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);

  const {
    categories,
    selectedCategoryId,
    selectedCategory,
    selectedBuiltinCategory,
    selectCategory,
    createCategory,
    renameCategory,
    reorderCategories,
    deleteCategory,
    addCategoryByPrompt,
  } = useCategories();
  const [randomSeed, setRandomSeed] = useState(() =>
    Math.floor(Math.random() * 0x7fffffff),
  );
  const [categoryDialogImage, setCategoryDialogImage] =
    useState<ImageData | null>(null);
  const [bulkCategoryDialogImages, setBulkCategoryDialogImages] = useState<
    ImageData[] | null
  >(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilter[]>([]);
  const [availableResolutions, setAvailableResolutions] = useState<
    Array<{ width: number; height: number }>
  >([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [generatorTransitioning, setGeneratorTransitioning] = useState(false);
  const [searchStatsProgress, setSearchStatsProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  const searchStatsRefreshTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const searchStatsClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const galleryOverlayEnterRafRef = useRef<number | null>(null);
  const galleryOverlayActionRafRef = useRef<number | null>(null);
  const generationViewRef = useRef<GenerationViewHandle | null>(null);
  const sidebarRef = useRef<SidebarHandle | null>(null);
  const resolutionFilters = useMemo(
    () =>
      advancedFilters
        .filter(
          (f): f is Extract<AdvancedFilter, { type: "resolution" }> =>
            f.type === "resolution",
        )
        .map((f) => ({ width: f.width, height: f.height })),
    [advancedFilters],
  );
  const modelFilters = useMemo(
    () =>
      advancedFilters
        .filter(
          (f): f is Extract<AdvancedFilter, { type: "model" }> =>
            f.type === "model",
        )
        .map((f) => f.value),
    [advancedFilters],
  );
  const listBaseQuery = useMemo<Omit<ImageListQuery, "page">>(
    () => ({
      pageSize: settings.pageSize,
      folderIds: [...selectedFolderIds].sort((a, b) => a - b),
      searchQuery,
      sortBy,
      onlyRecent: activeView === "recent",
      recentDays: settings.recentDays,
      customCategoryId:
        selectedCategory && !selectedCategory.isBuiltin
          ? selectedCategory.id
          : null,
      builtinCategory: selectedBuiltinCategory,
      randomSeed,
      resolutionFilters,
      modelFilters,
    }),
    [
      settings.pageSize,
      selectedFolderIds,
      searchQuery,
      sortBy,
      activeView,
      settings.recentDays,
      selectedCategory,
      selectedBuiltinCategory,
      randomSeed,
      resolutionFilters,
      modelFilters,
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
  const selectedImage = useMemo(() => {
    if (!selectedImageSnapshot) return null;
    return (
      images.find((image) => image.id === selectedImageSnapshot.id) ??
      selectedImageSnapshot
    );
  }, [images, selectedImageSnapshot]);
  const selectedImageId = selectedImage?.id ?? null;
  const deferredDetailContentImageId = useDeferredValue(
    isDetailOpen ? selectedImageId : null,
  );
  const detailContentReady =
    !!selectedImageId && deferredDetailContentImageId === selectedImageId;
  const gallerySelectionScopeKey = useMemo(
    () =>
      JSON.stringify({
        folderIds: [...selectedFolderIds].sort((a, b) => a - b),
        searchQuery,
        onlyRecent: activeView === "recent",
        recentDays: settings.recentDays,
        customCategoryId:
          selectedCategory && !selectedCategory.isBuiltin
            ? selectedCategory.id
            : null,
        builtinCategory: selectedBuiltinCategory,
        randomSeed,
        resolutionFilters,
        modelFilters,
        totalImageCount,
      }),
    [
      activeView,
      modelFilters,
      randomSeed,
      resolutionFilters,
      searchQuery,
      selectedBuiltinCategory,
      selectedCategory,
      selectedFolderIds,
      settings.recentDays,
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

  const loadSearchPresetStats = useCallback(async () => {
    try {
      const stats = await window.image.getSearchPresetStats();
      startTransition(() => {
        setAvailableResolutions(stats.availableResolutions);
        setAvailableModels(stats.availableModels);
      });
    } catch (e: unknown) {
      log.warn("Failed to load search preset stats", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  const scheduleSearchStatsRefresh = useCallback(
    (delay = 220) => {
      if (searchStatsRefreshTimerRef.current) {
        clearTimeout(searchStatsRefreshTimerRef.current);
      }
      searchStatsRefreshTimerRef.current = setTimeout(() => {
        searchStatsRefreshTimerRef.current = null;
        void loadSearchPresetStats();
      }, delay);
    },
    [loadSearchPresetStats],
  );

  const {
    scanning,
    activeScanFolderIds,
    setActiveScanFolderIds,
    setRollbackFolderIds,
    scanProgress,
    scanCancelConfirmOpen,
    setScanCancelConfirmOpen,
    scanningFolderNames,
    folderRollbackRequest,
    scanningRef,
    runScan,
    handleCancelScan,
    confirmCancelScan,
  } = useScanning({ schedulePageRefresh, loadSearchPresetStats });

  const {
    isAnalyzing,
    hashProgress,
    similarityProgress,
    similarGroups,
    analyzeTimerRef,
    pendingSimilarityRecalcRef,
    visualThresholdRef,
    promptThresholdRef,
    suspendAutoAnalysisRef,
    runAnalysisNow,
    scheduleAnalysis,
  } = useImageAnalysis({ scanningRef, settings });

  const {
    handleFolderAdded,
    handleFolderCancelled,
    handleFolderRemoved,
    handleFolderRescan,
  } = useSidebarFolderActions({
    isAnalyzing,
    addSelectedFolder,
    removeSelectedFolder,
    incrementFolderCount,
    decrementFolderCount,
    runScan,
    scanningRef,
    scheduleAnalysis,
    schedulePageRefresh,
    setActiveScanFolderIds,
    setRollbackFolderIds,
  });
  const { similarImages, similarReasons, similarImagesLoading } =
    useSimilarImages({
      selectedImageId,
      isDetailOpen,
      detailContentReady,
      similarGroups,
      visualThresholdRef,
      promptThresholdRef,
    });

  const handleSettingsUpdate = useCallback(
    (patch: Partial<Settings>) => {
      updateSettings(patch);
      if (isSimilaritySettingsPatch(patch)) {
        pendingSimilarityRecalcRef.current = true;
      }
    },
    [updateSettings, pendingSimilarityRecalcRef],
  );

  const handleSettingsReset = useCallback(
    (keys?: (keyof Settings)[]) => {
      resetSettings(keys);
      if (includesSimilaritySettingsReset(keys)) {
        pendingSimilarityRecalcRef.current = true;
      }
    },
    [resetSettings, pendingSimilarityRecalcRef],
  );

  useEffect(() => {
    void applyAppLanguagePreference(settings.language);
  }, [settings.language]);

  useEffect(() => {
    const theme = settings.theme ?? "dark";
    const applyTheme = (isDark: boolean) => {
      document.documentElement.dataset.theme = isDark ? "dark" : "white";
      document.documentElement.classList.toggle("dark", isDark);
      setIsDarkTheme(isDark);
    };
    if (theme === "auto") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      applyTheme(mq.matches);
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches);
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
    applyTheme(theme === "dark");
    return undefined;
  }, [settings.theme]);

  const handlePanelChange = useCallback(
    async (nextPanel: "gallery" | "generator" | "settings") => {
      if (nextPanel === activePanel) return;

      const leavingSettings =
        activePanel === "settings" && nextPanel !== "settings";
      if (!leavingSettings || !pendingSimilarityRecalcRef.current) {
        setActivePanel(nextPanel);
        return;
      }

      if (scanningRef.current) {
        toast.error(t("error.scanInProgressForSimilarity"));
        return;
      }

      if (analyzeTimerRef.current) {
        clearTimeout(analyzeTimerRef.current);
        analyzeTimerRef.current = null;
      }

      setActivePanel(nextPanel);
      void runAnalysisNow();
    },
    [
      activePanel,
      runAnalysisNow,
      scanningRef,
      analyzeTimerRef,
      pendingSimilarityRecalcRef,
      t,
    ],
  );

  useEffect(() => {
    log.info("App mounted: loading initial data and starting watchers");
    void loadSearchPresetStats();
    scheduleAnalysis(0);

    const offBatch = window.image.onBatch((rows) => {
      if (rows.length === 0) return;
      schedulePageRefresh(scanningRef.current ? 1500 : 150);
      if (!scanningRef.current) {
        scheduleAnalysis();
        scheduleSearchStatsRefresh(180);
      }
    });

    const offRemoved = window.image.onRemoved((ids) => {
      if (ids.length === 0) return;
      schedulePageRefresh(60);
      scheduleAnalysis();
      scheduleSearchStatsRefresh(120);
    });

    const offSearchStatsProgress = window.image.onSearchStatsProgress(
      (data) => {
        startTransition(() => setSearchStatsProgress(data));
        if (searchStatsClearTimerRef.current) {
          clearTimeout(searchStatsClearTimerRef.current);
          searchStatsClearTimerRef.current = null;
        }
        if (data.total > 0 && data.done >= data.total) {
          searchStatsClearTimerRef.current = setTimeout(() => {
            setSearchStatsProgress(null);
            searchStatsClearTimerRef.current = null;
          }, 250);
        }
      },
    );

    let watchCancelled = false;
    let watchRetryTimer: ReturnType<typeof setTimeout> | null = null;
    const startWatch = (attempt = 0): void => {
      void window.image.watch().catch((error: unknown) => {
        if (watchCancelled) return;
        const delayMs = Math.min(10000, 1000 * 2 ** attempt);
        log.warn("Image watcher start failed; retry scheduled", {
          attempt: attempt + 1,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        });
        watchRetryTimer = setTimeout(() => {
          watchRetryTimer = null;
          startWatch(attempt + 1);
        }, delayMs);
      });
    };
    startWatch();

    return () => {
      log.info("App unmount cleanup");
      watchCancelled = true;
      if (watchRetryTimer) {
        clearTimeout(watchRetryTimer);
        watchRetryTimer = null;
      }
      if (searchStatsRefreshTimerRef.current) {
        clearTimeout(searchStatsRefreshTimerRef.current);
        searchStatsRefreshTimerRef.current = null;
      }
      if (searchStatsClearTimerRef.current) {
        clearTimeout(searchStatsClearTimerRef.current);
        searchStatsClearTimerRef.current = null;
      }
      offBatch();
      offRemoved();
      offSearchStatsProgress();
    };
  }, [
    loadSearchPresetStats,
    scanningRef,
    scheduleAnalysis,
    schedulePageRefresh,
    scheduleSearchStatsRefresh,
  ]);

  const handleCategoryAddByPrompt = useCallback(
    (id: number, query: string) => {
      void addCategoryByPrompt(id, query).then((shouldRefreshPage) => {
        if (shouldRefreshPage) {
          schedulePageRefresh(0);
        }
      });
    },
    [addCategoryByPrompt, schedulePageRefresh],
  );

  const handleToggleFavorite = useCallback(
    (id: string) => {
      log.debug("Toggling favorite", { imageId: id });
      setImages((prev) => {
        const img = prev.find((i) => i.id === id);
        if (!img) return prev;
        const nextIsFavorite = !img.isFavorite;
        const shouldRefreshPage =
          sortBy === "favorites" || selectedBuiltinCategory === "favorites";
        window.image
          .setFavorite(parseInt(id, 10), nextIsFavorite)
          .then(() => {
            if (shouldRefreshPage) schedulePageRefresh(0);
          })
          .catch((e: unknown) => {
            toast.error(
              t("error.favoriteSetFailed", {
                message: e instanceof Error ? e.message : String(e),
              }),
            );
          });
        return prev.map((i) =>
          i.id === id ? { ...i, isFavorite: nextIsFavorite } : i,
        );
      });
      setSelectedImage((prev) =>
        prev?.id === id ? { ...prev, isFavorite: !prev.isFavorite } : prev,
      );
    },
    [schedulePageRefresh, selectedBuiltinCategory, setImages, sortBy, t],
  );

  const handleCopyPrompt = useCallback(
    (prompt: string) => {
      navigator.clipboard
        .writeText(prompt)
        .catch(() => toast.error(t("app.clipboardCopyFailed")));
    },
    [t],
  );

  const handleAddTagToSearch = useCallback((tag: string) => {
    const normalizedTag = tag.trim();
    if (!normalizedTag) return;
    dispatchSearchInputAppendTag({
      tag: normalizedTag,
      focusInput: false,
      suppressAutocomplete: true,
    });
  }, []);

  const handleAddTagToGenerator = useCallback(
    (tag: string) => {
      const normalizedTag = tag.trim();
      if (!normalizedTag) return;
      generationViewRef.current?.appendPromptTag(normalizedTag);
      void handlePanelChange("generator");
    },
    [handlePanelChange],
  );

  const handleReveal = useCallback((path: string) => {
    window.image.revealInExplorer(path);
  }, []);

  const handleDeleteImage = useCallback((id: string) => {
    log.info("Deleting image requested", { imageId: id });
    setDeleteConfirmId(id);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (!deleteConfirmId) return;
    const img = images.find((i) => i.id === deleteConfirmId);
    if (img) {
      window.image.delete(img.path).catch((e: unknown) => {
        toast.error(
          t("error.imageDeleteFailed", {
            message: e instanceof Error ? e.message : String(e),
          }),
        );
      });
      if (selectedImage?.id === deleteConfirmId) {
        setSelectedImage(null);
        setIsDetailOpen(false);
      }
      schedulePageRefresh(60);
    }
    setDeleteConfirmId(null);
  }, [deleteConfirmId, images, schedulePageRefresh, selectedImage?.id, t]);

  const handleSendToGenerator = useCallback(
    (image: ImageData) => {
      setGeneratorTransitioning(true);
      requestAnimationFrame(() => {
        generationViewRef.current?.importImage(image);
        void handlePanelChange("generator");
        requestAnimationFrame(() => {
          setGeneratorTransitioning(false);
        });
      });
    },
    [handlePanelChange],
  );

  const handleSendToSource = useCallback(
    (image: ImageData) => {
      generationViewRef.current?.showSourceImage(image);
      void handlePanelChange("generator");
    },
    [handlePanelChange],
  );

  const handleChangeCategory = useCallback((image: ImageData) => {
    setBulkCategoryDialogImages(null);
    setCategoryDialogImage(image);
  }, []);

  const handleBulkChangeCategory = useCallback((targets: ImageData[]) => {
    if (targets.length === 0) return;
    setCategoryDialogImage(null);
    setBulkCategoryDialogImages(targets);
  }, []);

  const handleRandomRefresh = useCallback(() => {
    log.info("Random pick refreshed");
    setRandomSeed((seed) => seed + 1);
  }, []);

  const handleCategoryDialogClose = useCallback(() => {
    setCategoryDialogImage(null);
    setBulkCategoryDialogImages(null);
    schedulePageRefresh(0);
  }, [schedulePageRefresh]);

  const handleTourAction = useCallback((action: string) => {
    if (action === "open-prompt-group-panel") {
      generationViewRef.current?.openRightPanelTab("prompt-group");
      return;
    }
    if (action === "open-settings-panel") {
      generationViewRef.current?.openRightPanelTab("settings");
    }
  }, []);

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
    } catch (e: unknown) {
      toast.error(
        t("error.imageListLoadFailed", {
          message: e instanceof Error ? e.message : String(e),
        }),
      );
      throw e;
    }
  }, [listBaseQuery, t]);

  const handleHeaderPanelChange = useCallback(
    (panel: "gallery" | "generator" | "settings") => {
      void handlePanelChange(panel);
    },
    [handlePanelChange],
  );

  const handleStartTour = useCallback(() => {
    setTourOpen(true);
  }, []);

  const handleTourClose = useCallback(() => {
    setTourOpen(false);
    setActivePanel("gallery");
    localStorage.setItem("konomi-tour-completed", "true");
  }, []);

  const handleInitialLanguageContinue = useCallback(() => {
    try {
      localStorage.setItem(INITIAL_LANGUAGE_SCREEN_COMPLETED_KEY, "true");
    } catch {
      // ignore storage errors
    }
    setInitialLanguageScreenOpen(false);
  }, []);

  const selectedIndex = useMemo(
    () =>
      selectedImageId
        ? images.findIndex((img) => img.id === selectedImageId)
        : -1,
    [images, selectedImageId],
  );

  const handlePrev = useCallback(() => {
    if (selectedIndex > 0) setSelectedImage(images[selectedIndex - 1]);
  }, [images, selectedIndex]);

  const handleNext = useCallback(() => {
    if (selectedIndex < images.length - 1)
      setSelectedImage(images[selectedIndex + 1]);
  }, [images, selectedIndex]);

  const handleImageClick = useCallback((image: ImageData) => {
    setSelectedImage(image);
    setIsDetailOpen(true);
  }, []);

  const sidebarView = useMemo(
    () => ({
      activeView,
      onViewChange: setActiveView,
    }),
    [activeView],
  );

  const sidebarFolderState = useMemo(
    () => ({
      selectedFolderIds,
      rollbackRequest: folderRollbackRequest,
      scanningFolderIds: activeScanFolderIds,
      scanning,
    }),
    [
      activeScanFolderIds,
      folderRollbackRequest,
      scanning,
      selectedFolderIds,
    ],
  );

  const sidebarFolderActions = useMemo(
    () => ({
      onFolderToggle: toggleFolder,
      onFolderRemoved: handleFolderRemoved,
      onFolderAdded: handleFolderAdded,
      onFolderCancelled: handleFolderCancelled,
      onFolderRescan: handleFolderRescan,
    }),
    [
      handleFolderAdded,
      handleFolderCancelled,
      handleFolderRemoved,
      handleFolderRescan,
      toggleFolder,
    ],
  );

  const sidebarCategoryState = useMemo(
    () => ({
      categories,
      selectedCategoryId,
    }),
    [categories, selectedCategoryId],
  );

  const sidebarCategoryActions = useMemo(
    () => ({
      onCategorySelect: selectCategory,
      onCategoryCreate: createCategory,
      onCategoryRename: renameCategory,
      onCategoryDelete: deleteCategory,
      onCategoryReorder: reorderCategories,
      onCategoryAddByPrompt: handleCategoryAddByPrompt,
      onRandomRefresh: handleRandomRefresh,
    }),
    [
      createCategory,
      deleteCategory,
      handleCategoryAddByPrompt,
      handleRandomRefresh,
      renameCategory,
      reorderCategories,
      selectCategory,
    ],
  );

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

  const imageGalleryActions = useMemo(
    () => ({
      onViewModeChange: setViewMode,
      onSortChange: setSortBy,
      onToggleFavorite: handleToggleFavorite,
      onCopyPrompt: handleCopyPrompt,
      onImageClick: handleImageClick,
      onReveal: handleReveal,
      onDelete: handleDeleteImage,
      onChangeCategory: handleChangeCategory,
      onBulkChangeCategory: handleBulkChangeCategory,
      onSendToGenerator: handleSendToGenerator,
      onSendToSource: handleSendToSource,
      onAddTagToSearch: handleAddTagToSearch,
      onAddTagToGenerator: handleAddTagToGenerator,
      onClearSearch: handleClearSearch,
      onAddFolder: () => sidebarRef.current?.openFolderDialog(),
      onLoadAllSelectableImages: handleLoadAllSelectableImages,
    }),
    [
      handleAddTagToGenerator,
      handleAddTagToSearch,
      handleBulkChangeCategory,
      handleChangeCategory,
      handleClearSearch,
      handleCopyPrompt,
      handleDeleteImage,
      handleImageClick,
      handleLoadAllSelectableImages,
      handleReveal,
      handleSendToGenerator,
      handleSendToSource,
      handleToggleFavorite,
    ],
  );

  const imageGalleryPagination = useMemo(
    () => ({
      pageSize: settings.pageSize,
      page: galleryPage,
      totalPages: galleryTotalPages,
      onPageChange: handleGalleryPageChange,
    }),
    [
      galleryPage,
      galleryTotalPages,
      handleGalleryPageChange,
      settings.pageSize,
    ],
  );

  return (
    <div className="h-screen bg-background flex flex-col">
      <Header
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        activePanel={activePanel}
        onPanelChange={handleHeaderPanelChange}
        scanning={scanning}
        isAnalyzing={isAnalyzing}
        hashProgress={hashProgress}
        similarityProgress={similarityProgress}
        scanProgress={scanProgress}
        searchStatsProgress={searchStatsProgress}
        scanningFolderNames={scanningFolderNames}
        onCancelScan={handleCancelScan}
        advancedFilters={advancedFilters}
        onAdvancedFiltersChange={setAdvancedFilters}
        availableResolutions={availableResolutions}
        availableModels={availableModels}
        onStartTour={handleStartTour}
      />

      <div className="relative flex flex-1 overflow-hidden">
        {/* GenerationView - 항상 마운트하고 CSS로만 표시 전환 */}
        <div
          className={`absolute inset-0 flex overflow-hidden${activePanel !== "generator" ? " opacity-0 pointer-events-none" : ""}`}
          inert={activePanel !== "generator" ? true : undefined}
        >
          <GenerationView
            ref={generationViewRef}
            outputFolder={outputFolder}
            onOutputFolderChange={setOutputFolder}
            isDarkTheme={isDarkTheme}
            tourActive={tourOpen && !initialLanguageScreenOpen}
          />
        </div>

        {generatorTransitioning && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* 갤러리 영역 - 항상 마운트하고 CSS로만 표시 전환 */}
        <div
          className={`absolute inset-0 flex overflow-hidden${activePanel === "generator" ? " opacity-0 pointer-events-none" : ""}`}
          inert={activePanel === "generator" ? true : undefined}
        >
          <div
            className="relative flex-none h-full"
            style={{ width: sidebarWidth }}
          >
            <Sidebar
              ref={sidebarRef}
              view={sidebarView}
              folderState={sidebarFolderState}
              folderActions={sidebarFolderActions}
              categoryState={sidebarCategoryState}
              categoryActions={sidebarCategoryActions}
              isAnalyzing={isAnalyzing}
            />
            <div
              className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 transition-colors z-10"
              onMouseDown={handleResizeStart}
            />
          </div>
          {activePanel === "settings" && (
            <SettingsView
              settings={settings}
              onUpdate={handleSettingsUpdate}
              onReset={handleSettingsReset}
              onClose={() => void handlePanelChange("gallery")}
              onResetHashes={async () => {
                try {
                  if (scanningRef.current) {
                    toast.error(t("error.scanInProgressForHashReset"));
                    return;
                  }
                  suspendAutoAnalysisRef.current = true;
                  pendingSimilarityRecalcRef.current = false;
                  if (analyzeTimerRef.current) {
                    clearTimeout(analyzeTimerRef.current);
                    analyzeTimerRef.current = null;
                  }
                  await window.image.resetHashes();
                  await runAnalysisNow();
                } catch (e: unknown) {
                  toast.error(
                    t("error.hashResetFailed", {
                      message: e instanceof Error ? e.message : String(e),
                    }),
                  );
                } finally {
                  suspendAutoAnalysisRef.current = false;
                }
              }}
              isAnalyzing={isAnalyzing}
            />
          )}
          {/* ImageGallery - 항상 마운트하고 설정 화면에서만 숨김 */}
          <div
            className={
              activePanel === "settings"
                ? "hidden"
                : "flex flex-1 overflow-hidden"
            }
          >
            <ImageGallery
              gallery={imageGalleryState}
              actions={imageGalleryActions}
              pagination={imageGalleryPagination}
            />
          </div>
        </div>
      </div>

      <CategoryDialog
        image={categoryDialogImage}
        images={bulkCategoryDialogImages}
        categories={categories}
        onClose={handleCategoryDialogClose}
      />

      <Dialog
        open={scanCancelConfirmOpen}
        onOpenChange={(open) => {
          if (!open) setScanCancelConfirmOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("app.dialog.scanCancel.title")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("app.dialog.scanCancel.description")}
          </p>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">
                {t("app.dialog.scanCancel.continue")}
              </Button>
            </DialogClose>
            <Button variant="destructive" onClick={confirmCancelScan}>
              {t("app.dialog.scanCancel.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteConfirmId}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("app.dialog.imageDelete.title")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("app.dialog.imageDelete.description")}
          </p>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{t("common.cancel")}</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImageDetail
        image={selectedImage}
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        onToggleFavorite={handleToggleFavorite}
        onCopyPrompt={handleCopyPrompt}
        onAddTagToSearch={handleAddTagToSearch}
        onAddTagToGenerator={handleAddTagToGenerator}
        prevImage={selectedIndex > 0 ? images[selectedIndex - 1] : null}
        nextImage={
          selectedIndex < images.length - 1 ? images[selectedIndex + 1] : null
        }
        onPrev={handlePrev}
        onNext={handleNext}
        similarImages={similarImages}
        similarReasons={similarReasons}
        similarImagesLoading={similarImagesLoading}
        detailContentReady={detailContentReady}
        onSimilarImageClick={setSelectedImage}
        similarPageSize={settings.similarPageSize}
      />

      <FeatureTour
        open={tourOpen && !initialLanguageScreenOpen}
        onClose={handleTourClose}
        onPanelChange={setActivePanel}
        onAction={handleTourAction}
      />

      <InitialLanguageScreen
        open={initialLanguageScreenOpen}
        language={settings.language}
        onLanguageChange={(language) => handleSettingsUpdate({ language })}
        onContinue={handleInitialLanguageContinue}
      />
    </div>
  );
}
