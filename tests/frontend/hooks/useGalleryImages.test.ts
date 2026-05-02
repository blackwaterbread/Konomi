import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useGalleryImages } from "@/hooks/useGalleryImages";
import { createImageRow } from "../helpers/image-row";
import { preloadMocks } from "../helpers/preload-mocks";

describe("useGalleryImages", () => {
  it("loads a page of images and maps rows into gallery data", async () => {
    const query = {
      pageSize: 20,
      folderIds: [1],
      sortBy: "recent" as const,
    };

    preloadMocks.image.listPage.mockResolvedValue({
      rows: [
        createImageRow({
          id: 11,
          path: "C:\\gallery\\sunset.png",
          prompt: "sunset beach",
          promptTokens: JSON.stringify([{ text: "sunset beach", weight: 1 }]),
        }),
      ],
      totalCount: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });

    const { result } = renderHook(() => useGalleryImages(query));

    await waitFor(() => expect(result.current.images).toHaveLength(1));

    expect(preloadMocks.image.listPage).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      folderIds: [1],
      sortBy: "recent",
    });
    expect(result.current.images).toMatchObject([
      {
        id: "11",
        prompt: "sunset beach",
        src: expect.stringContaining("/api/files/image?path="),
      },
    ]);
    expect(result.current.totalImageCount).toBe(1);
    expect(result.current.galleryTotalPages).toBe(1);
  });

  it("only consumes pending new ids that show up in the loaded page", async () => {
    const query = {
      pageSize: 20,
      folderIds: [1],
    };

    // First load returns id=11 (visible). The pendingNewIds set should keep
    // id=22 (still off-screen) but drop id=11 (now on-screen).
    preloadMocks.image.listPage.mockResolvedValueOnce({
      rows: [createImageRow({ id: 11 })],
      totalCount: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });

    const { result } = renderHook(() => useGalleryImages(query));
    await waitFor(() => expect(result.current.hasLoadedOnce).toBe(true));

    act(() => {
      result.current.addPendingNewIds([11, 22]);
    });
    expect(result.current.pendingNewCount).toBe(2);

    preloadMocks.image.listPage.mockResolvedValueOnce({
      rows: [createImageRow({ id: 11 })],
      totalCount: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });

    await act(async () => {
      result.current.schedulePageRefresh(0);
      await new Promise((r) => setTimeout(r, 30));
    });

    await waitFor(() => expect(result.current.pendingNewCount).toBe(1));
  });

  it("suppresses self-marked removals from the pending banner count", async () => {
    const query = {
      pageSize: 20,
      folderIds: [1],
    };
    preloadMocks.image.listPage.mockResolvedValue({
      rows: [],
      totalCount: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });

    const { result } = renderHook(() => useGalleryImages(query));
    await waitFor(() => expect(result.current.hasLoadedOnce).toBe(true));

    act(() => {
      result.current.markSelfRemovedIds([100, 101]);
      // 100/101 are user-initiated; 200 is external. Banner should show 1.
      result.current.addPendingRemovedIds([100, 101, 200]);
    });

    expect(result.current.pendingRemovedCount).toBe(1);
  });

  it("applyPendingRefresh clears both pending sets", async () => {
    const query = {
      pageSize: 20,
      folderIds: [1],
    };
    preloadMocks.image.listPage.mockResolvedValue({
      rows: [],
      totalCount: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });

    const { result } = renderHook(() => useGalleryImages(query));
    await waitFor(() => expect(result.current.hasLoadedOnce).toBe(true));

    act(() => {
      result.current.addPendingNewIds([1, 2, 3]);
      result.current.addPendingRemovedIds([10, 11]);
    });
    expect(result.current.pendingNewCount).toBe(3);
    expect(result.current.pendingRemovedCount).toBe(2);

    act(() => {
      result.current.applyPendingRefresh();
    });
    expect(result.current.pendingNewCount).toBe(0);
    expect(result.current.pendingRemovedCount).toBe(0);
  });

  it("debounces scheduled page refreshes", async () => {
    const query = {
      pageSize: 20,
      folderIds: [1],
    };

    preloadMocks.image.listPage.mockResolvedValue({
      rows: [],
      totalCount: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });

    const { result } = renderHook(() => useGalleryImages(query));

    await waitFor(() =>
      expect(preloadMocks.image.listPage).toHaveBeenCalledTimes(1),
    );
    vi.useFakeTimers();
    preloadMocks.image.listPage.mockClear();

    act(() => {
      result.current.schedulePageRefresh(200);
      result.current.schedulePageRefresh(200);
    });

    expect(preloadMocks.image.listPage).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(199);
    });
    expect(preloadMocks.image.listPage).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(preloadMocks.image.listPage).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("cancels a pending scheduled refresh when listBaseQuery changes", async () => {
    preloadMocks.image.listPage.mockResolvedValue({
      rows: [],
      totalCount: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });

    const initialQuery = { pageSize: 20, folderIds: [1] };
    const { result, rerender } = renderHook(
      ({ query }: { query: typeof initialQuery }) => useGalleryImages(query),
      { initialProps: { query: initialQuery } },
    );

    await waitFor(() =>
      expect(preloadMocks.image.listPage).toHaveBeenCalledTimes(1),
    );

    vi.useFakeTimers();
    preloadMocks.image.listPage.mockClear();

    // Schedule a refresh that hasn't fired yet.
    act(() => {
      result.current.schedulePageRefresh(500);
    });
    expect(preloadMocks.image.listPage).not.toHaveBeenCalled();

    // listBaseQuery changes mid-wait — the load useEffect will fetch with the
    // new query, so the timer should be cancelled to avoid a redundant call.
    rerender({ query: { pageSize: 20, folderIds: [2] } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    // Exactly one fetch (driven by listBaseQuery change), not two.
    expect(preloadMocks.image.listPage).toHaveBeenCalledTimes(1);
    expect(preloadMocks.image.listPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ folderIds: [2] }),
    );

    vi.useRealTimers();
  });

  it("applyPendingRefresh triggers exactly one listPage call", async () => {
    preloadMocks.image.listPage.mockResolvedValue({
      rows: [],
      totalCount: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });

    const query = { pageSize: 20, folderIds: [1] };
    const { result } = renderHook(() => useGalleryImages(query));

    await waitFor(() =>
      expect(preloadMocks.image.listPage).toHaveBeenCalledTimes(1),
    );
    preloadMocks.image.listPage.mockClear();

    await act(async () => {
      result.current.applyPendingRefresh();
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(preloadMocks.image.listPage).toHaveBeenCalledTimes(1);
  });
});
