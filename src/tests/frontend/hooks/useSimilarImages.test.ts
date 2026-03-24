import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SimilarGroup } from "@preload/index.d";
import { useSimilarImages } from "@/hooks/useSimilarImages";
import { preloadMocks } from "../helpers/preload-mocks";
import { createImageRow } from "../helpers/image-row";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe("useSimilarImages", () => {
  it("loads similar images, sorts by score, and maps reasons by image id", async () => {
    const similarGroups: SimilarGroup[] = [
      { id: "group-1", name: "Group", imageIds: [10, 11, 12] },
    ];
    const visualThresholdRef = { current: 12 };
    const promptThresholdRef = { current: 0.6 };

    preloadMocks.image.listByIds.mockResolvedValue([
      createImageRow({ id: 10, path: "C:\\images\\selected.png" }),
      createImageRow({ id: 11, path: "C:\\images\\second.png" }),
      createImageRow({ id: 12, path: "C:\\images\\top.png" }),
    ]);
    preloadMocks.image.similarReasons.mockResolvedValue([
      { imageId: 11, reason: "prompt", score: 0.4 },
      { imageId: 12, reason: "visual", score: 0.9 },
    ]);

    const { result, rerender } = renderHook(
      (props: {
        selectedImageId: string | null;
        isDetailOpen: boolean;
        detailContentReady: boolean;
      }) =>
        useSimilarImages({
          ...props,
          similarGroups,
          visualThresholdRef,
          promptThresholdRef,
        }),
      {
        initialProps: {
          selectedImageId: "10",
          isDetailOpen: true,
          detailContentReady: true,
        },
      },
    );

    await waitFor(() =>
      expect(result.current.similarImages.map((image) => image.id)).toEqual([
        "12",
        "11",
        "10",
      ]),
    );
    expect(result.current.similarReasons).toEqual({
      "11": "prompt",
      "12": "visual",
    });
    expect(preloadMocks.image.similarReasons).toHaveBeenCalledWith(
      10,
      [11, 12],
      12,
      0.6,
    );

    rerender({
      selectedImageId: "10",
      isDetailOpen: false,
      detailContentReady: true,
    });

    expect(result.current.similarImages).toEqual([]);
    expect(result.current.similarReasons).toEqual({});
    expect(result.current.similarImagesLoading).toBe(false);
  });

  it("ignores stale results after the selected image changes", async () => {
    const similarGroups: SimilarGroup[] = [
      { id: "group-1", name: "Group 1", imageIds: [10, 11] },
      { id: "group-2", name: "Group 2", imageIds: [20, 21] },
    ];
    const visualThresholdRef = { current: 12 };
    const promptThresholdRef = { current: 0.6 };
    const firstRows = deferred<ReturnType<typeof createImageRow>[]>();
    const firstReasons = deferred<
      Array<{
        imageId: number;
        reason: "visual" | "prompt" | "both";
        score: number;
      }>
    >();
    const secondRows = deferred<ReturnType<typeof createImageRow>[]>();
    const secondReasons = deferred<
      Array<{
        imageId: number;
        reason: "visual" | "prompt" | "both";
        score: number;
      }>
    >();

    preloadMocks.image.listByIds.mockImplementation((ids: number[]) =>
      ids.includes(10) ? firstRows.promise : secondRows.promise,
    );
    preloadMocks.image.similarReasons.mockImplementation((imageId: number) =>
      imageId === 10 ? firstReasons.promise : secondReasons.promise,
    );

    const { result, rerender } = renderHook(
      (props: {
        selectedImageId: string | null;
        isDetailOpen: boolean;
        detailContentReady: boolean;
      }) =>
        useSimilarImages({
          ...props,
          similarGroups,
          visualThresholdRef,
          promptThresholdRef,
        }),
      {
        initialProps: {
          selectedImageId: "10",
          isDetailOpen: true,
          detailContentReady: true,
        },
      },
    );

    rerender({
      selectedImageId: "20",
      isDetailOpen: true,
      detailContentReady: true,
    });

    await act(async () => {
      secondRows.resolve([
        createImageRow({ id: 20, path: "C:\\images\\selected-20.png" }),
        createImageRow({ id: 21, path: "C:\\images\\second-21.png" }),
      ]);
      secondReasons.resolve([{ imageId: 21, reason: "both", score: 0.8 }]);
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(result.current.similarImages.map((image) => image.id)).toEqual([
        "21",
        "20",
      ]),
    );
    expect(result.current.similarReasons).toEqual({
      "21": "both",
    });

    await act(async () => {
      firstRows.resolve([
        createImageRow({ id: 10, path: "C:\\images\\selected-10.png" }),
        createImageRow({ id: 11, path: "C:\\images\\first-11.png" }),
      ]);
      firstReasons.resolve([{ imageId: 11, reason: "visual", score: 0.9 }]);
      await Promise.resolve();
    });

    expect(result.current.similarImages.map((image) => image.id)).toEqual([
      "21",
      "20",
    ]);
    expect(result.current.similarReasons).toEqual({
      "21": "both",
    });
  });

  it("clears state when loading similar images fails", async () => {
    const similarGroups: SimilarGroup[] = [
      { id: "group-1", name: "Group", imageIds: [10, 11] },
    ];
    const visualThresholdRef = { current: 12 };
    const promptThresholdRef = { current: 0.6 };

    preloadMocks.image.listByIds.mockRejectedValueOnce(new Error("db offline"));

    const { result } = renderHook(() =>
      useSimilarImages({
        selectedImageId: "10",
        isDetailOpen: true,
        detailContentReady: true,
        similarGroups,
        visualThresholdRef,
        promptThresholdRef,
      }),
    );

    await waitFor(() =>
      expect(result.current.similarImagesLoading).toBe(false),
    );
    expect(result.current.similarImages).toEqual([]);
    expect(result.current.similarReasons).toEqual({});
  });
});
