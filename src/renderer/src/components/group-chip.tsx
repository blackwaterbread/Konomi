import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import type { DraggableAttributes } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import type { GroupRefToken } from "@/lib/token";
import type { PromptGroup } from "@preload/index.d";

const POPOVER_WIDTH = 220;
const POPOVER_GAP = 6;
const POPOVER_EDGE_PADDING = 8;

interface SortableBindings {
  setNodeRef: (node: HTMLDivElement | null) => void;
  attributes: DraggableAttributes;
  listeners: ReturnType<typeof useSortable>["listeners"];
  style: CSSProperties;
  isDragging: boolean;
}

interface GroupChipProps {
  token: GroupRefToken;
  groups: PromptGroup[];
  isEditable?: boolean;
  chipRef?: (node: HTMLDivElement | null) => void;
  onTokenFocus?: () => void;
  onTokenKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  isSortable?: boolean;
  sortableId?: string;
  sortableDisabled?: boolean;
}

function GroupChipCore({
  token,
  groups,
  isEditable = false,
  chipRef,
  onTokenFocus,
  onTokenKeyDown,
  sortable,
}: Omit<GroupChipProps, "isSortable" | "sortableId" | "sortableDisabled"> & {
  sortable?: SortableBindings;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);

  const group = groups.find((g) => g.name === token.groupName);

  useEffect(() => {
    if (!popoverOpen) return;

    const updatePosition = () => {
      const triggerNode = triggerRef.current;
      if (!triggerNode) return;
      const rect = triggerNode.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const popoverHeight = popoverRef.current?.offsetHeight ?? 160;

      let left = rect.left;
      left = Math.max(POPOVER_EDGE_PADDING, left);
      left = Math.min(
        left,
        viewportWidth - POPOVER_WIDTH - POPOVER_EDGE_PADDING,
      );

      const spaceBelow = viewportHeight - rect.bottom - POPOVER_EDGE_PADDING;
      const spaceAbove = rect.top - POPOVER_EDGE_PADDING;
      const shouldOpenAbove =
        spaceBelow < popoverHeight && spaceAbove > spaceBelow;

      let top = shouldOpenAbove
        ? rect.top - popoverHeight - POPOVER_GAP
        : rect.bottom + POPOVER_GAP;
      top = Math.max(POPOVER_EDGE_PADDING, top);
      top = Math.min(
        top,
        viewportHeight - popoverHeight - POPOVER_EDGE_PADDING,
      );

      setPopoverStyle({
        position: "fixed",
        top,
        left,
        width: POPOVER_WIDTH,
        zIndex: 3000,
      });
    };

    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      if (popoverRef.current?.contains(e.target as Node)) return;
      setPopoverOpen(false);
    };

    const raf = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [popoverOpen]);

  const setCombinedRef = (node: HTMLDivElement | null) => {
    rootRef.current = node;
    sortable?.setNodeRef(node);
  };
  const setTriggerRef = (node: HTMLDivElement | null) => {
    triggerRef.current = node;
    chipRef?.(node);
  };

  const chip = (
    <div
      ref={setCombinedRef}
      className={cn("relative inline-flex", sortable?.isDragging && "z-20")}
      style={sortable?.style}
    >
      <div
        ref={setTriggerRef}
        role="button"
        tabIndex={0}
        data-token-chip="true"
        data-token-raw={`@{${token.groupName}}`}
        onClick={() => setPopoverOpen((v) => !v)}
        onFocus={onTokenFocus}
        onKeyDown={(e) => {
          onTokenKeyDown?.(e);
          if (e.defaultPrevented) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setPopoverOpen((v) => !v);
          }
        }}
        {...sortable?.attributes}
        {...(popoverOpen ? {} : sortable?.listeners)}
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-1 text-xs rounded border transition-colors cursor-pointer touch-none",
          "bg-violet-100 text-violet-800 border-violet-300/60",
          "dark:bg-violet-500/20 dark:text-violet-300 dark:border-violet-400/30",
          "hover:brightness-105",
          sortable?.isDragging && "opacity-70",
        )}
      >
        <span className="font-semibold text-violet-500 dark:text-violet-400 shrink-0">
          @
        </span>
        <span>{`{${token.groupName}}`}</span>
        <ChevronDown className="h-2.5 w-2.5 shrink-0 text-violet-400" />
      </div>
    </div>
  );

  const popover =
    popoverOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={popoverRef}
            style={
              popoverStyle ?? {
                position: "fixed",
                top: POPOVER_EDGE_PADDING,
                left: POPOVER_EDGE_PADDING,
                width: POPOVER_WIDTH,
                zIndex: 3000,
                visibility: "hidden",
              }
            }
            className="rounded-md border border-border bg-popover p-2.5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
              {token.groupName}
            </p>
            {!group ? (
              <p className="text-xs text-muted-foreground/60 italic">
                그룹을 찾을 수 없습니다
              </p>
            ) : group.tokens.length === 0 ? (
              <p className="text-xs text-muted-foreground/60 italic">
                토큰 없음
              </p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {group.tokens.map((t) => (
                  <span
                    key={t.id}
                    className="px-1.5 py-0.5 text-[11px] rounded bg-muted text-foreground/80 border border-border/40"
                  >
                    {t.label}
                  </span>
                ))}
              </div>
            )}
            {isEditable && (
              <p className="mt-2 text-[10px] text-muted-foreground/50">
                Delete/Backspace로 제거
              </p>
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {chip}
      {popover}
    </>
  );
}

function SortableGroupChip({
  sortableId,
  sortableDisabled = false,
  ...props
}: Omit<GroupChipProps, "isSortable"> & { sortableId: string }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortableId, disabled: sortableDisabled });

  return (
    <GroupChipCore
      {...props}
      sortable={{
        setNodeRef,
        attributes,
        listeners,
        style: { transform: CSS.Transform.toString(transform), transition },
        isDragging,
      }}
    />
  );
}

export function GroupChip({
  isSortable = false,
  sortableId,
  sortableDisabled = false,
  ...props
}: GroupChipProps) {
  if (isSortable && sortableId !== undefined) {
    return (
      <SortableGroupChip
        {...props}
        sortableId={sortableId}
        sortableDisabled={sortableDisabled}
      />
    );
  }
  return <GroupChipCore {...props} />;
}
