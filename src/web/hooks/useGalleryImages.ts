import {
  useState,
  useCallback,
  useEffect,
  useRef,
  startTransition,
} from "react";
import { toast } from "sonner";
import type { ImageData } from "@/components/image-card";
import type { ImageListQuery } from "@preload/index.d";
import i18n from "@/lib/i18n";
import { rowToImageData } from "@/lib/image-utils";

const EMPTY_IMAGES: ImageData[] = [];

export function useGalleryImages(
  listBaseQuery: Omit<ImageListQuery, "page">,
  options?: {
    enabled?: boolean;
    overlayActiveRef?: React.RefObject<boolean>;
    thumbWidth?: number;
  },
) {
  const enabled = options?.enabled ?? true;
  const thumbWidth = options?.thumbWidth;
  const [images, setImages] = useState<ImageData[]>([]);
  const [totalImageCount, setTotalImageCount] = useState(0);
  const [galleryPage, setGalleryPage] = useState(1);
  const [galleryTotalPages, setGalleryTotalPages] = useState(1);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingNewCount, setPendingNewCount] = useState(0);
  const [pendingRemovedCount, setPendingRemovedCount] = useState(0);

  const pageRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const enabledRef = useRef(enabled);
  const builtinCategoryRef = useRef(listBaseQuery.builtinCategory);
  const listRequestSeqRef = useRef(0);
  const loadImagesPageRef = useRef<() => Promise<void>>(async () => {});
  const expectedRemovedRef = useRef(0);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled && pageRefreshTimerRef.current) {
      clearTimeout(pageRefreshTimerRef.current);
      pageRefreshTimerRef.current = null;
    }
    if (!enabled) {
      setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    builtinCategoryRef.current = listBaseQuery.builtinCategory;
  }, [listBaseQuery.builtinCategory]);

  useEffect(() => {
    if (!enabled) return;
    setGalleryPage(1);
  }, [enabled, listBaseQuery]);

  const loadImagesPage = useCallback(async () => {
    if (!enabled) return;
    setPendingNewCount(0);
    setPendingRemovedCount(0);
    expectedRemovedRef.current = 0;
    const requestId = ++listRequestSeqRef.current;
    setIsLoading(true);
    // Eagerly unmount old cards so Blink can release decoded bitmaps
    // before new images arrive (batched with isLoading → single render).
    // Skip when overlay is active — old images stay hidden under the spinner
    // and will be replaced atomically when new data arrives.
    if (!options?.overlayActiveRef?.current) {
      setImages(EMPTY_IMAGES);
    }
    try {
      const result = await window.image.listPage({
        ...listBaseQuery,
        page: galleryPage,
      });
      if (requestId !== listRequestSeqRef.current) return;
      // isLoading and hasLoadedOnce are urgent — they gate the gallery overlay
      // spinner.  Keeping them inside startTransition lets scan-progress events
      // (frequent urgent updates) continuously defer the transition render,
      // which leaves isLoading=true indefinitely and causes an infinite spinner.
      setIsLoading(false);
      setHasLoadedOnce(true);
      startTransition(() => {
        setImages(result.rows.map((row) => rowToImageData(row, thumbWidth)));
        setTotalImageCount(result.totalCount);
        setGalleryTotalPages(result.totalPages);
      });
      if (galleryPage > result.totalPages) {
        setGalleryPage(result.totalPages);
      }
    } catch (e: unknown) {
      if (requestId !== listRequestSeqRef.current) return;
      toast.error(
        i18n.t("error.imageListLoadFailed", {
          message: e instanceof Error ? e.message : String(e),
        }),
      );
      setIsLoading(false);
      setHasLoadedOnce(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- overlayActiveRef is a stable ref
  }, [enabled, galleryPage, listBaseQuery, thumbWidth]);

  const incrementPendingNew = useCallback((count: number) => {
    if (!enabledRef.current) return;
    if (builtinCategoryRef.current === "random") return;
    setPendingNewCount((prev) => prev + count);
  }, []);

  const incrementPendingRemoved = useCallback((count: number) => {
    if (!enabledRef.current) return;
    if (builtinCategoryRef.current === "random") return;
    // Subtract self-initiated removals so the banner only counts external
    // deletes (another client, direct FS change) rather than the user's own.
    const consumed = Math.min(expectedRemovedRef.current, count);
    expectedRemovedRef.current -= consumed;
    const rest = count - consumed;
    if (rest <= 0) return;
    setPendingRemovedCount((prev) => prev + rest);
  }, []);

  const markSelfRemoved = useCallback((count: number) => {
    if (count > 0) expectedRemovedRef.current += count;
  }, []);

  // Releases over-marked self-removals when fewer image:removed events arrive
  // than the caller pre-marked (e.g. some unlinks failed, or the path wasn't
  // in the DB to begin with). Without this the counter leaks and silently
  // eats future external removal events.
  const releaseSelfRemoved = useCallback((count: number) => {
    if (count <= 0) return;
    expectedRemovedRef.current = Math.max(
      0,
      expectedRemovedRef.current - count,
    );
  }, []);

  const applyPendingRefresh = useCallback(() => {
    setPendingNewCount(0);
    setPendingRemovedCount(0);
    if (pageRefreshTimerRef.current) clearTimeout(pageRefreshTimerRef.current);
    pageRefreshTimerRef.current = setTimeout(() => {
      void loadImagesPageRef.current();
    }, 0);
  }, []);

  const schedulePageRefresh = useCallback((delay = 120) => {
    if (!enabledRef.current) return;
    // 랜덤 픽은 ORDER BY RANDOM()을 사용하므로 외부 이벤트(스캔 배치, watcher 등)에 의한
    // 리프레시가 매번 다른 결과를 반환한다. 유저가 명시적으로 새로고침할 때만 갱신되도록
    // schedulePageRefresh를 무시한다. (명시적 갱신은 randomSeed 변경 → listBaseQuery
    // 변경 → useEffect 경유로 loadImagesPage가 호출됨)
    if (builtinCategoryRef.current === "random") return;
    if (pageRefreshTimerRef.current) clearTimeout(pageRefreshTimerRef.current);
    pageRefreshTimerRef.current = setTimeout(() => {
      void loadImagesPageRef.current();
    }, delay);
  }, []);

  useEffect(() => {
    loadImagesPageRef.current = loadImagesPage;
  }, [loadImagesPage]);

  // Clear Blink's decoded-image cache AFTER React has committed the DOM update.
  // Fires twice per page change: once when images→[] (old cards unmount, bitmap
  // refs released via img.src=""), once when new images arrive.  Both passes
  // are needed because Blink may defer reclamation.
  const prevImagesRef = useRef(images);
  useEffect(() => {
    if (prevImagesRef.current !== images) {
      requestAnimationFrame(() => {
        window.appInfo.clearResourceCache();
      });
    }
    prevImagesRef.current = images;
  }, [images]);

  useEffect(() => {
    if (!enabled) return;
    void loadImagesPage();
  }, [enabled, loadImagesPage]);

  useEffect(() => {
    return () => {
      if (pageRefreshTimerRef.current) {
        clearTimeout(pageRefreshTimerRef.current);
        pageRefreshTimerRef.current = null;
      }
    };
  }, []);

  return {
    images,
    setImages,
    totalImageCount,
    galleryPage,
    setGalleryPage,
    galleryTotalPages,
    hasLoadedOnce,
    isLoading,
    pendingNewCount,
    pendingRemovedCount,
    incrementPendingNew,
    incrementPendingRemoved,
    markSelfRemoved,
    releaseSelfRemoved,
    applyPendingRefresh,
    schedulePageRefresh,
  };
}
