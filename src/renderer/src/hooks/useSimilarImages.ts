import { useCallback, useEffect, useRef, useState } from "react";
import type { SimilarityReason } from "@preload/index.d";
import type { ImageData } from "@/components/image-card";
import { rowToImageData } from "@/lib/image-utils";

export function useSimilarImages({
  anchorId,
  isDetailOpen,
  detailContentReady,
  getVisualThreshold,
  getPromptThreshold,
  pageSize = 10,
}: {
  anchorId: string | null;
  isDetailOpen: boolean;
  detailContentReady: boolean;
  getVisualThreshold: () => number;
  getPromptThreshold: () => number | undefined;
  pageSize?: number;
}) {
  // Sorted candidate IDs (excluding anchor) — lightweight, kept in full
  const [sortedCandidateIds, setSortedCandidateIds] = useState<number[]>([]);
  // Only the current page's ImageData — fetched on demand
  const [similarImages, setSimilarImages] = useState<ImageData[]>([]);
  const [similarReasons, setSimilarReasons] = useState<
    Record<string, SimilarityReason>
  >({});
  const [similarScores, setSimilarScores] = useState<Record<string, number>>(
    {},
  );
  const [similarImagesLoading, setSimilarImagesLoading] = useState(false);
  const [similarPage, setSimilarPage] = useState(0);

  const requestSeqRef = useRef(0);
  const fetchedAnchorRef = useRef<string | null>(null);
  // Cache of anchor ImageData so we don't refetch it on every page change
  const anchorImageRef = useRef<ImageData | null>(null);
  const sortedIdsRef = useRef<number[]>([]);

  // Reset fetched tracking when panel closes
  useEffect(() => {
    if (!isDetailOpen) {
      fetchedAnchorRef.current = null;
    }
  }, [isDetailOpen]);

  // Phase 1: When anchor changes, fetch reasons (lightweight) and build sorted ID list
  useEffect(() => {
    if (!anchorId || !isDetailOpen) {
      setSortedCandidateIds([]);
      setSimilarImages([]);
      setSimilarReasons({});
      setSimilarScores({});
      setSimilarImagesLoading(false);
      setSimilarPage(0);
      anchorImageRef.current = null;
      sortedIdsRef.current = [];
      return;
    }

    if (!detailContentReady) {
      setSimilarImagesLoading(false);
      return;
    }

    if (fetchedAnchorRef.current === anchorId) return;
    fetchedAnchorRef.current = anchorId;

    const requestId = ++requestSeqRef.current;
    setSimilarImages([]);
    setSimilarReasons({});
    setSimilarScores({});
    setSimilarPage(0);
    anchorImageRef.current = null;

    const imageId = parseInt(anchorId, 10);

    let cancelled = false;
    setSimilarImagesLoading(true);

    window.image
      .similarGroupForImage(imageId)
      .then((group) => {
        if (cancelled || requestId !== requestSeqRef.current) return;
        if (!group || group.imageIds.length === 0) {
          setSortedCandidateIds([]);
          sortedIdsRef.current = [];
          setSimilarImagesLoading(false);
          return;
        }
        const candidateIds = group.imageIds.filter((id) => id !== imageId);
        return window.image
          .similarReasons(
            imageId,
            candidateIds,
            getVisualThreshold(),
            getPromptThreshold(),
          )
          .then((reasons) => {
            if (cancelled || requestId !== requestSeqRef.current) return;

            const scoreMap = new Map(
              reasons.map((item) => [item.imageId, item.score]),
            );
            const reasonMap = Object.fromEntries(
              reasons.map((item) => [String(item.imageId), item.reason]),
            );
            const scoresObj = Object.fromEntries(
              reasons.map((item) => [String(item.imageId), item.score]),
            );

            // Sort candidates by score descending
            const sorted = [...candidateIds].sort(
              (a, b) => (scoreMap.get(b) ?? 0) - (scoreMap.get(a) ?? 0),
            );

            setSimilarReasons(reasonMap);
            setSimilarScores(scoresObj);
            setSortedCandidateIds(sorted);
            sortedIdsRef.current = sorted;
          });
      })
      .catch(() => {
        if (cancelled || requestId !== requestSeqRef.current) return;
        setSortedCandidateIds([]);
        sortedIdsRef.current = [];
        setSimilarReasons({});
        setSimilarScores({});
        setSimilarImagesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [anchorId, detailContentReady, isDetailOpen, getPromptThreshold, getVisualThreshold]);

  // Phase 2: Fetch ImageData for the current page only
  useEffect(() => {
    if (!anchorId || sortedIdsRef.current.length === 0) return;

    const imageId = parseInt(anchorId, 10);
    const sorted = sortedIdsRef.current;

    // Page 0 shows anchor + (pageSize-1) candidates; subsequent pages show pageSize candidates
    const candidateStart =
      similarPage === 0 ? 0 : similarPage * pageSize - 1;
    const candidateEnd =
      similarPage === 0 ? pageSize - 1 : (similarPage + 1) * pageSize - 1;
    const pageIds = sorted.slice(candidateStart, candidateEnd);

    // Include anchor ID if page 0 and not yet cached
    const idsToFetch =
      similarPage === 0 && !anchorImageRef.current
        ? [imageId, ...pageIds]
        : pageIds;

    if (idsToFetch.length === 0) {
      // Only anchor on this page
      setSimilarImages(anchorImageRef.current ? [anchorImageRef.current] : []);
      setSimilarImagesLoading(false);
      return;
    }

    let cancelled = false;
    setSimilarImagesLoading(true);

    window.image
      .listByIds(idsToFetch)
      .then((rows) => {
        if (cancelled) return;
        const dataMap = new Map(
          rows.map((r) => [String(r.id), rowToImageData(r)]),
        );

        // Cache anchor
        if (!anchorImageRef.current) {
          anchorImageRef.current = dataMap.get(anchorId) ?? null;
        }

        // Build page result: anchor first (page 0 only), then candidates in score order
        const result: ImageData[] = [];
        if (similarPage === 0 && anchorImageRef.current) {
          result.push(anchorImageRef.current);
        }
        for (const id of pageIds) {
          const img = dataMap.get(String(id));
          if (img) result.push(img);
        }

        setSimilarImages(result);
        setSimilarImagesLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSimilarImages([]);
        setSimilarImagesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [anchorId, sortedCandidateIds, similarPage, pageSize]);

  const totalPages =
    sortedCandidateIds.length > 0
      ? Math.ceil((sortedCandidateIds.length + 1) / pageSize)
      : 0;

  const goToPage = useCallback((page: number) => {
    setSimilarPage(page);
  }, []);

  return {
    similarImages,
    similarReasons,
    similarScores,
    similarImagesLoading,
    similarPage,
    similarTotalPages: totalPages,
    goToSimilarPage: goToPage,
  };
}
