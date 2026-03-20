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
        src: expect.stringContaining("konomi://local/"),
      },
    ]);
    expect(result.current.totalImageCount).toBe(1);
    expect(result.current.galleryTotalPages).toBe(1);
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

    await waitFor(() => expect(preloadMocks.image.listPage).toHaveBeenCalledTimes(1));
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
  });
});
