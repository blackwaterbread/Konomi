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
  options?: { enabled?: boolean; overlayActiveRef?: React.RefObject<boolean> },
) {
  const enabled = options?.enabled ?? true;
  const [images, setImages] = useState<ImageData[]>([]);
  const [totalImageCount, setTotalImageCount] = useState(0);
  const [galleryPage, setGalleryPage] = useState(1);
  const [galleryTotalPages, setGalleryTotalPages] = useState(1);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const pageRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const enabledRef = useRef(enabled);
  const listRequestSeqRef = useRef(0);
  const loadImagesPageRef = useRef<() => Promise<void>>(async () => {});

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
    if (!enabled) return;
    setGalleryPage(1);
  }, [enabled, listBaseQuery]);

  const loadImagesPage = useCallback(async () => {
    if (!enabled) return;
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
      startTransition(() => {
        setImages(result.rows.map((row) => rowToImageData(row)));
        setTotalImageCount(result.totalCount);
        setGalleryTotalPages(result.totalPages);
        setIsLoading(false);
        setHasLoadedOnce(true);
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
  }, [enabled, galleryPage, listBaseQuery]);

  const schedulePageRefresh = useCallback((delay = 120) => {
    if (!enabledRef.current) return;
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
    if (prevImagesRef.current !== images && images.length > 0) {
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
    schedulePageRefresh,
  };
}
