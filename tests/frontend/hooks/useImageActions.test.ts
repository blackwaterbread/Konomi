import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageData } from "@/components/image-card";
import { useImageActions } from "@/hooks/useImageActions";
import { preloadMocks } from "../helpers/preload-mocks";

function createImage(
  id: string,
  overrides: Partial<ImageData> = {},
): ImageData {
  return {
    id,
    path: `C:\\gallery\\${id}.png`,
    src: `konomi://local/C%3A%2Fgallery%2F${id}.png?w=400`,
    fullSrc: `konomi://local/C%3A%2Fgallery%2F${id}.png`,
    prompt: `prompt ${id}`,
    negativePrompt: "",
    characterPrompts: [],
    tokens: [{ text: `prompt ${id}`, weight: 1 }],
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
    ...overrides,
  };
}

function renderImageActions(options?: {
  sortBy?: "recent" | "oldest" | "favorites" | "name";
  selectedBuiltinCategory?: "favorites" | "random" | null;
}) {
  const schedulePageRefresh = vi.fn();
  const handlePanelChange = vi.fn();
  const generationViewRef = {
    current: {
      importImage: vi.fn(),
      showSourceImage: vi.fn(),
      appendPromptTag: vi.fn(),
      openRightPanelTab: vi.fn(),
      generate: vi.fn(),
    },
  };

  const { result } = renderHook(() => {
    const [images, setImages] = useState([
      createImage("11"),
      createImage("12"),
    ]);
    const hook = useImageActions({
      images,
      setImages,
      sortBy: options?.sortBy ?? "recent",
      selectedBuiltinCategory: options?.selectedBuiltinCategory ?? null,
      schedulePageRefresh,
      markSelfRemoved: vi.fn(),
      releaseSelfRemoved: vi.fn(),
      generationViewRef,
      handlePanelChange,
      page: 1,
      totalPages: 1,
      onPageChange: vi.fn(),
    });

    return {
      ...hook,
      images,
    };
  });

  return {
    result,
    schedulePageRefresh,
    handlePanelChange,
    generationViewRef,
  };
}

describe("useImageActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps detail selection in sync while toggling favorites", async () => {
    const { result, schedulePageRefresh } = renderImageActions({
      sortBy: "favorites",
    });

    act(() => {
      result.current.imageActions.onImageClick(result.current.images[0]);
    });
    expect(result.current.detail.isOpen).toBe(true);
    expect(result.current.detail.image?.id).toBe("11");
    expect(result.current.detail.nextImage?.id).toBe("12");

    act(() => {
      result.current.imageActions.onToggleFavorite("11");
    });

    expect(result.current.detail.image?.isFavorite).toBe(true);
    expect(preloadMocks.image.setFavorite).toHaveBeenCalledWith(11, true);
    await waitFor(() => expect(schedulePageRefresh).toHaveBeenCalledWith(0));

    act(() => {
      result.current.detail.onNext();
    });
    expect(result.current.detail.image?.id).toBe("12");
  });

  it("manages category/delete dialogs and generator handoff", async () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
    const {
      result,
      schedulePageRefresh,
      handlePanelChange,
      generationViewRef,
    } = renderImageActions();

    act(() => {
      result.current.imageActions.onImageClick(result.current.images[0]);
      result.current.imageActions.onChangeCategory(result.current.images[0]);
    });
    expect(result.current.categoryDialog.image?.id).toBe("11");

    act(() => {
      result.current.categoryDialog.onClose();
    });
    expect(schedulePageRefresh).toHaveBeenCalledWith(0);

    schedulePageRefresh.mockClear();

    act(() => {
      result.current.imageActions.onDelete("11");
    });
    expect(result.current.deleteDialog.open).toBe(true);

    act(() => {
      result.current.deleteDialog.onConfirm();
    });
    expect(preloadMocks.image.delete).toHaveBeenCalledWith(
      "C:\\gallery\\11.png",
    );
    expect(result.current.deleteDialog.open).toBe(false);
    expect(result.current.detail.isOpen).toBe(false);
    expect(schedulePageRefresh).toHaveBeenCalledWith(1500);

    act(() => {
      result.current.imageActions.onSendToGenerator(result.current.images[1]);
    });
    expect(generationViewRef.current.importImage).toHaveBeenCalledWith(
      result.current.images[1],
    );
    expect(handlePanelChange).toHaveBeenCalledWith("generator");

    requestAnimationFrameSpy.mockRestore();
  });
});
