import {
  useState,
  useEffect,
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
import { PromptSearchView } from "@/components/prompt-search-view";
import { CategoryDialog } from "@/components/category-dialog";
import {
  GenerationView,
  type GenerationViewHandle,
} from "@/components/generation-view";
import { FeatureTour } from "@/components/feature-tour";
import { InitialLanguageScreen } from "@/components/initial-language-screen";
import { AnnouncementModal } from "@/components/announcement-modal";
import { DebugView } from "@/components/debug-view";
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
import {
  useImageEventSubscriptions,
  runAppInitialization,
} from "@/hooks/useImageWatchBootstrap";
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
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useKeybindings } from "@/hooks/useKeybindings";
import { useGalleryFocus } from "@/hooks/useGalleryFocus";
import type { AdvancedFilter } from "@/lib/advanced-filter";
import type { Folder } from "@preload/index.d";
import { useTranslation } from "react-i18next";

interface AppProps {
  initialFolderCount?: number | null;
  initialFolders?: Folder[] | null;
}

export default function App({
  initialFolderCount = null,
  initialFolders = null,
}: AppProps) {
  const { settings, updateSettings, resetSettings } = useSettings();
  const { t } = useTranslation();
  const { outputFolder, setOutputFolder } = useNaiGenSettings();
  const [devMode, setDevMode] = useState(false);
  useEffect(() => {
    void window.appInfo.isDevMode().then(setDevMode);
  }, []);
  const {
    folders,
    selectedFolderIds,
    effectiveFolderIds,
    isFolderPartial,
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
    isRootVisible,
    toggleSubfolder,
    toggleRoot,
    seedSubfolders,
    refreshSubfolders,
    subfolderFilters,
    galleryReady,
    initialize: initializeFolders,
  } = useFolderController(initialFolderCount, initialFolders);
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilter[]>([]);
  const [initialRefreshDone, setInitialRefreshDone] = useState(false);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [announcementDeferred, setAnnouncementDeferred] = useState(false);
  const [announcementKey, setAnnouncementKey] = useState(0);
  const generationViewRef = useRef<GenerationViewHandle | null>(null);
  const sidebarRef = useRef<SidebarHandle | null>(null);
  const { isDarkTheme } = useAppAppearance({
    theme: settings.theme,
    language: settings.language,
  });
  const {
    availableResolutions,
    availableModels,
    loadSearchPresetStats,
    scheduleSearchStatsRefresh,
  } = useSearchPresetStats();
  const {
    categories,
    queryFragment,
    sidebarView,
    sidebarCategoryState,
    categoryCommands,
    browseNavigation,
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
    selectedFolderIds: effectiveFolderIds,
    queryFragment,
    resolutionFilters,
    modelFilters,
    seedFilters,
    excludeTags,
    folderCount,
    subfolderFilters,
    enabled: galleryReady,
  });

  const {
    scanning,
    activeScanFolderIds,
    setActiveScanFolderIds,
    setRollbackFolderIds,
    scanCancelConfirmOpen,
    setScanCancelConfirmOpen,
    folderRollbackRequest,
    scanningRef,
    scanStartCountRef,
    runScan,
    handleCancelScan,
    confirmCancelScan,
  } = useScanning({ schedulePageRefresh, loadSearchPresetStats });

  const {
    isAnalyzing,
    analyzeTimerRef,
    pendingSimilarityRecalcRef,
    getVisualThreshold,
    getPromptThreshold,
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
    analyzeTimerRef,
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
  const { bindings, updateBinding, resetBinding, resetAllBindings } =
    useKeybindings();

  const {
    imageActions,
    generatorTransitioning,
    categoryDialog,
    deleteDialog,
    bulkDeleteDialog,
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
  const [detailAnchorId, setDetailAnchorId] = useState<string | null>(null);
  const handleDetailAnchorChange = useCallback(
    (id: string | null) => setDetailAnchorId(id),
    [],
  );
  const deferredDetailContentImageId = useDeferredValue(
    detail.isOpen ? detail.imageId : null,
  );
  const detailContentReady =
    !!detail.imageId && deferredDetailContentImageId === detail.imageId;
  const {
    similarImages,
    similarReasons,
    similarScores,
    similarImagesLoading,
    similarPage,
    similarTotalPages,
    goToSimilarPage,
  } = useSimilarImages({
    anchorId: detailAnchorId,
    isDetailOpen: detail.isOpen,
    detailContentReady,
    getVisualThreshold,
    getPromptThreshold,
    pageSize: settings.similarPageSize,
  });
  const rescanningRef = useRef(false);

  useEffect(() => {
    const offProgress = window.image.onRescanMetadataProgress((data) => {
      rescanningRef.current = data.total > 0 && data.done < data.total;
    });
    const offReset = window.appInfo.onUtilityReset(() => {
      rescanningRef.current = false;
    });
    return () => {
      offProgress();
      offReset();
    };
  }, []);

  // Event subscriptions — pure IPC listeners, no initialization logic
  useImageEventSubscriptions({
    scheduleSearchStatsRefresh,
    scanningRef,
    scanStartCountRef,
    rescanningRef,
    scheduleAnalysis,
    schedulePageRefresh,
  });

  // Single mount orchestrator — explicit sequential initialization
  // Replaces the old cascade: useEffect(hasLoaded) → useEffect(mount) → quickVerify → scan
  useEffect(() => {
    let handle: { cancel: () => void } | null = null;

    void (async () => {
      // Step 1: Initialize subfolder state (was useEffect chain in useFolderController)
      await initializeFolders();

      // Step 2: Run quickVerify → conditional scan → deferred integrity check
      // Uses bootstrap-provided quickVerify result instead of running it again
      handle = runAppInitialization({
        loadSearchPresetStats,
        scanningRef,
        scheduleAnalysis,
        runScan,
        onInitialRefreshDone: () => setInitialRefreshDone(true),
      });
    })();

    return () => handle?.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once orchestrator
  }, []);

  const { galleryFocusState, galleryFocusActions } = useGalleryFocus(
    images.length,
  );

  const openFocusedImage = useCallback(() => {
    if (galleryFocusState.focusIndex === null) return;
    const image = images[galleryFocusState.focusIndex];
    if (image) detail.onSelectImage(image);
  }, [galleryFocusState.focusIndex, images, detail]);

  const galleryFocusForShortcuts = useMemo(
    () => ({
      ...galleryFocusActions,
      imageCount: images.length,
      openFocusedImage,
    }),
    [galleryFocusActions, images.length, openFocusedImage],
  );

  // 디테일 닫힐 때 포커스 복원
  const prevDetailOpenRef = useRef(detail.isOpen);
  useEffect(() => {
    if (prevDetailOpenRef.current && !detail.isOpen && detail.image) {
      const idx = images.findIndex((img) => img.id === detail.image!.id);
      if (idx >= 0) galleryFocusActions.setFocusIndex(idx);
    }
    prevDetailOpenRef.current = detail.isOpen;
  }, [detail.isOpen, detail.image, images, galleryFocusActions]);

  useKeyboardShortcuts({
    bindings,
    handlePanelChange,
    activePanel,
    onGenerate: () => generationViewRef.current?.generate(),
    browseNavigation,
    detail,
    imageActions,
    galleryFocus: galleryFocusForShortcuts,
    imageGalleryPagination,
    anyDialogOpen:
      scanCancelConfirmOpen ||
      deleteDialog.open ||
      bulkDeleteDialog.open ||
      !!categoryDialog.image ||
      (categoryDialog.bulkImageIds?.length ?? 0) > 0,
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
      isRootVisible,
      isFolderPartial,
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
      isRootVisible,
      isFolderPartial,
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
      onRootToggle: toggleRoot,
      seedSubfolders,
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
      seedSubfolders,
      toggleCollapse,
      toggleFolder,
      toggleSubfolder,
      toggleRoot,
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
      onCategorySetColor: (id: number, color: string | null) => {
        void categoryCommands.setCategoryColor(id, color);
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
        checkingDuplicates={checkingDuplicates}
        isAnalyzing={isAnalyzing}
        onCancelScan={handleCancelScan}
        advancedFilters={advancedFilters}
        onAdvancedFiltersChange={setAdvancedFilters}
        availableResolutions={availableResolutions}
        availableModels={availableModels}
        onStartTour={handleStartTour}
        devMode={devMode}
        announcementDeferred={announcementDeferred}
        onAnnouncementReopen={() => {
          setAnnouncementDeferred(false);
          setAnnouncementKey((k) => k + 1);
        }}
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
              onCheckingDuplicatesChange={setCheckingDuplicates}
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
              onRescanMetadata={async () => {
                const count = await window.image.rescanMetadata();
                schedulePageRefresh(0);
                void loadSearchPresetStats();
                return count;
              }}
              isAnalyzing={isAnalyzing}
              scanning={scanning}
              bindings={bindings}
              onUpdateBinding={updateBinding}
              onResetBinding={resetBinding}
              onResetAllBindings={resetAllBindings}
            />
          )}
          {activePanel === "tagSearch" && (
            <PromptSearchView
              onClose={() => void handlePanelChange("gallery")}
            />
          )}
          {activePanel === "debug" && devMode && (
            <DebugView
              onClose={() => void handlePanelChange("gallery")}
              onRunAnalysis={runAnalysisNow}
              scanning={scanning}
              isAnalyzing={isAnalyzing}
              settings={settings}
              onUpdateSettings={updateSettings}
            />
          )}
          {/* ImageGallery - 항상 마운트하고 설정/태그검색/디버그 화면에서만 숨김 */}
          <div
            className={
              activePanel === "settings" || activePanel === "tagSearch" || activePanel === "debug"
                ? "hidden"
                : "flex flex-1 overflow-hidden"
            }
          >
            <ImageGallery
              gallery={imageGalleryState}
              actions={imageGalleryActions}
              pagination={imageGalleryPagination}
              scanning={scanning}
              syncing={!initialRefreshDone}
              enableVirtualization={settings.enableVirtualization}
              focusIndex={galleryFocusState.focusIndex}
              onColumnCountChange={galleryFocusActions.setColumnCount}
              galleryColumns={settings.galleryColumns}
              onGalleryColumnsChange={(v) =>
                updateSettings({ galleryColumns: v })
              }
            />
          </div>
        </div>
      </div>

      <CategoryDialog
        image={categoryDialog.image}
        bulkImageIds={categoryDialog.bulkImageIds}
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

      <Dialog
        open={bulkDeleteDialog.open}
        onOpenChange={bulkDeleteDialog.onOpenChange}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("app.dialog.bulkDelete.title")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("app.dialog.bulkDelete.description", {
              count: bulkDeleteDialog.count,
            })}
          </p>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{t("common.cancel")}</Button>
            </DialogClose>
            <Button variant="destructive" onClick={bulkDeleteDialog.onConfirm}>
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
        similarPage={similarPage}
        similarTotalPages={similarTotalPages}
        onSimilarPageChange={goToSimilarPage}
        onAnchorChange={handleDetailAnchorChange}
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

      <AnnouncementModal
        key={announcementKey}
        disabled={initialLanguageScreenOpen || showFeatureTour}
        onAction={async (actionId) => {
          if (actionId === "rescanMetadata") {
            await window.image.rescanMetadata();
            schedulePageRefresh(0);
            void loadSearchPresetStats();
          } else if (actionId === "resetHashes") {
            await handleResetHashes();
          }
        }}
        onDefer={() => setAnnouncementDeferred(true)}
      />
    </div>
  );
}
