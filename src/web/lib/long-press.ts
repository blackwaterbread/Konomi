import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export interface LongPressOptions {
  /** Activation delay in ms. */
  ms?: number;
  /** Cancel if pointer moves more than this many px after press. */
  moveTolerance?: number;
  /** Emit a short haptic tick on fire (if supported). */
  haptic?: boolean;
  /** Only fire for touch / pen pointers — ignore mouse. */
  touchOnly?: boolean;
}

export interface LongPressHandlers {
  onPointerDown: (event: ReactPointerEvent) => void;
  onPointerMove: (event: ReactPointerEvent) => void;
  onPointerUp: (event: ReactPointerEvent) => void;
  onPointerCancel: (event: ReactPointerEvent) => void;
  onPointerLeave: (event: ReactPointerEvent) => void;
}

export interface LongPressController {
  handlers: LongPressHandlers;
  /**
   * True if the most recent gesture triggered long-press. Consumer should read
   * and reset this in their onClick handler to suppress the click that
   * naturally follows pointerup after a long-press fires.
   */
  didFireRef: { current: boolean };
}

const DEFAULT_MS = 500;
const DEFAULT_TOLERANCE = 10;

/**
 * Returns pointer handlers that invoke `handler` after a long press.
 *
 * Coexists with onContextMenu: call the right-click handler separately on the
 * element. The desktop path still works; this only adds a touch path.
 */
export function useLongPress(
  handler: (event: ReactPointerEvent) => void,
  options: LongPressOptions = {},
): LongPressController {
  const {
    ms = DEFAULT_MS,
    moveTolerance = DEFAULT_TOLERANCE,
    haptic = true,
    touchOnly = true,
  } = options;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const handlerRef = useRef(handler);
  const didFireRef = useRef(false);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
  }, []);

  useEffect(() => () => clear(), [clear]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      if (touchOnly && event.pointerType === "mouse") return;
      clear();
      didFireRef.current = false;
      startRef.current = { x: event.clientX, y: event.clientY };
      const pointerEvent = event;
      timerRef.current = setTimeout(() => {
        didFireRef.current = true;
        if (haptic && typeof navigator !== "undefined" && navigator.vibrate) {
          try {
            navigator.vibrate(10);
          } catch {
            /* ignore */
          }
        }
        handlerRef.current(pointerEvent);
      }, ms);
    },
    [clear, haptic, ms, touchOnly],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent) => {
      if (!startRef.current || timerRef.current === null) return;
      const dx = event.clientX - startRef.current.x;
      const dy = event.clientY - startRef.current.y;
      if (dx * dx + dy * dy > moveTolerance * moveTolerance) {
        clear();
      }
    },
    [clear, moveTolerance],
  );

  const onPointerUp = useCallback(() => {
    clear();
  }, [clear]);

  const onPointerCancel = useCallback(() => {
    clear();
  }, [clear]);

  const onPointerLeave = useCallback(() => {
    clear();
  }, [clear]);

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onPointerLeave,
    },
    didFireRef,
  };
}

type SortableListenerMap = Record<string, unknown> | undefined;

function callSortable(
  listeners: SortableListenerMap,
  key: string,
  event: ReactPointerEvent,
) {
  const fn = listeners?.[key];
  if (typeof fn === "function") {
    (fn as (event: ReactPointerEvent) => void)(event);
  }
}

/**
 * Merge long-press handlers with dnd-kit's sortable listeners so both fire on
 * the shared pointer events. Without this, spreading both clobbers one set —
 * React only keeps the last write per prop key.
 */
export function mergeLongPressWithSortableListeners(
  longPress: LongPressHandlers,
  sortable: SortableListenerMap,
): Record<string, (event: ReactPointerEvent) => void> {
  return {
    ...((sortable as Record<string, (event: ReactPointerEvent) => void>) ?? {}),
    onPointerDown: (event: ReactPointerEvent) => {
      longPress.onPointerDown(event);
      callSortable(sortable, "onPointerDown", event);
    },
    onPointerMove: (event: ReactPointerEvent) => {
      longPress.onPointerMove(event);
      callSortable(sortable, "onPointerMove", event);
    },
    onPointerUp: (event: ReactPointerEvent) => {
      longPress.onPointerUp(event);
      callSortable(sortable, "onPointerUp", event);
    },
    onPointerCancel: (event: ReactPointerEvent) => {
      longPress.onPointerCancel(event);
      callSortable(sortable, "onPointerCancel", event);
    },
    onPointerLeave: (event: ReactPointerEvent) => {
      longPress.onPointerLeave(event);
      callSortable(sortable, "onPointerLeave", event);
    },
  };
}
