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
  const [similarScores, setSimilarScores] = useState<Record<string, number>>(
    {},
  );
  const [similarImagesLoading, setSimilarImagesLoading] = useState(false);
  const requestSeqRef = useRef(0);
  // Lock the anchor image ID when the panel first opens; reset on close.
  const [anchorId, setAnchorId] = useState<string | null>(null);
  // Track the anchor for which we last successfully initiated a fetch,
  // so we skip re-fetching when detailContentReady cycles for the same anchor.
  const fetchedAnchorRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isDetailOpen) {
      setAnchorId(null);
      fetchedAnchorRef.current = null;
      return;
    }
    if (selectedImageId) {
      setAnchorId((prev) => prev ?? selectedImageId);
    }
  }, [isDetailOpen, selectedImageId]);

  useEffect(() => {
    if (!anchorId || !isDetailOpen) {
      setSimilarImages([]);
      setSimilarReasons({});
      setSimilarScores({});
      setSimilarImagesLoading(false);
      return;
    }

    if (!detailContentReady) {
      setSimilarImagesLoading(false);
      return;
    }

    // Already fetched for this anchor — skip to avoid flickering on navigation.
    if (fetchedAnchorRef.current === anchorId) return;
    fetchedAnchorRef.current = anchorId;

    const requestId = ++requestSeqRef.current;
    setSimilarImages([]);
    setSimilarReasons({});
    setSimilarScores({});

    const imageId = parseInt(anchorId, 10);
    const group = similarGroups.find((entry) =>
      entry.imageIds.includes(imageId),
    );
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
        setSimilarScores(
          Object.fromEntries(
            reasons.map((item) => [String(item.imageId), item.score]),
          ),
        );
        setSimilarImagesLoading(false);
      })
      .catch(() => {
        if (cancelled || requestId !== requestSeqRef.current) return;
        setSimilarImages([]);
        setSimilarReasons({});
        setSimilarScores({});
        setSimilarImagesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    anchorId,
    detailContentReady,
    isDetailOpen,
    promptThresholdRef,
    similarGroups,
    visualThresholdRef,
  ]);

  return {
    similarImages,
    similarReasons,
    similarScores,
    similarImagesLoading,
  };
}
