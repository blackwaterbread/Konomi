import { useCallback, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export interface SwipeOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  /** Minimum horizontal distance in px required to trigger a swipe. */
  threshold?: number;
  /** Maximum allowed vertical drift in px; beyond this the gesture is cancelled. */
  restraint?: number;
  /** If true (default), ignore mouse — touch and pen only. */
  touchOnly?: boolean;
}

export interface SwipeHandlers {
  onPointerDown: (event: ReactPointerEvent) => void;
  onPointerMove: (event: ReactPointerEvent) => void;
  onPointerUp: (event: ReactPointerEvent) => void;
  onPointerCancel: (event: ReactPointerEvent) => void;
}

export interface SwipeResult {
  handlers: SwipeHandlers;
  /** Live horizontal delta while swiping; 0 when idle. */
  deltaX: number;
  isSwiping: boolean;
}

const DEFAULT_THRESHOLD = 60;
const DEFAULT_RESTRAINT = 80;
const DIRECTION_LOCK_PX = 10;

export function useSwipe(options: SwipeOptions = {}): SwipeResult {
  const {
    onSwipeLeft,
    onSwipeRight,
    threshold = DEFAULT_THRESHOLD,
    restraint = DEFAULT_RESTRAINT,
    touchOnly = true,
  } = options;

  const startRef = useRef<{
    x: number;
    y: number;
    pointerId: number;
    locked: "h" | "v" | null;
  } | null>(null);
  const [deltaX, setDeltaX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);

  const reset = useCallback(() => {
    startRef.current = null;
    setDeltaX(0);
    setIsSwiping(false);
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      if (touchOnly && event.pointerType === "mouse") return;
      if (!event.isPrimary) {
        startRef.current = null;
        setDeltaX(0);
        setIsSwiping(false);
        return;
      }
      startRef.current = {
        x: event.clientX,
        y: event.clientY,
        pointerId: event.pointerId,
        locked: null,
      };
      try {
        (event.currentTarget as Element).setPointerCapture(event.pointerId);
      } catch {
        // ignore — element may be detached
      }
      setDeltaX(0);
      setIsSwiping(false);
    },
    [touchOnly],
  );

  const onPointerMove = useCallback((event: ReactPointerEvent) => {
    const start = startRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    if (!event.isPrimary) {
      startRef.current = null;
      setDeltaX(0);
      setIsSwiping(false);
      return;
    }
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (start.locked === null) {
      if (
        Math.abs(dx) >= DIRECTION_LOCK_PX ||
        Math.abs(dy) >= DIRECTION_LOCK_PX
      ) {
        start.locked = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      }
    }
    if (start.locked === "v") return;
    if (start.locked === "h") {
      setIsSwiping(true);
      setDeltaX(dx);
    }
  }, []);

  const onPointerUp = useCallback(
    (event: ReactPointerEvent) => {
      const start = startRef.current;
      if (!start || start.pointerId !== event.pointerId) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      reset();
      if (start.locked !== "h") return;
      if (Math.abs(dy) > restraint) return;
      if (Math.abs(dx) < threshold) return;
      if (dx < 0) onSwipeLeft?.();
      else onSwipeRight?.();
    },
    [onSwipeLeft, onSwipeRight, threshold, restraint, reset],
  );

  const onPointerCancel = useCallback(() => {
    reset();
  }, [reset]);

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    deltaX,
    isSwiping,
  };
}
