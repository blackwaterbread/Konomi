import {
  useState,
  useMemo,
  useCallback,
  useRef,
  useDeferredValue,
} from "react";
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
import { useSettings } from "@/hooks/useSettings";
import { useNaiGenSettings } from "@/hooks/useNaiGenSettings";
import { useAppAppearance } from "@/hooks/useAppAppearance";
import { useGalleryController } from "@/hooks/useGalleryController";
import { useImageWatchBootstrap } from "@/hooks/useImageWatchBootstrap";
import { useScanning } from "@/hooks/useScanning";
import { useImageAnalysis } from "@/hooks/useImageAnalysis";
import { useBrowseScope } from "@/hooks/useBrowseScope";
import { useFolderController } from "@/hooks/useFolderController";
import { useImageActions } from "@/hooks/useImageActions";
import { useSearchPresetStats } from "@/hooks/useSearchPresetStats";
import { useSidebarFolderActions } from "@/hooks/useSidebarFolderActions";
import { useSimilarImages } from "@/hooks/useSimilarImages";
import { useSettingsAnalysisController } from "@/hooks/useSettingsAnalysisController";
import { useAppShellState, type ActivePanel } from "@/hooks/useAppShellState";
import { useAutoUpdate } from "@/hooks/useAutoUpdate";
import type { AdvancedFilter } from "@/lib/advanced-filter";
import { useTranslation } from "react-i18next";

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
    addFolders,
    removeFolder,
    renameFolder,
    reorderFolders,
    folderCount,
    collapsedFolderIds,
    toggleCollapse,
    subfoldersByFolder,
    isSubfolderVisible,
    toggleSubfolder,
    refreshSubfolders,
    subfolderFilters,
  } = useFolderController(initialFolderCount);
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilter[]>([]);
  const generationViewRef = useRef<GenerationViewHandle | null>(null);
  const sidebarRef = useRef<SidebarHandle | null>(null);
  const { isDarkTheme } = useAppAppearance({
    theme: settings.theme,
    language: settings.language,
  });
  const {
    availableResolutions,
    availableModels,
    searchStatsProgress,
    loadSearchPresetStats,
    scheduleSearchStatsRefresh,
    handleSearchStatsProgress,
  } = useSearchPresetStats();
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
  const seedFilters = useMemo(
    () =>
      advancedFilters
        .filter(
          (f): f is Extract<AdvancedFilter, { type: "seed" }> =>
            f.type === "seed",
        )
        .map((f) => f.value),
    [advancedFilters],
  );
  const excludeTags = useMemo(
    () =>
      advancedFilters
        .filter(
          (f): f is Extract<AdvancedFilter, { type: "excludeTag" }> =>
            f.type === "excludeTag",
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
    seedFilters,
    excludeTags,
    folderCount,
    subfolderFilters,
  });

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
    setActiveScanFolderIds,
    setRollbackFolderIds,
    refreshSubfolders,
  });
  const { handleSettingsUpdate, handleSettingsReset, handleResetHashes } =
    useSettingsAnalysisController({
      updateSettings,
      resetSettings,
      scanningRef,
      analyzeTimerRef,
      pendingSimilarityRecalcRef,
      suspendAutoAnalysisRef,
      runAnalysisNow,
    });

  const {
    activePanel,
    setActivePanel,
    handlePanelChange,
    sidebarWidth,
    handleResizeStart,
    initialLanguageScreenOpen,
    showFeatureTour,
    handleStartTour,
    handleTourClose,
    handleInitialLanguageContinue,
  } = useAppShellState({
    scanningRef,
    analyzeTimerRef,
    pendingSimilarityRecalcRef,
    runAnalysisNow,
  });

  useAutoUpdate();

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
  const { similarImages, similarReasons, similarScores, similarImagesLoading } =
    useSimilarImages({
      selectedImageId: detail.imageId,
      isDetailOpen: detail.isOpen,
      detailContentReady,
      similarGroups,
      visualThresholdRef,
      promptThresholdRef,
    });
  useImageWatchBootstrap({
    loadSearchPresetStats,
    scheduleSearchStatsRefresh,
    handleSearchStatsProgress,
    scanningRef,
    scheduleAnalysis,
    schedulePageRefresh,
  });

  const handleTourAction = useCallback((action: string) => {
    if (action === "open-prompt-group-panel") {
      generationViewRef.current?.openRightPanelTab("prompt-group");
      return;
    }
    if (action === "open-settings-panel") {
      generationViewRef.current?.openRightPanelTab("settings");
      return;
    }
    if (action === "switch-to-token-mode") {
      const tourEl = document.querySelector('[data-tour="gen-prompt-input"]');
      const toggle = tourEl?.querySelector('[role="switch"]');
      if (toggle && toggle.getAttribute("aria-checked") === "false") {
        (toggle as HTMLElement).click();
      }
      return;
    }
    if (action === "open-token-chip-popover") {
      requestAnimationFrame(() => {
        const chip = document.querySelector('[data-token-chip="true"]');
        if (chip) {
          chip.dispatchEvent(
            new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
          );
        }
      });
    }
  }, []);

  const handleHeaderPanelChange = useCallback(
    (panel: ActivePanel) => {
      void handlePanelChange(panel);
    },
    [handlePanelChange],
  );

  const sidebarFolderState = useMemo(
    () => ({
      folders,
      selectedFolderIds,
      collapsedFolderIds,
      rollbackRequest: folderRollbackRequest,
      scanningFolderIds: activeScanFolderIds,
      scanning,
      subfoldersByFolder,
      isSubfolderVisible,
    }),
    [
      activeScanFolderIds,
      collapsedFolderIds,
      folders,
      folderRollbackRequest,
      scanning,
      selectedFolderIds,
      subfoldersByFolder,
      isSubfolderVisible,
    ],
  );

  const sidebarFolderActions = useMemo(
    () => ({
      createFolder: addFolder,
      addFolders,
      deleteFolder: removeFolder,
      renameFolder,
      reorderFolders,
      onFolderToggle: toggleFolder,
      onFolderToggleCollapse: toggleCollapse,
      onFolderRemoved: handleFolderRemoved,
      onFolderAdded: handleFolderAdded,
      onFolderCancelled: handleFolderCancelled,
      onFolderRescan: handleFolderRescan,
      onSubfolderToggle: toggleSubfolder,
    }),
    [
      addFolder,
      addFolders,
      handleFolderAdded,
      handleFolderCancelled,
      handleFolderRemoved,
      handleFolderRescan,
      removeFolder,
      renameFolder,
      reorderFolders,
      toggleCollapse,
      toggleFolder,
      toggleSubfolder,
    ],
  );
  const sidebarCategoryActions = useMemo(
    () => ({
      onCategorySelect: categoryCommands.selectCategory,
      onCategoryCreate: categoryCommands.createCategory,
      onCategoryRename: categoryCommands.renameCategory,
      onCategoryDelete: (id: number) => {
        void categoryCommands.deleteCategory(id).then((deleted) => {
          if (deleted) {
            schedulePageRefresh(0);
          }
        });
      },
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
            tourActive={showFeatureTour}
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
              onResetHashes={handleResetHashes}
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
        similarScores={similarScores}
        similarImagesLoading={similarImagesLoading}
        detailContentReady={detailContentReady}
        onSimilarImageClick={detail.onSelectImage}
        similarPageSize={settings.similarPageSize}
      />

      <FeatureTour
        open={showFeatureTour}
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
