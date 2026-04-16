import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { useGalleryController } from "@/hooks/useGalleryController";
import { preloadMocks } from "../helpers/preload-mocks";


function installControlledAnimationFrames() {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();

  const requestAnimationFrameSpy = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((callback: FrameRequestCallback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    });
  const cancelAnimationFrameSpy = vi
    .spyOn(window, "cancelAnimationFrame")
    .mockImplementation((id: number) => {
      callbacks.delete(id);
    });

  const flushAllFrames = () => {
    while (callbacks.size > 0) {
      const pending = [...callbacks.entries()].sort((a, b) => a[0] - b[0]);
      callbacks.clear();
      for (const [, callback] of pending) {
        callback(0);
      }
    }
  };

  return {
    requestAnimationFrameSpy,
    cancelAnimationFrameSpy,
    flushAllFrames,
  };
}

describe("useGalleryController", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
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

    const selectedFolderIds = new Set([2, 1]);
    const queryFragment = {
      onlyRecent: true,
      customCategoryId: 7,
      builtinCategory: null,
      randomSeed: 41,
    } as const;
    const resolutionFilters = [{ width: 832, height: 1216 }];
    const modelFilters = ["nai-diffusion-4-5-full"];

    const { result } = renderHook(() =>
      useGalleryController({
        pageSize: 20,
        recentDays: 14,
        selectedFolderIds,
        queryFragment,
        resolutionFilters,
        modelFilters,
        seedFilters: [],
        excludeTags: [],
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
    preloadMocks.image.listMatchingIds.mockResolvedValue([33]);

    const selectedFolderIds = new Set([4]);
    const queryFragment = {
      onlyRecent: false,
      customCategoryId: null,
      builtinCategory: "random",
      randomSeed: 99,
    } as const;
    const resolutionFilters: Array<{ width: number; height: number }> = [];
    const modelFilters: string[] = [];

    const { result } = renderHook(() =>
      useGalleryController({
        pageSize: 20,
        recentDays: 30,
        selectedFolderIds,
        queryFragment,
        resolutionFilters,
        modelFilters,
        seedFilters: [],
        excludeTags: [],
        folderCount: 0,
      }),
    );

    await waitFor(() =>
      expect(result.current.imageGalleryState.hasFolders).toBe(false),
    );

    await expect(
      result.current.galleryCommands.onLoadAllSelectableIds(),
    ).resolves.toEqual([33]);

    expect(preloadMocks.image.listMatchingIds).toHaveBeenCalledWith(
      expect.objectContaining({
        pageSize: 20,
        folderIds: [4],
        builtinCategory: "random",
        randomSeed: 99,
      }),
    );
  });

  it("queues blocking page/search actions and keeps only the latest pending search", async () => {
    const {
      requestAnimationFrameSpy,
      cancelAnimationFrameSpy,
      flushAllFrames,
    } = installControlledAnimationFrames();

    preloadMocks.image.listPage.mockImplementation(
      async ({ page = 1, pageSize = 20, searchQuery = "" }) => ({
        rows: [],
        totalCount: 0,
        page,
        pageSize,
        totalPages: 3,
        searchQuery,
      }),
    );

    const selectedFolderIds = new Set([1]);
    const queryFragment = {
      onlyRecent: false,
      customCategoryId: null,
      builtinCategory: null,
      randomSeed: 1,
    } as const;
    const resolutionFilters: Array<{ width: number; height: number }> = [];
    const modelFilters: string[] = [];
    const seedFilters: string[] = [];
    const excludeTags: string[] = [];

    const { result } = renderHook(() =>
      useGalleryController({
        pageSize: 20,
        recentDays: 14,
        selectedFolderIds,
        queryFragment,
        resolutionFilters,
        modelFilters,
        seedFilters,
        excludeTags,
        folderCount: 1,
      }),
    );

    await waitFor(() =>
      expect(preloadMocks.image.listPage).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1 }),
      ),
    );

    act(() => {
      result.current.imageGalleryPagination.onPageChange(2);
    });

    expect(result.current.imageGalleryState.isRefreshing).toBe(true);

    act(() => {
      flushAllFrames();
    });

    await waitFor(() =>
      expect(preloadMocks.image.listPage).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2 }),
      ),
    );
    await waitFor(() =>
      expect(result.current.imageGalleryPagination.page).toBe(2),
    );
    await waitFor(() =>
      expect(result.current.imageGalleryState.isRefreshing).toBe(false),
    );

    act(() => {
      result.current.handleSearchChange("first");
      result.current.handleSearchChange("second");
    });

    expect(result.current.imageGalleryState.isRefreshing).toBe(true);
    expect(cancelAnimationFrameSpy).toHaveBeenCalled();

    act(() => {
      flushAllFrames();
    });

    await waitFor(() => expect(result.current.searchQuery).toBe("second"));
    await waitFor(() =>
      expect(preloadMocks.image.listPage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 1,
          searchQuery: "second",
        }),
      ),
    );

    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
  });

  it("surfaces full-selection load failures", async () => {
    preloadMocks.image.listPage.mockResolvedValue({
      rows: [],
      totalCount: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    preloadMocks.image.listMatchingIds.mockRejectedValueOnce(
      new Error("index unavailable"),
    );

    const selectedFolderIds = new Set([1]);
    const queryFragment = {
      onlyRecent: false,
      customCategoryId: null,
      builtinCategory: null,
      randomSeed: 1,
    } as const;
    const resolutionFilters: Array<{ width: number; height: number }> = [];
    const modelFilters: string[] = [];

    const { result } = renderHook(() =>
      useGalleryController({
        pageSize: 20,
        recentDays: 14,
        selectedFolderIds,
        queryFragment,
        resolutionFilters,
        modelFilters,
        seedFilters: [],
        excludeTags: [],
        folderCount: 1,
      }),
    );

    await waitFor(() => expect(preloadMocks.image.listPage).toHaveBeenCalled());

    await expect(
      result.current.galleryCommands.onLoadAllSelectableIds(),
    ).rejects.toThrow("index unavailable");
    expect(toast.error).toHaveBeenCalledWith(
      "Failed to load image list: index unavailable",
    );
  });
});
