import { useEffect, useRef, useState } from "react";
import type { SimilarGroup, SimilarityReason } from "@preload/index.d";
import type { ImageData } from "@/components/image-card";
import { rowToImageData } from "@/lib/image-utils";

export function useSimilarImages({
  selectedImageId,
  isDetailOpen,
  detailContentReady,
  similarGroups,
  visualThresholdRef,
  promptThresholdRef,
}: {
  selectedImageId: string | null;
  isDetailOpen: boolean;
  detailContentReady: boolean;
  similarGroups: SimilarGroup[];
  visualThresholdRef: React.MutableRefObject<number>;
  promptThresholdRef: React.MutableRefObject<number | undefined>;
}) {
  const [similarImages, setSimilarImages] = useState<ImageData[]>([]);
  const [similarReasons, setSimilarReasons] = useState<
    Record<string, SimilarityReason>
  >({});
  const [similarImagesLoading, setSimilarImagesLoading] = useState(false);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestSeqRef.current;
    setSimilarImages([]);
    setSimilarReasons({});

    if (!selectedImageId || !isDetailOpen || !detailContentReady) {
      setSimilarImagesLoading(false);
      return;
    }

    const imageId = parseInt(selectedImageId, 10);
    const group = similarGroups.find((entry) => entry.imageIds.includes(imageId));
    if (!group || group.imageIds.length === 0) {
      setSimilarImagesLoading(false);
      return;
    }

    let cancelled = false;
    setSimilarImagesLoading(true);
    const candidateIds = group.imageIds.filter((id) => id !== imageId);

    Promise.all([
      window.image.listByIds(group.imageIds),
      window.image.similarReasons(
        imageId,
        candidateIds,
        visualThresholdRef.current,
        promptThresholdRef.current,
      ),
    ])
      .then(([rows, reasons]) => {
        if (cancelled || requestId !== requestSeqRef.current) return;
        const scoreMap = new Map(
          reasons.map((item) => [item.imageId, item.score]),
        );
        const imageDataList = rows.map(rowToImageData);
        imageDataList.sort(
          (a, b) =>
            (scoreMap.get(parseInt(b.id, 10)) ?? 0) -
            (scoreMap.get(parseInt(a.id, 10)) ?? 0),
        );
        setSimilarImages(imageDataList);
        setSimilarReasons(
          Object.fromEntries(
            reasons.map((item) => [String(item.imageId), item.reason]),
          ),
        );
        setSimilarImagesLoading(false);
      })
      .catch(() => {
        if (cancelled || requestId !== requestSeqRef.current) return;
        setSimilarImages([]);
        setSimilarReasons({});
        setSimilarImagesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    detailContentReady,
    isDetailOpen,
    promptThresholdRef,
    selectedImageId,
    similarGroups,
    visualThresholdRef,
  ]);

  return {
    similarImages,
    similarReasons,
    similarImagesLoading,
  };
}
