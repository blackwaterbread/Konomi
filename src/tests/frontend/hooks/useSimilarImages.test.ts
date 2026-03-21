import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SimilarGroup } from "@preload/index.d";
import { useSimilarImages } from "@/hooks/useSimilarImages";
import { preloadMocks } from "../helpers/preload-mocks";
import { createImageRow } from "../helpers/image-row";

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
});
