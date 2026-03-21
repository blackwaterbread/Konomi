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
import { useGalleryController } from "@/hooks/useGalleryController";
import { useScanning } from "@/hooks/useScanning";
import { useImageAnalysis } from "@/hooks/useImageAnalysis";
import { useBrowseScope } from "@/hooks/useBrowseScope";
import { useFolderController } from "@/hooks/useFolderController";
import { useImageActions } from "@/hooks/useImageActions";
import { useSidebarFolderActions } from "@/hooks/useSidebarFolderActions";
import { useSimilarImages } from "@/hooks/useSimilarImages";
import type { AdvancedFilter } from "@/lib/advanced-filter";
import { createLogger } from "@/lib/logger";
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
  const {
    folders,
    selectedFolderIds,
    toggleFolder,
    addSelectedFolder,
    removeSelectedFolder,
    addFolder,
    removeFolder,
    renameFolder,
    reorderFolders,
    folderCount,
  } = useFolderController(initialFolderCount);
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

  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilter[]>([]);
  const [availableResolutions, setAvailableResolutions] = useState<
    Array<{ width: number; height: number }>
  >([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
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
  const generationViewRef = useRef<GenerationViewHandle | null>(null);
  const sidebarRef = useRef<SidebarHandle | null>(null);
  const {
    categories,
    queryFragment,
    sidebarView,
    sidebarCategoryState,
    categoryCommands,
  } = useBrowseScope();
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
  const {
    images,
    setImages,
    sortBy,
    searchQuery,
    handleSearchChange,
    schedulePageRefresh,
    imageGalleryState,
    imageGalleryPagination,
    galleryCommands,
  } = useGalleryController({
    pageSize: settings.pageSize,
    recentDays: settings.recentDays,
    selectedFolderIds,
    queryFragment,
    resolutionFilters,
    modelFilters,
    folderCount,
  });

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
    runScan,
    scanningRef,
    scheduleAnalysis,
    schedulePageRefresh,
    setActiveScanFolderIds,
    setRollbackFolderIds,
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

  const {
    imageActions,
    generatorTransitioning,
    categoryDialog,
    deleteDialog,
    detail,
  } = useImageActions({
    images,
    setImages,
    sortBy,
    selectedBuiltinCategory: queryFragment.builtinCategory,
    schedulePageRefresh,
    generationViewRef,
    handlePanelChange,
  });
  const deferredDetailContentImageId = useDeferredValue(
    detail.isOpen ? detail.imageId : null,
  );
  const detailContentReady =
    !!detail.imageId && deferredDetailContentImageId === detail.imageId;
  const { similarImages, similarReasons, similarImagesLoading } =
    useSimilarImages({
      selectedImageId: detail.imageId,
      isDetailOpen: detail.isOpen,
      detailContentReady,
      similarGroups,
      visualThresholdRef,
      promptThresholdRef,
    });

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

  const handleTourAction = useCallback((action: string) => {
    if (action === "open-prompt-group-panel") {
      generationViewRef.current?.openRightPanelTab("prompt-group");
      return;
    }
    if (action === "open-settings-panel") {
      generationViewRef.current?.openRightPanelTab("settings");
    }
  }, []);

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

  const sidebarFolderState = useMemo(
    () => ({
      folders,
      selectedFolderIds,
      rollbackRequest: folderRollbackRequest,
      scanningFolderIds: activeScanFolderIds,
      scanning,
    }),
    [
      activeScanFolderIds,
      folders,
      folderRollbackRequest,
      scanning,
      selectedFolderIds,
    ],
  );

  const sidebarFolderActions = useMemo(
    () => ({
      createFolder: addFolder,
      deleteFolder: removeFolder,
      renameFolder,
      reorderFolders,
      onFolderToggle: toggleFolder,
      onFolderRemoved: handleFolderRemoved,
      onFolderAdded: handleFolderAdded,
      onFolderCancelled: handleFolderCancelled,
      onFolderRescan: handleFolderRescan,
    }),
    [
      addFolder,
      handleFolderAdded,
      handleFolderCancelled,
      handleFolderRemoved,
      handleFolderRescan,
      removeFolder,
      renameFolder,
      reorderFolders,
      toggleFolder,
    ],
  );
  const sidebarCategoryActions = useMemo(
    () => ({
      onCategorySelect: categoryCommands.selectCategory,
      onCategoryCreate: categoryCommands.createCategory,
      onCategoryRename: categoryCommands.renameCategory,
      onCategoryDelete: categoryCommands.deleteCategory,
      onCategoryReorder: categoryCommands.reorderCategories,
      onCategoryAddByPrompt: (id: number, query: string) => {
        void categoryCommands
          .addCategoryByPrompt(id, query)
          .then((shouldRefreshPage) => {
            if (shouldRefreshPage) {
              schedulePageRefresh(0);
            }
          });
      },
      onRandomRefresh: categoryCommands.refreshRandomSelection,
    }),
    [categoryCommands, schedulePageRefresh],
  );

  const imageGalleryActions = useMemo(
    () => ({
      ...galleryCommands,
      ...imageActions,
      onAddFolder: () => sidebarRef.current?.openFolderDialog(),
    }),
    [galleryCommands, imageActions],
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
        image={categoryDialog.image}
        images={categoryDialog.images}
        categories={categories}
        onClose={categoryDialog.onClose}
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

      <Dialog open={deleteDialog.open} onOpenChange={deleteDialog.onOpenChange}>
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
            <Button variant="destructive" onClick={deleteDialog.onConfirm}>
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImageDetail
        image={detail.image}
        isOpen={detail.isOpen}
        onClose={detail.onClose}
        onToggleFavorite={imageActions.onToggleFavorite}
        onCopyPrompt={imageActions.onCopyPrompt}
        onAddTagToSearch={imageActions.onAddTagToSearch}
        onAddTagToGenerator={imageActions.onAddTagToGenerator}
        prevImage={detail.prevImage}
        nextImage={detail.nextImage}
        onPrev={detail.onPrev}
        onNext={detail.onNext}
        similarImages={similarImages}
        similarReasons={similarReasons}
        similarImagesLoading={similarImagesLoading}
        detailContentReady={detailContentReady}
        onSimilarImageClick={detail.onSelectImage}
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
