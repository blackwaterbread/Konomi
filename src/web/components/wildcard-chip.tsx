import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Dices, Plus, Trash2 } from "lucide-react";
import type { DraggableAttributes } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type { WildcardToken } from "@/lib/token";

const POPOVER_WIDTH = 240;
const POPOVER_GAP = 6;
const POPOVER_EDGE_PADDING = 8;

interface SortableBindings {
  setNodeRef: (node: HTMLDivElement | null) => void;
  attributes: DraggableAttributes;
  listeners: ReturnType<typeof useSortable>["listeners"];
  style: CSSProperties;
  isDragging: boolean;
}

interface WildcardChipProps {
  token: WildcardToken;
  onChange?: (token: WildcardToken) => void;
  onDelete?: () => void;
  chipRef?: (node: HTMLDivElement | null) => void;
  onTokenFocus?: () => void;
  onTokenKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  isSortable?: boolean;
  sortableId?: string;
  sortableDisabled?: boolean;
}

function WildcardChipCore({
  token,
  onChange,
  onDelete,
  chipRef,
  onTokenFocus,
  onTokenKeyDown,
  sortable,
}: Omit<WildcardChipProps, "isSortable" | "sortableId" | "sortableDisabled"> & {
  sortable?: SortableBindings;
}) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const newOptionInputRef = useRef<HTMLInputElement | null>(null);

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);
  const [draftOptions, setDraftOptions] = useState<string[]>([]);
  const [newOptionDraft, setNewOptionDraft] = useState("");

  const previewText =
    token.options.length > 0
      ? token.options.join("|")
      : t("wildcardChip.noOptions");

  const openPopover = () => {
    setDraftOptions([...token.options]);
    setNewOptionDraft("");
    setPopoverOpen(true);
  };

  const handleApply = () => {
    onChange?.({
      ...token,
      options: draftOptions.filter((option) => option.trim()),
    });
    setPopoverOpen(false);
  };

  const handleCancel = () => {
    setPopoverOpen(false);
  };

  const handleAddOption = () => {
    const option = newOptionDraft.trim();
    if (!option) return;
    setDraftOptions((previous) => [...previous, option]);
    setNewOptionDraft("");
    requestAnimationFrame(() => newOptionInputRef.current?.focus());
  };

  const handleDeleteOption = (index: number) => {
    setDraftOptions((previous) => previous.filter((_, i) => i !== index));
  };

  useEffect(() => {
    if (!popoverOpen) return;
    const raf = window.requestAnimationFrame(() => {
      newOptionInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [popoverOpen]);

  useEffect(() => {
    if (!popoverOpen) return;

    const updatePosition = () => {
      const triggerNode = triggerRef.current;
      if (!triggerNode) return;

      const rect = triggerNode.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const popoverHeight = popoverRef.current?.offsetHeight ?? 240;

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

    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      if (popoverRef.current?.contains(event.target as Node)) return;
      setPopoverOpen(false);
    };

    const raf = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("pointerdown", onPointerDown);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("pointerdown", onPointerDown);
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

  const hiddenStyle: CSSProperties = {
    position: "fixed",
    top: POPOVER_EDGE_PADDING,
    left: POPOVER_EDGE_PADDING,
    width: POPOVER_WIDTH,
    zIndex: 3000,
    visibility: "hidden",
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
        data-token-raw={`%{${token.options.join("|")}}`}
        onClick={() => {
          if (popoverOpen) return;
          openPopover();
        }}
        onFocus={onTokenFocus}
        onKeyDown={(e) => {
          onTokenKeyDown?.(e);
          if (e.defaultPrevented) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPopover();
          }
        }}
        {...sortable?.attributes}
        {...(!popoverOpen ? sortable?.listeners : {})}
        className={cn(
          "inline-flex cursor-pointer touch-none select-none items-center gap-1 rounded border px-1.5 py-1 text-xs transition-colors",
          "border-wildcard/35 bg-wildcard/14 text-wildcard",
          "hover:brightness-105",
          sortable?.isDragging && "opacity-70",
        )}
      >
        <Dices className="h-3 w-3 shrink-0 text-wildcard" />
        <span
          className={cn(
            "max-w-[120px] truncate",
            token.resolved ? "font-medium text-wildcard" : "text-wildcard/70",
          )}
        >
          {token.resolved ?? previewText}
        </span>
      </div>
    </div>
  );

  const popover = popoverOpen ? (
    <div
      ref={popoverRef}
      style={popoverStyle ?? hiddenStyle}
      className="rounded-md border border-border bg-popover p-2.5 shadow-lg"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        {t("wildcardChip.title")}
      </p>

      <div className="mb-2 max-h-36 space-y-1 overflow-y-auto">
        {draftOptions.length === 0 ? (
          <p className="py-2 text-center text-xs text-muted-foreground/40">
            {t("wildcardChip.noOptions")}
          </p>
        ) : (
          draftOptions.map((option, index) => (
            <div key={index} className="group/opt flex items-center gap-1.5">
              <span className="flex-1 min-w-0 truncate rounded border border-border/40 bg-muted px-1.5 py-0.5 text-xs text-foreground/80">
                {option}
              </span>
              <button
                type="button"
                onClick={() => handleDeleteOption(index)}
                title={t("common.delete")}
                aria-label={t("common.delete")}
                className="flex h-5 w-5 max-sm:h-9 max-sm:w-9 shrink-0 items-center justify-center rounded text-muted-foreground/60 opacity-0 max-sm:opacity-100 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover/opt:opacity-100"
              >
                <Trash2 className="h-3 w-3 max-sm:h-4 max-sm:w-4" />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="mb-2.5 flex gap-1">
        <Input
          ref={newOptionInputRef}
          value={newOptionDraft}
          onChange={(e) => setNewOptionDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAddOption();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              handleCancel();
            }
          }}
          placeholder={t("wildcardChip.addOptionPlaceholder")}
          className="flex-1 min-w-0 h-7 max-sm:h-10 rounded border border-border/60 bg-background dark:bg-background px-2 text-xs max-sm:text-sm text-foreground shadow-none placeholder:text-muted-foreground/40 focus-visible:border-primary/60 focus-visible:ring-0"
        />
        <button
          type="button"
          onClick={handleAddOption}
          disabled={!newOptionDraft.trim()}
          title={t("wildcardChip.addOption")}
          aria-label={t("wildcardChip.addOption")}
          className="flex h-7 w-7 max-sm:h-10 max-sm:w-10 items-center justify-center rounded border border-primary/30 bg-primary/15 text-primary transition-colors hover:bg-primary/25 disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5 max-sm:h-4 max-sm:w-4" />
        </button>
      </div>

      {token.resolved ? (
        <p className="mb-2 text-[10px] text-wildcard/85">
          {t("wildcardChip.lastSelected")}{" "}
          <span className="font-medium">{token.resolved}</span>
        </p>
      ) : null}

      <div className="flex items-center justify-between">
        {onDelete ? (
          <button
            type="button"
            onClick={() => {
              setPopoverOpen(false);
              onDelete();
            }}
            className="flex h-7 items-center gap-1 rounded border border-destructive/40 px-2 text-[11px] text-destructive/80 hover:bg-destructive/10"
          >
            <Trash2 className="h-3 w-3" />
            {t("common.delete")}
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCancel}
            className="h-7 rounded border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="h-7 rounded border border-primary/50 bg-primary/10 px-2 text-[11px] text-primary hover:bg-primary/20"
          >
            {t("wildcardChip.apply")}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      {chip}
      {popoverOpen && typeof document !== "undefined"
        ? createPortal(popover, document.body)
        : null}
    </>
  );
}

function SortableWildcardChip({
  sortableId,
  sortableDisabled = false,
  ...props
}: Omit<WildcardChipProps, "isSortable"> & { sortableId: string }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortableId, disabled: sortableDisabled });

  return (
    <WildcardChipCore
      {...props}
      sortable={{
        setNodeRef,
        attributes,
        listeners,
        style: { transform: CSS.Translate.toString(transform), transition },
        isDragging,
      }}
    />
  );
}

export function WildcardChip({
  isSortable = false,
  sortableId,
  sortableDisabled = false,
  ...props
}: WildcardChipProps) {
  if (isSortable && sortableId !== undefined) {
    return (
      <SortableWildcardChip
        {...props}
        sortableId={sortableId}
        sortableDisabled={sortableDisabled}
      />
    );
  }

  return <WildcardChipCore {...props} />;
}
