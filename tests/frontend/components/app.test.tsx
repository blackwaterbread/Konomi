import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ImageData } from "@/components/image-card";
import { toast } from "sonner";
import { preloadMocks } from "../helpers/preload-mocks";
import { createImageRow } from "../helpers/image-row";

const useSettingsMock = vi.fn();
const useNaiGenSettingsMock = vi.fn();
const useGalleryImagesMock = vi.fn();
const useScanningMock = vi.fn();
const useImageAnalysisMock = vi.fn();

vi.mock("@/hooks/useSettings", () => ({
  useSettings: (...args: unknown[]) => useSettingsMock(...args),
}));

vi.mock("@/hooks/useNaiGenSettings", () => ({
  useNaiGenSettings: (...args: unknown[]) => useNaiGenSettingsMock(...args),
}));

vi.mock("@/hooks/useGalleryImages", () => ({
  useGalleryImages: (...args: unknown[]) => useGalleryImagesMock(...args),
}));

vi.mock("@/hooks/useScanning", () => ({
  useScanning: (...args: unknown[]) => useScanningMock(...args),
}));

vi.mock("@/hooks/useImageAnalysis", () => ({
  useImageAnalysis: (...args: unknown[]) => useImageAnalysisMock(...args),
}));

vi.mock("@/hooks/useImageWatchBootstrap", () => ({
  useImageEventSubscriptions: vi.fn(),
  runAppInitialization: vi.fn().mockReturnValue({ cancel: vi.fn() }),
}));

vi.mock("@/lib/i18n", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/i18n")>("@/lib/i18n");
  return {
    ...actual,
    applyAppLanguagePreference: vi.fn().mockResolvedValue("en"),
  };
});

vi.mock("@/components/header", () => ({
  Header: ({
    activePanel,
    onPanelChange,
    onCancelScan,
    onStartTour,
  }: {
    activePanel: string;
    onPanelChange: (panel: "gallery" | "generator" | "settings") => void;
    onCancelScan?: () => void;
    onStartTour: () => void;
  }) => (
    <div>
      <div data-testid="header-active-panel">{activePanel}</div>
      <button type="button" onClick={() => onPanelChange("gallery")}>
        Open Gallery
      </button>
      <button type="button" onClick={() => onPanelChange("generator")}>
        Open Generator
      </button>
      <button type="button" onClick={() => onPanelChange("settings")}>
        Open Settings
      </button>
      <button type="button" onClick={() => onCancelScan?.()}>
        Cancel Scan From Header
      </button>
      <button type="button" onClick={onStartTour}>
        Start Tour
      </button>
    </div>
  ),
}));

vi.mock("@/components/sidebar", () => ({
  Sidebar: React.forwardRef(function MockSidebar(
    {
      view,
    }: {
      view: { activeView: string };
    },
    ref: React.ForwardedRef<{ openFolderDialog: () => void }>,
  ) {
    const [openRequestCount, setOpenRequestCount] = React.useState(0);

    React.useImperativeHandle(
      ref,
      () => ({
        openFolderDialog: () => setOpenRequestCount((count) => count + 1),
      }),
      [],
    );

    return (
      <div data-testid="sidebar">
        <div data-testid="sidebar-active-view">{view.activeView}</div>
        <div data-testid="sidebar-folder-dialog-request">
          {String(openRequestCount)}
        </div>
      </div>
    );
  }),
}));

vi.mock("@/components/image-gallery", () => ({
  ImageGallery: ({
    actions,
    searchQuery,
    onSearchChange,
    advancedFilters,
    onAdvancedFiltersChange,
  }: {
    actions: {
      onSendToGenerator?: (image: ImageData) => void;
      onSendToSource?: (image: ImageData) => void;
      onAddTagToGenerator?: (tag: string) => void;
      onAddFolder?: () => void;
      onImageClick?: (image: ImageData) => void;
      onDelete?: (id: string) => void;
      onChangeCategory?: (image: ImageData) => void;
      onBulkChangeCategory?: (ids: number[]) => void;
    };
    searchQuery?: string;
    onSearchChange?: (q: string) => void;
    advancedFilters?: Array<{ type: string; [key: string]: unknown }>;
    onAdvancedFiltersChange?: (filters: Array<{ type: string; [key: string]: unknown }>) => void;
  }) => {
    const image: ImageData = {
      id: "11",
      path: "C:\\gallery\\sample.png",
      src: "konomi://local/C%3A%2Fgallery%2Fsample.png?w=400",
      fullSrc: "konomi://local/C%3A%2Fgallery%2Fsample.png",
      prompt: "sample prompt",
      negativePrompt: "",
      characterPrompts: [],
      tokens: [{ text: "sample prompt", weight: 1 }],
      negativeTokens: [],
      characterTokens: [],
      category: "",
      tags: [],
      fileModifiedAt: "2026-03-20T12:00:00.000Z",
      isFavorite: false,
      pHash: "0123456789abcdef",
      source: "nai",
      folderId: 1,
      model: "nai-diffusion-4-5-full",
      seed: "123",
      width: 832,
      height: 1216,
      cfgScale: 5,
      cfgRescale: 0,
      noiseSchedule: "native",
      varietyPlus: false,
      sampler: "k_euler_ancestral",
      steps: 28,
    };
    const secondImage: ImageData = {
      ...image,
      id: "12",
      path: "C:\\gallery\\sample-2.png",
      src: "konomi://local/C%3A%2Fgallery%2Fsample-2.png",
      prompt: "second prompt",
    };

    return (
      <div data-testid="image-gallery">
        <div data-testid="gallery-search-query">{searchQuery ?? ""}</div>
        <div data-testid="gallery-filter-count">
          {String((advancedFilters ?? []).length)}
        </div>
        <button type="button" onClick={() => onSearchChange?.("sunset beach")}>
          Gallery Search Sunset
        </button>
        <button type="button" onClick={() => onSearchChange?.("")}>
          Gallery Clear Search
        </button>
        <button
          type="button"
          onClick={() =>
            onAdvancedFiltersChange?.([
              { type: "resolution", width: 832, height: 1216 },
              { type: "model", value: "nai-diffusion-4-5-full" },
            ])
          }
        >
          Gallery Apply Filters
        </button>
        <button type="button" onClick={() => onAdvancedFiltersChange?.([])}>
          Gallery Clear Filters
        </button>
        <button
          type="button"
          onClick={() => actions.onSendToGenerator?.(image)}
        >
          Gallery Send To Generator
        </button>
        <button type="button" onClick={() => actions.onSendToSource?.(image)}>
          Gallery Send To Source
        </button>
        <button
          type="button"
          onClick={() => actions.onAddTagToGenerator?.("sparkles")}
        >
          Gallery Add Tag To Generator
        </button>
        <button type="button" onClick={() => actions.onAddFolder?.()}>
          Gallery Add Folder
        </button>
        <button type="button" onClick={() => actions.onImageClick?.(image)}>
          Gallery Open Detail
        </button>
        <button type="button" onClick={() => actions.onDelete?.(image.id)}>
          Gallery Delete Image
        </button>
        <button type="button" onClick={() => actions.onChangeCategory?.(image)}>
          Gallery Change Category
        </button>
        <button
          type="button"
          onClick={() => actions.onBulkChangeCategory?.([Number(image.id), Number(secondImage.id)])}
        >
          Gallery Bulk Change Category
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/generation-view", () => ({
  GenerationView: React.forwardRef(function MockGenerationView(
    {
      outputFolder,
    }: {
      outputFolder: string;
    },
    ref: React.ForwardedRef<{
      importImage: (image: ImageData) => void;
      showSourceImage: (image: ImageData) => void;
      appendPromptTag: (tag: string) => void;
      openRightPanelTab: (tab: "prompt-group" | "settings") => void;
    }>,
  ) {
    const [pendingImport, setPendingImport] = React.useState<ImageData | null>(
      null,
    );
    const [pendingSourceImport, setPendingSourceImport] =
      React.useState<ImageData | null>(null);
    const [appendPromptTag, setAppendPromptTag] = React.useState<string | null>(
      null,
    );

    React.useImperativeHandle(
      ref,
      () => ({
        importImage: (image) => setPendingImport(image),
        showSourceImage: (image) => setPendingSourceImport(image),
        appendPromptTag: (tag) => setAppendPromptTag(tag),
        openRightPanelTab: () => {},
      }),
      [],
    );

    return (
      <div data-testid="generation-view">
        <div data-testid="generation-output-folder">{outputFolder}</div>
        <div data-testid="generation-pending-import">
          {pendingImport?.id ?? "none"}
        </div>
        <div data-testid="generation-pending-source">
          {pendingSourceImport?.id ?? "none"}
        </div>
        <div data-testid="generation-append-tag">
          {appendPromptTag ?? "none"}
        </div>
        <button type="button" onClick={() => setPendingImport(null)}>
          Clear Pending Import
        </button>
        <button type="button" onClick={() => setPendingSourceImport(null)}>
          Clear Pending Source
        </button>
      </div>
    );
  }),
}));

vi.mock("@/components/settings-view", () => ({
  SettingsView: ({
    onClose,
    onResetHashes,
  }: {
    onClose: () => void;
    onResetHashes: () => Promise<void>;
  }) => (
    <div data-testid="settings-view">
      <button type="button" onClick={onClose}>
        Close Settings
      </button>
      <button type="button" onClick={() => void onResetHashes()}>
        Reset Hashes
      </button>
    </div>
  ),
}));

vi.mock("@/components/category-dialog", () => ({
  CategoryDialog: ({
    image,
    bulkImageIds,
    onClose,
  }: {
    image?: ImageData | null;
    bulkImageIds?: number[] | null;
    categories?: unknown[];
    onClose: () => void;
  }) =>
    image || (bulkImageIds?.length ?? 0) > 0 ? (
      <div data-testid="category-dialog">
        <div data-testid="category-dialog-single">{image?.id ?? "none"}</div>
        <div data-testid="category-dialog-bulk">
          {bulkImageIds?.join(",") ?? "none"}
        </div>
        <button type="button" onClick={onClose}>
          Close Category Dialog
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/image-detail", () => ({
  ImageDetail: ({
    image,
    isOpen,
    onClose,
    similarImages,
    similarImagesLoading,
    onSimilarImageClick,
    onAnchorChange,
  }: {
    image?: ImageData | null;
    isOpen: boolean;
    onClose: () => void;
    similarImages: ImageData[];
    similarImagesLoading: boolean;
    onSimilarImageClick: (image: ImageData) => void;
    onAnchorChange?: (anchorId: string | null) => void;
  }) => {
    React.useEffect(() => {
      if (isOpen && image?.id) {
        onAnchorChange?.(image.id);
      } else if (!isOpen) {
        onAnchorChange?.(null);
      }
    }, [isOpen, image?.id, onAnchorChange]);

    return isOpen && image ? (
      <div data-testid="image-detail">
        <div data-testid="image-detail-image-id">{image.id}</div>
        <div data-testid="image-detail-loading">
          {String(similarImagesLoading)}
        </div>
        <div data-testid="image-detail-similar-ids">
          {similarImages.map((entry) => entry.id).join(",") || "none"}
        </div>
        <button type="button" onClick={onClose}>
          Close Detail
        </button>
        {similarImages.length > 1 && (
          <button
            type="button"
            onClick={() => {
              const other = similarImages.find((img) => img.id !== image?.id);
              if (other) onSimilarImageClick(other);
            }}
          >
            Open First Similar
          </button>
        )}
      </div>
    ) : null;
  },
}));

vi.mock("@/components/feature-tour", () => ({
  FeatureTour: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <div data-testid="feature-tour">
        <button type="button" onClick={onClose}>
          Close Tour
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/initial-language-screen", () => ({
  InitialLanguageScreen: ({
    open,
    onContinue,
  }: {
    open: boolean;
    onContinue: () => void;
  }) =>
    open ? (
      <div data-testid="initial-language-screen">
        <button type="button" onClick={onContinue}>
          Continue Initial Language
        </button>
      </div>
    ) : null,
}));

import App from "@/App";

describe("App", () => {
  beforeEach(() => {
    localStorage.setItem("konomi-tour-completed", "true");
    localStorage.setItem("konomi-initial-language-selection-completed", "true");
    localStorage.setItem("konomi-announcement-v0.6.0-similarity-fix", "true");
    localStorage.setItem("konomi-announcement-v0.9.0-metadata-webp", "true");

    useSettingsMock.mockReset();
    useSettingsMock.mockReturnValue({
      settings: {
        recentDays: 14,
        pageSize: 20,
        similarityThreshold: 12,
        useAdvancedSimilarityThresholds: false,
        visualSimilarityThreshold: 12,
        promptSimilarityThreshold: 0.6,
        similarPageSize: 24,
        theme: "dark",
        language: "en",
      },
      updateSettings: vi.fn(),
      resetSettings: vi.fn(),
    });

    useNaiGenSettingsMock.mockReset();
    useNaiGenSettingsMock.mockReturnValue({
      outputFolder: "C:/output",
      setOutputFolder: vi.fn(),
    });

    useGalleryImagesMock.mockReset();
    useGalleryImagesMock.mockReturnValue({
      images: [],
      setImages: vi.fn(),
      totalImageCount: 0,
      galleryPage: 1,
      setGalleryPage: vi.fn(),
      galleryTotalPages: 1,
      hasLoadedOnce: true,
      isLoading: false,
      schedulePageRefresh: vi.fn(),
    });

    useScanningMock.mockReset();
    useScanningMock.mockReturnValue({
      scanning: false,
      setScanning: vi.fn(),
      activeScanFolderIds: new Set(),
      setActiveScanFolderIds: vi.fn(),
      setRollbackFolderIds: vi.fn(),
      scanProgress: null,
      scanCancelConfirmOpen: false,
      setScanCancelConfirmOpen: vi.fn(),
      scanningFolderNames: [],
      folderRollbackRequest: null,
      scanningRef: { current: false },
      runScan: vi.fn().mockResolvedValue(true),
      handleCancelScan: vi.fn(),
      confirmCancelScan: vi.fn(),
    });

    useImageAnalysisMock.mockReset();
    useImageAnalysisMock.mockReturnValue({
      isAnalyzing: false,
      hashProgress: null,
      similarityProgress: null,
      similarGroupCount: 0,
      analyzeTimerRef: { current: null },
      pendingSimilarityRecalcRef: { current: false },
      getVisualThreshold: () => 12,
      getPromptThreshold: () => 0.6,
      suspendAutoAnalysisRef: { current: false },
      runAnalysisNow: vi.fn().mockResolvedValue(undefined),
      scheduleAnalysis: vi.fn(),
    });
  });

  it("switches panels and reruns similarity analysis when leaving settings with pending work", async () => {
    const user = userEvent.setup();
    const runAnalysisNow = vi.fn().mockResolvedValue(undefined);
    const pendingSimilarityRecalcRef = { current: true };

    useImageAnalysisMock.mockReturnValue({
      isAnalyzing: false,
      hashProgress: null,
      similarityProgress: null,
      similarGroupCount: 0,
      analyzeTimerRef: { current: null },
      pendingSimilarityRecalcRef,
      getVisualThreshold: () => 12,
      getPromptThreshold: () => 0.6,
      suspendAutoAnalysisRef: { current: false },
      runAnalysisNow,
      scheduleAnalysis: vi.fn(),
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(screen.getByTestId("settings-view")).toBeInTheDocument();
    expect(screen.getByTestId("header-active-panel")).toHaveTextContent(
      "settings",
    );

    await user.click(screen.getByRole("button", { name: "Close Settings" }));

    await waitFor(() =>
      expect(screen.getByTestId("header-active-panel")).toHaveTextContent(
        "gallery",
      ),
    );
    expect(runAnalysisNow).toHaveBeenCalledTimes(1);
  });

  it("forwards gallery generator actions into GenerationView state", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(
      screen.getByRole("button", { name: "Gallery Send To Generator" }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("header-active-panel")).toHaveTextContent(
        "generator",
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("generation-pending-import")).toHaveTextContent(
        "11",
      ),
    );

    await user.click(
      screen.getByRole("button", { name: "Clear Pending Import" }),
    );
    expect(screen.getByTestId("generation-pending-import")).toHaveTextContent(
      "none",
    );

    await user.click(
      screen.getByRole("button", { name: "Gallery Send To Source" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("generation-pending-source")).toHaveTextContent(
        "11",
      ),
    );

    await user.click(
      screen.getByRole("button", { name: "Clear Pending Source" }),
    );
    expect(screen.getByTestId("generation-pending-source")).toHaveTextContent(
      "none",
    );
  });

  it("routes gallery tag additions and folder requests to the right children", async () => {
    const user = userEvent.setup();

    render(<App />);

    expect(
      screen.getByTestId("sidebar-folder-dialog-request"),
    ).toHaveTextContent("0");

    await user.click(
      screen.getByRole("button", { name: "Gallery Add Tag To Generator" }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("generation-append-tag")).toHaveTextContent(
        "sparkles",
      ),
    );
    expect(screen.getByTestId("header-active-panel")).toHaveTextContent(
      "generator",
    );

    await user.click(screen.getByRole("button", { name: "Open Gallery" }));
    await waitFor(() =>
      expect(screen.getByTestId("header-active-panel")).toHaveTextContent(
        "gallery",
      ),
    );

    await user.click(
      screen.getByRole("button", { name: "Gallery Add Folder" }),
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("sidebar-folder-dialog-request"),
      ).toHaveTextContent("1"),
    );
  });

  it("forwards category handoff to CategoryDialog and refreshes when the dialog closes", async () => {
    const user = userEvent.setup();
    const schedulePageRefresh = vi.fn();

    useGalleryImagesMock.mockReturnValue({
      images: [],
      setImages: vi.fn(),
      totalImageCount: 0,
      galleryPage: 1,
      setGalleryPage: vi.fn(),
      galleryTotalPages: 1,
      hasLoadedOnce: true,
      isLoading: false,
      schedulePageRefresh,
    });

    render(<App />);

    await user.click(
      screen.getByRole("button", { name: "Gallery Change Category" }),
    );

    expect(screen.getByTestId("category-dialog-single")).toHaveTextContent(
      "11",
    );
    expect(screen.getByTestId("category-dialog-bulk")).toHaveTextContent(
      "none",
    );

    await user.click(
      screen.getByRole("button", { name: "Close Category Dialog" }),
    );

    await waitFor(() =>
      expect(screen.queryByTestId("category-dialog")).not.toBeInTheDocument(),
    );
    expect(schedulePageRefresh).toHaveBeenCalledWith(0);

    schedulePageRefresh.mockClear();

    await user.click(
      screen.getByRole("button", { name: "Gallery Bulk Change Category" }),
    );

    expect(screen.getByTestId("category-dialog-single")).toHaveTextContent(
      "none",
    );
    expect(screen.getByTestId("category-dialog-bulk")).toHaveTextContent(
      "11,12",
    );

    await user.click(
      screen.getByRole("button", { name: "Close Category Dialog" }),
    );
    expect(schedulePageRefresh).toHaveBeenCalledWith(0);
  });

  it("confirms scan cancellation through the app dialog", async () => {
    const user = userEvent.setup();
    const confirmCancelScan = vi.fn();

    useScanningMock.mockReturnValue({
      scanning: true,
      setScanning: vi.fn(),
      activeScanFolderIds: new Set([1]),
      setActiveScanFolderIds: vi.fn(),
      setRollbackFolderIds: vi.fn(),
      scanProgress: { done: 2, total: 10 },
      scanCancelConfirmOpen: true,
      setScanCancelConfirmOpen: vi.fn(),
      scanningFolderNames: ["Folder 1"],
      folderRollbackRequest: null,
      scanningRef: { current: true },
      runScan: vi.fn().mockResolvedValue(true),
      handleCancelScan: vi.fn(),
      confirmCancelScan,
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Cancel Scan" }));

    expect(confirmCancelScan).toHaveBeenCalledTimes(1);
  });

  it("confirms image deletion through the app dialog and refreshes the page", async () => {
    const user = userEvent.setup();
    const schedulePageRefresh = vi.fn();

    useGalleryImagesMock.mockReturnValue({
      images: [
        {
          id: "11",
          path: "C:\\gallery\\sample.png",
          src: "konomi://local/C%3A%2Fgallery%2Fsample.png",
          prompt: "sample prompt",
          negativePrompt: "",
          characterPrompts: [],
          tokens: [{ text: "sample prompt", weight: 1 }],
          negativeTokens: [],
          characterTokens: [],
          category: "",
          tags: [],
          fileModifiedAt: "2026-03-20T12:00:00.000Z",
          isFavorite: false,
          pHash: "0123456789abcdef",
          source: "nai",
          folderId: 1,
          model: "nai-diffusion-4-5-full",
          seed: "123",
          width: 832,
          height: 1216,
          cfgScale: 5,
          cfgRescale: 0,
          noiseSchedule: "native",
          varietyPlus: false,
          sampler: "k_euler_ancestral",
          steps: 28,
        },
      ],
      setImages: vi.fn(),
      totalImageCount: 1,
      galleryPage: 1,
      setGalleryPage: vi.fn(),
      galleryTotalPages: 1,
      hasLoadedOnce: true,
      isLoading: false,
      schedulePageRefresh,
      markSelfRemovedIds: vi.fn(),
      releaseSelfRemovedIds: vi.fn(),
    });

    render(<App />);

    await user.click(
      screen.getByRole("button", { name: "Gallery Delete Image" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(preloadMocks.image.delete).toHaveBeenCalledWith(
      "C:\\gallery\\sample.png",
    );
    expect(schedulePageRefresh).toHaveBeenCalledWith(1500);
  });

  it("loads similar images for the detail view and lets the app switch selection", async () => {
    const user = userEvent.setup();

    useGalleryImagesMock.mockReturnValue({
      images: [
        {
          id: "11",
          path: "C:\\gallery\\sample.png",
          src: "konomi://local/C%3A%2Fgallery%2Fsample.png",
          prompt: "sample prompt",
          negativePrompt: "",
          characterPrompts: [],
          tokens: [{ text: "sample prompt", weight: 1 }],
          negativeTokens: [],
          characterTokens: [],
          category: "",
          tags: [],
          fileModifiedAt: "2026-03-20T12:00:00.000Z",
          isFavorite: false,
          pHash: "0123456789abcdef",
          source: "nai",
          folderId: 1,
          model: "nai-diffusion-4-5-full",
          seed: "123",
          width: 832,
          height: 1216,
          cfgScale: 5,
          cfgRescale: 0,
          noiseSchedule: "native",
          varietyPlus: false,
          sampler: "k_euler_ancestral",
          steps: 28,
        },
        {
          id: "12",
          path: "C:\\gallery\\sample-2.png",
          src: "konomi://local/C%3A%2Fgallery%2Fsample-2.png",
          prompt: "second prompt",
          negativePrompt: "",
          characterPrompts: [],
          tokens: [{ text: "second prompt", weight: 1 }],
          negativeTokens: [],
          characterTokens: [],
          category: "",
          tags: [],
          fileModifiedAt: "2026-03-20T12:00:00.000Z",
          isFavorite: false,
          pHash: "fedcba9876543210",
          source: "nai",
          folderId: 1,
          model: "nai-diffusion-4-5-full",
          seed: "456",
          width: 832,
          height: 1216,
          cfgScale: 5,
          cfgRescale: 0,
          noiseSchedule: "native",
          varietyPlus: false,
          sampler: "k_euler_ancestral",
          steps: 28,
        },
      ],
      setImages: vi.fn(),
      totalImageCount: 2,
      galleryPage: 1,
      setGalleryPage: vi.fn(),
      galleryTotalPages: 1,
      hasLoadedOnce: true,
      isLoading: false,
      schedulePageRefresh: vi.fn(),
    });
    useImageAnalysisMock.mockReturnValue({
      isAnalyzing: false,
      hashProgress: null,
      similarityProgress: null,
      similarGroupCount: 1,
      analyzeTimerRef: { current: null },
      pendingSimilarityRecalcRef: { current: false },
      getVisualThreshold: () => 12,
      getPromptThreshold: () => 0.6,
      suspendAutoAnalysisRef: { current: false },
      runAnalysisNow: vi.fn().mockResolvedValue(undefined),
      scheduleAnalysis: vi.fn(),
    });
    preloadMocks.image.similarGroupForImage.mockResolvedValue({
      id: "group-1",
      name: "Similar Group",
      imageIds: [11, 12],
    });
    preloadMocks.image.listByIds.mockResolvedValue([
      createImageRow({
        id: 11,
        path: "C:\\gallery\\sample.png",
        prompt: "sample prompt",
        promptTokens: JSON.stringify([{ text: "sample prompt", weight: 1 }]),
        source: "nai",
        model: "nai-diffusion-4-5-full",
      }),
      createImageRow({
        id: 12,
        path: "C:\\gallery\\sample-2.png",
        prompt: "second prompt",
        promptTokens: JSON.stringify([{ text: "second prompt", weight: 1 }]),
        source: "nai",
        model: "nai-diffusion-4-5-full",
      }),
    ]);
    preloadMocks.image.similarReasons.mockResolvedValue([
      { imageId: 12, reason: "both", score: 0.9 },
    ]);

    render(<App />);

    await user.click(
      screen.getByRole("button", { name: "Gallery Open Detail" }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("image-detail-image-id")).toHaveTextContent(
        "11",
      ),
    );
    // Page 0: anchor first, then candidates sorted by score desc
    await waitFor(() =>
      expect(screen.getByTestId("image-detail-similar-ids")).toHaveTextContent(
        "11,12",
      ),
    );
    expect(preloadMocks.image.similarReasons).toHaveBeenCalledWith(
      11,
      [12],
      12,
      0.6,
    );

    await user.click(
      screen.getByRole("button", { name: "Open First Similar" }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("image-detail-image-id")).toHaveTextContent(
        "12",
      ),
    );
  });

  it("wires header search and advanced filters into the gallery query state", async () => {
    const user = userEvent.setup();
    const setGalleryPage = vi.fn();

    useGalleryImagesMock.mockReturnValue({
      images: [],
      setImages: vi.fn(),
      totalImageCount: 0,
      galleryPage: 5,
      setGalleryPage,
      galleryTotalPages: 8,
      hasLoadedOnce: true,
      isLoading: false,
      schedulePageRefresh: vi.fn(),
    });

    render(<App />);

    expect(screen.getByTestId("gallery-search-query")).toHaveTextContent("");
    expect(screen.getByTestId("gallery-filter-count")).toHaveTextContent("0");

    await user.click(screen.getByRole("button", { name: "Gallery Search Sunset" }));

    await waitFor(() =>
      expect(screen.getByTestId("gallery-search-query")).toHaveTextContent(
        "sunset beach",
      ),
    );
    expect(setGalleryPage).toHaveBeenCalledWith(1);
    expect(useGalleryImagesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        searchQuery: "sunset beach",
      }),
      expect.anything(),
    );

    await user.click(
      screen.getByRole("button", { name: "Gallery Apply Filters" }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("gallery-filter-count")).toHaveTextContent("2"),
    );
    expect(useGalleryImagesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        resolutionFilters: [{ width: 832, height: 1216 }],
        modelFilters: ["nai-diffusion-4-5-full"],
      }),
      expect.anything(),
    );

    await user.click(
      screen.getByRole("button", { name: "Gallery Clear Search" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Gallery Clear Filters" }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("gallery-search-query")).toHaveTextContent(""),
    );
    await waitFor(() =>
      expect(screen.getByTestId("gallery-filter-count")).toHaveTextContent("0"),
    );
  });

  it("runs hash reset from settings when scanning is idle", async () => {
    const user = userEvent.setup();
    const runAnalysisNow = vi.fn().mockResolvedValue(undefined);

    useImageAnalysisMock.mockReturnValue({
      isAnalyzing: false,
      hashProgress: null,
      similarityProgress: null,
      similarGroupCount: 0,
      analyzeTimerRef: { current: null },
      pendingSimilarityRecalcRef: { current: false },
      getVisualThreshold: () => 12,
      getPromptThreshold: () => 0.6,
      suspendAutoAnalysisRef: { current: false },
      runAnalysisNow,
      scheduleAnalysis: vi.fn(),
    });
    useScanningMock.mockReturnValue({
      scanning: false,
      setScanning: vi.fn(),
      activeScanFolderIds: new Set(),
      setActiveScanFolderIds: vi.fn(),
      setRollbackFolderIds: vi.fn(),
      scanProgress: null,
      scanCancelConfirmOpen: false,
      setScanCancelConfirmOpen: vi.fn(),
      scanningFolderNames: [],
      folderRollbackRequest: null,
      scanningRef: { current: false },
      runScan: vi.fn().mockResolvedValue(true),
      handleCancelScan: vi.fn(),
      confirmCancelScan: vi.fn(),
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open Settings" }));
    await user.click(screen.getByRole("button", { name: "Reset Hashes" }));

    await waitFor(() =>
      expect(preloadMocks.image.resetHashes).toHaveBeenCalledTimes(1),
    );
    expect(runAnalysisNow).toHaveBeenCalledTimes(1);
  });

  it("blocks hash reset from settings while a scan is active", async () => {
    const user = userEvent.setup();
    const runAnalysisNow = vi.fn().mockResolvedValue(undefined);

    useImageAnalysisMock.mockReturnValue({
      isAnalyzing: false,
      hashProgress: null,
      similarityProgress: null,
      similarGroupCount: 0,
      analyzeTimerRef: { current: null },
      pendingSimilarityRecalcRef: { current: false },
      getVisualThreshold: () => 12,
      getPromptThreshold: () => 0.6,
      suspendAutoAnalysisRef: { current: false },
      runAnalysisNow,
      scheduleAnalysis: vi.fn(),
    });
    useScanningMock.mockReturnValue({
      scanning: true,
      setScanning: vi.fn(),
      activeScanFolderIds: new Set([1]),
      setActiveScanFolderIds: vi.fn(),
      setRollbackFolderIds: vi.fn(),
      scanProgress: { done: 1, total: 10 },
      scanCancelConfirmOpen: false,
      setScanCancelConfirmOpen: vi.fn(),
      scanningFolderNames: ["Folder 1"],
      folderRollbackRequest: null,
      scanningRef: { current: true },
      runScan: vi.fn().mockResolvedValue(true),
      handleCancelScan: vi.fn(),
      confirmCancelScan: vi.fn(),
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "Open Settings" }));
    await user.click(screen.getByRole("button", { name: "Reset Hashes" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "A scan is already running. Please wait until it completes before recalculating hashes.",
      ),
    );
    expect(preloadMocks.image.resetHashes).not.toHaveBeenCalled();
    expect(runAnalysisNow).not.toHaveBeenCalled();
  });

  it("forwards header cancel-scan requests into the scanning hook", async () => {
    const user = userEvent.setup();
    const handleCancelScan = vi.fn();

    useScanningMock.mockReturnValue({
      scanning: true,
      setScanning: vi.fn(),
      activeScanFolderIds: new Set([1]),
      setActiveScanFolderIds: vi.fn(),
      setRollbackFolderIds: vi.fn(),
      scanProgress: { done: 3, total: 12 },
      scanCancelConfirmOpen: false,
      setScanCancelConfirmOpen: vi.fn(),
      scanningFolderNames: ["Folder 1"],
      folderRollbackRequest: null,
      scanningRef: { current: true },
      runScan: vi.fn().mockResolvedValue(true),
      handleCancelScan,
      confirmCancelScan: vi.fn(),
    });

    render(<App />);

    await user.click(
      screen.getByRole("button", { name: "Cancel Scan From Header" }),
    );

    expect(handleCancelScan).toHaveBeenCalledTimes(1);
  });

  it("gates the feature tour behind the initial language screen on first run", async () => {
    const user = userEvent.setup();

    localStorage.removeItem("konomi-tour-completed");
    localStorage.removeItem("konomi-initial-language-selection-completed");

    render(<App />);

    expect(screen.getByTestId("initial-language-screen")).toBeInTheDocument();
    expect(screen.queryByTestId("feature-tour")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Continue Initial Language" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByTestId("initial-language-screen"),
      ).not.toBeInTheDocument(),
    );
    expect(
      localStorage.getItem("konomi-initial-language-selection-completed"),
    ).toBe("true");
    expect(screen.getByTestId("feature-tour")).toBeInTheDocument();
  });

  it("starts and closes the feature tour from the header", async () => {
    const user = userEvent.setup();

    localStorage.setItem("konomi-tour-completed", "true");
    localStorage.setItem("konomi-initial-language-selection-completed", "true");

    render(<App />);

    expect(screen.queryByTestId("feature-tour")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start Tour" }));

    expect(screen.getByTestId("feature-tour")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close Tour" }));

    await waitFor(() =>
      expect(screen.queryByTestId("feature-tour")).not.toBeInTheDocument(),
    );
    expect(localStorage.getItem("konomi-tour-completed")).toBe("true");
    expect(screen.getByTestId("header-active-panel")).toHaveTextContent(
      "gallery",
    );
  });
});
