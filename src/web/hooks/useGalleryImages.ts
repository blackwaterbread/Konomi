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
const EMPTY_ID_SET: ReadonlySet<number> = new Set<number>();

// Copy-on-write set helpers: clone only if a real change is needed so React
// state setters don't fire when nothing actually changed.
function differenceIfChanged(
  current: Set<number>,
  toRemove: Iterable<number>,
): Set<number> {
  let next: Set<number> | null = null;
  for (const id of toRemove) {
    if (current.has(id)) {
      if (!next) next = new Set(current);
      next.delete(id);
    }
  }
  return next ?? current;
}

function unionIfChanged(
  current: Set<number>,
  toAdd: Iterable<number>,
): Set<number> {
  let next: Set<number> | null = null;
  for (const id of toAdd) {
    if (!current.has(id)) {
      if (!next) next = new Set(current);
      next.add(id);
    }
  }
  return next ?? current;
}

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
  const [pendingNewIds, setPendingNewIds] =
    useState<ReadonlySet<number>>(EMPTY_ID_SET);
  const [pendingRemovedIds, setPendingRemovedIds] =
    useState<ReadonlySet<number>>(EMPTY_ID_SET);
  // Bump to force loadImagesPage to recompute and the load useEffect to fire,
  // funneling banner-clicks and post-action refreshes through the same path
  // listBaseQuery changes already use. Avoids the double-fetch race where a
  // setTimeout-based reload and a deps-driven useEffect both call listPage.
  const [reloadKey, setReloadKey] = useState(0);

  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledRef = useRef(enabled);
  const builtinCategoryRef = useRef(listBaseQuery.builtinCategory);
  const listRequestSeqRef = useRef(0);
  // Tracks ids the user just deleted themselves so the matching watcher
  // image:removed events don't surface as the "N removed" banner.
  const expectedRemovedIdsRef = useRef<Set<number>>(new Set());

  const cancelPendingReload = useCallback(() => {
    if (reloadTimerRef.current) {
      clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) {
      cancelPendingReload();
      setIsLoading(false);
    }
  }, [enabled, cancelPendingReload]);

  useEffect(() => {
    builtinCategoryRef.current = listBaseQuery.builtinCategory;
  }, [listBaseQuery.builtinCategory]);

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
      // isLoading and hasLoadedOnce are urgent — they gate the gallery overlay
      // spinner.  Keeping them inside startTransition lets scan-progress events
      // (frequent urgent updates) continuously defer the transition render,
      // which leaves isLoading=true indefinitely and causes an infinite spinner.
      setIsLoading(false);
      setHasLoadedOnce(true);
      const loadedIds = result.rows.map((row) => row.id);
      startTransition(() => {
        setImages(result.rows.map((row) => rowToImageData(row, thumbWidth)));
        setTotalImageCount(result.totalCount);
        setGalleryTotalPages(result.totalPages);
        // Only consume ids that actually showed up in the loaded page.
        // Unlike a blanket reset, this keeps pendings that arrived during the
        // listPage IO but weren't part of this response (they'll surface on
        // the next refresh). pendingRemovedIds isn't touched here: removed
        // ids by definition aren't in DB anymore so they can't appear in
        // loadedIds — applyPendingRefresh is the only way to clear it.
        setPendingNewIds((prev) =>
          prev.size === 0
            ? prev
            : differenceIfChanged(prev as Set<number>, loadedIds),
        );
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
  }, [enabled, galleryPage, listBaseQuery, thumbWidth, reloadKey]);

  const addPendingNewIds = useCallback((ids: number[]) => {
    if (!enabledRef.current) return;
    if (builtinCategoryRef.current === "random") return;
    if (ids.length === 0) return;
    setPendingNewIds((prev) => unionIfChanged(prev as Set<number>, ids));
  }, []);

  const addPendingRemovedIds = useCallback((ids: number[]) => {
    if (!enabledRef.current) return;
    if (builtinCategoryRef.current === "random") return;
    if (ids.length === 0) return;
    // Subtract self-initiated removals so the banner only counts external
    // deletes (another client, direct FS change) rather than the user's own.
    const expected = expectedRemovedIdsRef.current;
    const externalIds: number[] = [];
    for (const id of ids) {
      if (expected.has(id)) {
        expected.delete(id);
      } else {
        externalIds.push(id);
      }
    }
    if (externalIds.length === 0) return;
    setPendingRemovedIds((prev) =>
      unionIfChanged(prev as Set<number>, externalIds),
    );
  }, []);

  const markSelfRemovedIds = useCallback((ids: number[]) => {
    for (const id of ids) expectedRemovedIdsRef.current.add(id);
  }, []);

  // Releases over-marked self-removals when image:removed events don't arrive
  // for some pre-marked ids (e.g. unlink failed, or path wasn't in the DB to
  // begin with). Without this the expected set leaks and silently eats future
  // external removal events for those ids.
  const releaseSelfRemovedIds = useCallback((ids: number[]) => {
    for (const id of ids) expectedRemovedIdsRef.current.delete(id);
  }, []);

  const applyPendingRefresh = useCallback(() => {
    cancelPendingReload();
    setPendingNewIds(EMPTY_ID_SET);
    setPendingRemovedIds(EMPTY_ID_SET);
    setReloadKey((k) => k + 1);
  }, [cancelPendingReload]);

  const schedulePageRefresh = useCallback(
    (delay = 120) => {
      if (!enabledRef.current) return;
      // 랜덤 픽은 ORDER BY RANDOM()을 사용하므로 외부 이벤트(스캔 배치, watcher 등)에 의한
      // 리프레시가 매번 다른 결과를 반환한다. 유저가 명시적으로 새로고침할 때만 갱신되도록
      // schedulePageRefresh를 무시한다. (명시적 갱신은 randomSeed 변경 → listBaseQuery
      // 변경 → useEffect 경유로 loadImagesPage가 호출됨)
      if (builtinCategoryRef.current === "random") return;
      cancelPendingReload();
      reloadTimerRef.current = setTimeout(() => {
        reloadTimerRef.current = null;
        setReloadKey((k) => k + 1);
      }, delay);
    },
    [cancelPendingReload],
  );

  // listBaseQuery / galleryPage already trigger the load useEffect via the
  // recreated loadImagesPage identity. Drop any in-flight scheduled reload
  // so it doesn't fire a redundant second listPage right after.
  useEffect(() => {
    cancelPendingReload();
  }, [listBaseQuery, galleryPage, cancelPendingReload]);

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
      cancelPendingReload();
    };
  }, [cancelPendingReload]);

  return {
    images,
    setImages,
    totalImageCount,
    galleryPage,
    setGalleryPage,
    galleryTotalPages,
    hasLoadedOnce,
    isLoading,
    pendingNewCount: pendingNewIds.size,
    pendingRemovedCount: pendingRemovedIds.size,
    addPendingNewIds,
    addPendingRemovedIds,
    markSelfRemovedIds,
    releaseSelfRemovedIds,
    applyPendingRefresh,
    schedulePageRefresh,
  };
}
