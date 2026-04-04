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
import { parseTokens, rowToImageData } from "@/lib/image-utils";

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
    try {
      const result = await window.image.listPage({
        ...listBaseQuery,
        page: galleryPage,
      });
      if (requestId !== listRequestSeqRef.current) return;
      // Release Blink's decoded image cache from the previous page before rendering new images
      window.appInfo.clearResourceCache();
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
        i18n.t("error.imageListLoadFailed", {
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      if (requestId === listRequestSeqRef.current) {
        setIsLoading(false);
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

  const tokenLoadingRef = useRef(new Set<string>());

  const loadTokens = useCallback(async (imageId: string) => {
    if (tokenLoadingRef.current.has(imageId)) return;
    tokenLoadingRef.current.add(imageId);
    try {
      const rows = await window.image.listByIds([Number(imageId)]);
      if (rows.length === 0) return;
      const row = rows[0];
      const tokens = parseTokens(row.promptTokens);
      const negativeTokens = parseTokens(row.negativePromptTokens);
      const characterTokens = parseTokens(row.characterPromptTokens);
      setImages((prev) =>
        prev.map((img) =>
          img.id === imageId
            ? { ...img, tokens, negativeTokens, characterTokens }
            : img,
        ),
      );
    } finally {
      tokenLoadingRef.current.delete(imageId);
    }
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
    loadTokens,
  };
}
