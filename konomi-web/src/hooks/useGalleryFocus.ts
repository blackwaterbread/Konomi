import { useCallback, useEffect, useRef, useState } from "react";

export interface GalleryFocusState {
  focusIndex: number | null;
  columnCount: number;
}

export interface GalleryFocusActions {
  setFocusIndex: (index: number | null) => void;
  setColumnCount: (count: number) => void;
  moveUp: () => void;
  moveDown: () => void;
  moveLeft: () => void;
  moveRight: () => void;
  moveHome: () => void;
  moveEnd: () => void;
}

export function useGalleryFocus(imageCount: number) {
  const [focusIndex, setFocusIndexRaw] = useState<number | null>(null);
  const [columnCount, setColumnCount] = useState(4);
  const imageCountRef = useRef(imageCount);
  imageCountRef.current = imageCount;
  const columnCountRef = useRef(columnCount);
  columnCountRef.current = columnCount;

  // Reset focus when image list changes
  useEffect(() => {
    setFocusIndexRaw((prev) => {
      if (prev === null) return null;
      if (imageCount === 0) return null;
      return Math.min(prev, imageCount - 1);
    });
  }, [imageCount]);

  const setFocusIndex = useCallback((index: number | null) => {
    if (index === null) {
      setFocusIndexRaw(null);
      return;
    }
    const count = imageCountRef.current;
    if (count === 0) return;
    setFocusIndexRaw(Math.max(0, Math.min(count - 1, index)));
  }, []);

  const moveUp = useCallback(() => {
    const count = imageCountRef.current;
    const cols = columnCountRef.current;
    if (count === 0) return;
    setFocusIndexRaw((prev) => {
      if (prev === null) return 0;
      const next = prev - cols;
      return next >= 0 ? next : prev;
    });
  }, []);

  const moveDown = useCallback(() => {
    const count = imageCountRef.current;
    const cols = columnCountRef.current;
    if (count === 0) return;
    setFocusIndexRaw((prev) => {
      if (prev === null) return 0;
      const next = prev + cols;
      return next < count ? next : prev;
    });
  }, []);

  const moveLeft = useCallback(() => {
    const count = imageCountRef.current;
    if (count === 0) return;
    setFocusIndexRaw((prev) => {
      if (prev === null) return 0;
      return prev > 0 ? prev - 1 : prev;
    });
  }, []);

  const moveRight = useCallback(() => {
    const count = imageCountRef.current;
    if (count === 0) return;
    setFocusIndexRaw((prev) => {
      if (prev === null) return 0;
      return prev < count - 1 ? prev + 1 : prev;
    });
  }, []);

  const moveHome = useCallback(() => {
    const count = imageCountRef.current;
    if (count === 0) return;
    setFocusIndexRaw(0);
  }, []);

  const moveEnd = useCallback(() => {
    const count = imageCountRef.current;
    if (count === 0) return;
    setFocusIndexRaw(count - 1);
  }, []);

  const state: GalleryFocusState = { focusIndex, columnCount };
  const actions: GalleryFocusActions = {
    setFocusIndex,
    setColumnCount,
    moveUp,
    moveDown,
    moveLeft,
    moveRight,
    moveHome,
    moveEnd,
  };

  return { galleryFocusState: state, galleryFocusActions: actions };
}
