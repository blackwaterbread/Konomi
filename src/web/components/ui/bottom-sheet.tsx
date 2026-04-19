import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { cn } from "@/lib/utils";

export type BottomSheetState = "peek" | "half" | "full";

interface BottomSheetProps {
  open: boolean;
  state: BottomSheetState;
  onStateChange: (next: BottomSheetState) => void;
  /** Rendered above the drag handle; always visible when the sheet is open. */
  header?: ReactNode;
  children: ReactNode;
  peekHeight?: number;
  className?: string;
}

const DEFAULT_PEEK = 52;
const DRAG_COMMIT_PX = 40;

function heightForState(state: BottomSheetState, peek: number): string {
  switch (state) {
    case "peek":
      return `${peek}px`;
    case "half":
      return "60dvh";
    case "full":
      return "92dvh";
  }
}

export function BottomSheet({
  open,
  state,
  onStateChange,
  header,
  children,
  peekHeight = DEFAULT_PEEK,
  className,
}: BottomSheetProps) {
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ y: number; pointerId: number } | null>(null);

  const handlePointerDown = useCallback((event: ReactPointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, [role='button'], input, textarea, select"))
      return;
    dragRef.current = { y: event.clientY, pointerId: event.pointerId };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setDragOffset(0);
    setIsDragging(true);
  }, []);

  const handlePointerMove = useCallback((event: ReactPointerEvent) => {
    const start = dragRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setDragOffset(event.clientY - start.y);
  }, []);

  const commitDrag = useCallback(
    (offset: number) => {
      if (offset <= -DRAG_COMMIT_PX) {
        if (state === "peek") onStateChange("half");
        else if (state === "half") onStateChange("full");
      } else if (offset >= DRAG_COMMIT_PX) {
        if (state === "full") onStateChange("half");
        else if (state === "half") onStateChange("peek");
      }
    },
    [state, onStateChange],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent) => {
      const start = dragRef.current;
      if (!start || start.pointerId !== event.pointerId) return;
      const offset = event.clientY - start.y;
      dragRef.current = null;
      setDragOffset(0);
      setIsDragging(false);
      commitDrag(offset);
    },
    [commitDrag],
  );

  const handlePointerCancel = useCallback(() => {
    dragRef.current = null;
    setDragOffset(0);
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (!open) {
      dragRef.current = null;
      setDragOffset(0);
      setIsDragging(false);
    }
  }, [open]);

  const baseHeight = heightForState(state, peekHeight);
  const transform = isDragging
    ? `translateY(${Math.max(-200, Math.min(400, dragOffset))}px)`
    : "translateY(0)";
  const transition = isDragging
    ? "none"
    : "transform 200ms ease-out, height 200ms ease-out";

  return (
    <div
      aria-hidden={!open}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 flex flex-col rounded-t-2xl border-t border-border/60 bg-background/95 shadow-[0_-8px_24px_rgba(0,0,0,0.25)] backdrop-blur-sm",
        "pb-safe",
        open ? "pointer-events-auto" : "pointer-events-none opacity-0",
        className,
      )}
      style={{
        height: baseHeight,
        transform,
        transition,
      }}
    >
      <div
        className="flex shrink-0 flex-col items-stretch touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <div className="flex justify-center py-3">
          <div className="h-1.5 w-12 rounded-full bg-muted-foreground/40" />
        </div>
        {header}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
