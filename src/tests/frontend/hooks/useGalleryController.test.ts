import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGalleryController } from "@/hooks/useGalleryController";
import { preloadMocks } from "../helpers/preload-mocks";
import { createImageRow } from "../helpers/image-row";

describe("useGalleryController", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("builds gallery queries when sort and search change", async () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
    const cancelAnimationFrameSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {});

    preloadMocks.image.listPage.mockResolvedValue({
      rows: [],
      totalCount: 0,
      page: 1,
      pageSize: 20,
      totalPages: 8,
    });

    const { result } = renderHook(() =>
      useGalleryController({
        pageSize: 20,
        recentDays: 14,
        selectedFolderIds: new Set([2, 1]),
        queryFragment: {
          onlyRecent: true,
          customCategoryId: 7,
          builtinCategory: null,
          randomSeed: 41,
        },
        resolutionFilters: [{ width: 832, height: 1216 }],
        modelFilters: ["nai-diffusion-4-5-full"],
        folderCount: 2,
      }),
    );

    await waitFor(() =>
      expect(preloadMocks.image.listPage).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1,
          pageSize: 20,
          folderIds: [1, 2],
          searchQuery: "",
          onlyRecent: true,
          customCategoryId: 7,
          builtinCategory: null,
          randomSeed: 41,
        }),
      ),
    );

    await waitFor(() =>
      expect(preloadMocks.image.listPage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 1,
          pageSize: 20,
          folderIds: [1, 2],
          searchQuery: "",
          onlyRecent: true,
          customCategoryId: 7,
          builtinCategory: null,
          randomSeed: 41,
        }),
      ),
    );

    act(() => {
      result.current.galleryCommands.onSortChange("name");
    });

    await waitFor(() =>
      expect(preloadMocks.image.listPage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sortBy: "name",
        }),
      ),
    );

    act(() => {
      result.current.handleSearchChange("sunset beach");
    });

    await waitFor(() =>
      expect(result.current.searchQuery).toBe("sunset beach"),
    );
    await waitFor(() =>
      expect(preloadMocks.image.listPage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 1,
          searchQuery: "sunset beach",
        }),
      ),
    );
    expect(result.current.imageGalleryState.searchQuery).toBe("sunset beach");

    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
  });

  it("loads selectable images and derives gallery state for empty-folder onboarding", async () => {
    preloadMocks.image.listPage.mockResolvedValue({
      rows: [],
      totalCount: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    preloadMocks.image.listMatching.mockResolvedValue([
      createImageRow({
        id: 33,
        path: "C:\\gallery\\selected.png",
        prompt: "selected prompt",
        promptTokens: JSON.stringify([{ text: "selected prompt", weight: 1 }]),
      }),
    ]);

    const { result } = renderHook(() =>
      useGalleryController({
        pageSize: 20,
        recentDays: 30,
        selectedFolderIds: new Set([4]),
        queryFragment: {
          onlyRecent: false,
          customCategoryId: null,
          builtinCategory: "random",
          randomSeed: 99,
        },
        resolutionFilters: [],
        modelFilters: [],
        folderCount: 0,
      }),
    );

    await waitFor(() =>
      expect(result.current.imageGalleryState.hasFolders).toBe(false),
    );

    await expect(
      result.current.galleryCommands.onLoadAllSelectableImages(),
    ).resolves.toMatchObject([
      {
        id: "33",
        prompt: "selected prompt",
      },
    ]);

    expect(preloadMocks.image.listMatching).toHaveBeenCalledWith(
      expect.objectContaining({
        pageSize: 20,
        folderIds: [4],
        builtinCategory: "random",
        randomSeed: 99,
      }),
    );
  });
});
