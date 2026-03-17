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
import { rowToImageData } from "@/lib/image-utils";

export function useGalleryImages(
  listBaseQuery: Omit<ImageListQuery, "page">,
  options?: { enabled?: boolean },
) {
  const enabled = options?.enabled ?? true;
  const [images, setImages] = useState<ImageData[]>([]);
  const [totalImageCount, setTotalImageCount] = useState(0);
  const [galleryPage, setGalleryPage] = useState(1);
  const [galleryTotalPages, setGalleryTotalPages] = useState(1);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

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
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    setGalleryPage(1);
  }, [enabled, listBaseQuery]);

  const loadImagesPage = useCallback(async () => {
    if (!enabled) return;
    const requestId = ++listRequestSeqRef.current;
    try {
      const result = await window.image.listPage({
        ...listBaseQuery,
        page: galleryPage,
      });
      if (requestId !== listRequestSeqRef.current) return;
      startTransition(() => {
        setImages(result.rows.map(rowToImageData));
        setTotalImageCount(result.totalCount);
        setGalleryTotalPages(result.totalPages);
      });
      if (galleryPage > result.totalPages) {
        setGalleryPage(result.totalPages);
      }
    } catch (e: unknown) {
      if (requestId !== listRequestSeqRef.current) return;
      toast.error(
        `이미지 목록 로드 실패: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      if (requestId === listRequestSeqRef.current) {
        setHasLoadedOnce(true);
      }
    }
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
    schedulePageRefresh,
  };
}
