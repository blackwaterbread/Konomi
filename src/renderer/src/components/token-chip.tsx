import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { Copy, ImagePlus, Search } from "lucide-react";
import type { DraggableAttributes } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import type { PromptToken, TokenWeightExpression } from "@/lib/token";

function weightClass(w: number): string {
  if (w >= 1.3)
    return "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300";
  if (w > 1.0)
    return "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-200";
  if (w < 0)
    return "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300";
  if (w < 0.75)
    return "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300";
  if (w < 1.0)
    return "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200";
  return "bg-muted text-foreground/80";
}

function formatWeight(weight: number): string {
  if (!Number.isFinite(weight)) return "1";
  return weight.toFixed(2).replace(/\.?0+$/, "");
}

const KEYWORD_MULT = 1.05;

function inferWeightExpression(token: PromptToken): TokenWeightExpression {
  if (token.weightExpression) return token.weightExpression;
  return "numerical";
}

function clampWeight(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(3, value));
}

function buildNumericalRaw(text: string, weight: number): string {
  if (Math.abs(weight - 1.0) <= 0.001) return text;
  return `${formatWeight(weight)}::${text}::`;
}

function buildKeywordRaw(text: string, weight: number): string {
  if (Math.abs(weight - 1.0) <= 0.001) return text;
  if (weight <= 0) return buildNumericalRaw(text, weight);

  const level = Math.round(Math.log(weight) / Math.log(KEYWORD_MULT));
  if (level === 0) return text;

  if (level > 0) {
    let wrapped = text;
    for (let i = 0; i < level; i += 1) wrapped = `{${wrapped}}`;
    return wrapped;
  }

  let wrapped = text;
  for (let i = 0; i < Math.abs(level); i += 1) wrapped = `[${wrapped}]`;
  return wrapped;
}

type SortableId = string | number;

interface SortableBindings {
  setNodeRef: (node: HTMLDivElement | null) => void;
  attributes: DraggableAttributes;
  listeners: ReturnType<typeof useSortable>["listeners"];
  style: CSSProperties;
  isDragging: boolean;
}

const POPOVER_WIDTH = 224;
const POPOVER_GAP = 6;
const POPOVER_EDGE_PADDING = 8;

interface TokenChipProps {
  token: PromptToken;
  raw: string;
  isEditable?: boolean;
  constrainToContainer?: boolean;
  maxWidthPx?: number;
  editorOpen?: boolean;
  inlineEditOpen?: boolean;
  copied?: boolean;
  onCopy?: () => void;
  onAddTagToSearch?: (tag: string) => void;
  onAddTagToGeneration?: (tag: string) => void;
  onChange?: (token: PromptToken) => void;
  onEditorOpenChange?: (open: boolean) => void;
  onInlineEditOpenChange?: (open: boolean) => void;
  onApplyAdvance?: () => void;
  chipRef?: (node: HTMLDivElement | null) => void;
  onRequestAdjacentEdit?: (direction: "prev" | "next") => void;
  openOnFocus?: boolean;
  focusEditorOnOpen?: boolean;
  onTokenFocus?: () => void;
  onTokenKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  isSortable?: boolean;
  sortableId?: SortableId;
  sortableDisabled?: boolean;
}

function TokenChipCore({
  token,
  raw,
  isEditable = false,
  constrainToContainer = false,
  maxWidthPx,
  editorOpen,
  inlineEditOpen = false,
  copied = false,
  onCopy,
  onAddTagToSearch,
  onAddTagToGeneration,
  onChange,
  onEditorOpenChange,
  onInlineEditOpenChange,
  onApplyAdvance,
  chipRef,
  onRequestAdjacentEdit,
  openOnFocus = false,
  focusEditorOnOpen = true,
  onTokenFocus,
  onTokenKeyDown,
  sortable,
}: Omit<TokenChipProps, "isSortable" | "sortableId" | "sortableDisabled"> & {
  sortable?: SortableBindings;
}) {
  const radioName = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const editorInputRef = useRef<HTMLInputElement | null>(null);
  const inlineInputRef = useRef<HTMLInputElement | null>(null);
  const inlineHandlingRef = useRef<"apply" | "cancel" | null>(null);
  const [internalEditorOpen, setInternalEditorOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);
  const [draftText, setDraftText] = useState(token.text);
  const [draftWeight, setDraftWeight] = useState(clampWeight(token.weight));
  const [draftExpression, setDraftExpression] = useState<TokenWeightExpression>(
    inferWeightExpression(token),
  );

  useEffect(() => {
    setDraftText(token.text);
    setDraftWeight(clampWeight(token.weight));
    setDraftExpression(inferWeightExpression(token));
  }, [token, raw]);

  const isEditorOpenControlled = typeof editorOpen === "boolean";
  const resolvedEditorOpen = isEditorOpenControlled
    ? Boolean(editorOpen)
    : internalEditorOpen;

  const setEditorOpenState = (open: boolean) => {
    if (!isEditorOpenControlled) setInternalEditorOpen(open);
    onEditorOpenChange?.(open);
  };

  useEffect(() => {
    if (!resolvedEditorOpen) return;

    const updatePopoverPosition = () => {
      const triggerNode = triggerRef.current;
      if (!triggerNode) return;

      const rect = triggerNode.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const popoverHeight = popoverRef.current?.offsetHeight ?? 250;

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

    const closeWithReset = () => {
      setDraftText(token.text);
      setDraftWeight(clampWeight(token.weight));
      setDraftExpression(inferWeightExpression(token));
      if (!isEditorOpenControlled) setInternalEditorOpen(false);
      onEditorOpenChange?.(false);
    };

    const onPointerDown = (e: MouseEvent) => {
      const node = rootRef.current;
      const popoverNode = popoverRef.current;
      if (node?.contains(e.target as Node)) return;
      if (popoverNode?.contains(e.target as Node)) return;
      closeWithReset();
    };
    const onEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") closeWithReset();
    };

    const raf = window.requestAnimationFrame(updatePopoverPosition);
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onEscape);
    };
  }, [
    isEditorOpenControlled,
    onEditorOpenChange,
    resolvedEditorOpen,
    token,
    raw,
  ]);

  useEffect(() => {
    if (!resolvedEditorOpen || !focusEditorOnOpen) return;
    const raf = window.requestAnimationFrame(() => {
      const input = editorInputRef.current;
      if (!input) return;
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [resolvedEditorOpen, focusEditorOnOpen, popoverStyle]);

  useEffect(() => {
    if (!inlineEditOpen) return;
    const raf = window.requestAnimationFrame(() => {
      const input = inlineInputRef.current;
      if (!input) return;
      input.focus();
      input.select();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [inlineEditOpen]);

  const applyInlineEdit = (advance = false) => {
    if (inlineHandlingRef.current !== null) return;
    inlineHandlingRef.current = "apply";
    emitChange(draftText, draftWeight, draftExpression);
    onInlineEditOpenChange?.(false);
    if (advance) onApplyAdvance?.();
    window.requestAnimationFrame(() => {
      inlineHandlingRef.current = null;
    });
  };

  const cancelInlineEdit = () => {
    inlineHandlingRef.current = "cancel";
    resetDraft();
    onInlineEditOpenChange?.(false);
    window.requestAnimationFrame(() => {
      inlineHandlingRef.current = null;
      triggerRef.current?.focus();
    });
  };

  const handleInlineKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.ctrlKey && !e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      stepWeight(e.key === "ArrowUp" ? 0.1 : -0.1);
      return;
    }
    if (handleExpressionShortcut(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      applyInlineEdit(true);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancelInlineEdit();
      return;
    }
    if (e.key === "ArrowLeft") {
      const pos = e.currentTarget.selectionStart ?? 0;
      if (pos === 0 && (e.currentTarget.selectionEnd ?? 0) === 0) {
        e.preventDefault();
        applyInlineEdit(false);
        onRequestAdjacentEdit?.("prev");
      }
      return;
    }
    if (e.key === "ArrowRight") {
      const len = e.currentTarget.value.length;
      const pos = e.currentTarget.selectionStart ?? 0;
      if (pos === len && (e.currentTarget.selectionEnd ?? 0) === len) {
        e.preventDefault();
        applyInlineEdit(false);
        onRequestAdjacentEdit?.("next");
      }
    }
  };

  const handleInlineBlur = () => {
    if (inlineHandlingRef.current !== null) return;
    applyInlineEdit(false);
  };

  const weighted = Math.abs(token.weight - 1.0) > 0.001;
  const chipClass = cn(
    "px-1.5 py-1 text-xs rounded border border-border/40 transition-colors cursor-text hover:brightness-105",
    weighted ? weightClass(token.weight) : "bg-muted text-foreground/80",
    copied && "ring-1 ring-primary/50 text-primary",
  );

  const previewRawToken =
    draftExpression === "keyword"
      ? buildKeywordRaw(draftText.trim(), draftWeight)
      : buildNumericalRaw(draftText.trim(), draftWeight);

  const resetDraft = () => {
    setDraftText(token.text);
    setDraftWeight(clampWeight(token.weight));
    setDraftExpression(inferWeightExpression(token));
  };

  const emitChange = (
    nextText: string,
    nextWeight: number,
    nextExpression: TokenWeightExpression,
  ) => {
    const trimmedText = nextText.trim();
    const normalizedWeight = clampWeight(nextWeight);
    const nextRaw =
      nextExpression === "keyword"
        ? buildKeywordRaw(trimmedText, normalizedWeight)
        : buildNumericalRaw(trimmedText, normalizedWeight);

    onChange?.({
      ...token,
      text: trimmedText,
      weight: normalizedWeight,
      raw: nextRaw,
      weightExpression: nextExpression,
    });
  };

  const applyEditing = (advance = false) => {
    emitChange(draftText, draftWeight, draftExpression);
    if (advance) onApplyAdvance?.();
    setEditorOpenState(false);
  };

  const cancelEditing = () => {
    resetDraft();
    setEditorOpenState(false);
  };

  const stepWeight = (delta: number) => {
    setDraftWeight((prev) => {
      const stepped = prev + delta;
      return clampWeight(Math.round(stepped * 10) / 10);
    });
  };

  const handleExpressionShortcut = (
    e: ReactKeyboardEvent<HTMLElement>,
  ): boolean => {
    if (!e.altKey || e.ctrlKey) return false;
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return false;
    e.preventDefault();
    setDraftExpression(e.key === "ArrowUp" ? "keyword" : "numerical");
    return true;
  };

  const handleTrigger = () => {
    if (isEditable) return;
    onCopy?.();
  };

  const handleContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!isEditable) return;
    e.preventDefault();
    e.stopPropagation();
    setEditorOpenState(true);
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    onTokenKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    handleTrigger();
  };

  const handleFocus = () => {
    onTokenFocus?.();
    if (isEditable && openOnFocus) setEditorOpenState(true);
  };

  const handleTagInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.altKey && !e.ctrlKey && !e.shiftKey) {
      const start = e.currentTarget.selectionStart ?? 0;
      const end = e.currentTarget.selectionEnd ?? 0;
      const hasSelection = start !== end;

      if (e.key === "ArrowLeft" && !hasSelection) {
        e.preventDefault();
        e.stopPropagation();
        onRequestAdjacentEdit?.("prev");
        return;
      }

      if (e.key === "ArrowRight" && !hasSelection) {
        e.preventDefault();
        e.stopPropagation();
        onRequestAdjacentEdit?.("next");
        return;
      }
    }

    if (e.key === "Enter") {
      e.preventDefault();
      applyEditing(true);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEditing();
      return;
    }

    if (
      e.ctrlKey &&
      !e.altKey &&
      (e.key === "ArrowUp" || e.key === "ArrowDown")
    ) {
      e.preventDefault();
      stepWeight(e.key === "ArrowUp" ? 0.1 : -0.1);
      return;
    }
    handleExpressionShortcut(e);
  };

  const handlePopoverKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyEditing(true);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEditing();
      return;
    }
    handleExpressionShortcut(e);
  };

  const setCombinedRef = (node: HTMLDivElement | null) => {
    rootRef.current = node;
    sortable?.setNodeRef(node);
  };

  const setTriggerRef = (node: HTMLDivElement | null) => {
    triggerRef.current = node;
    chipRef?.(node);
  };

  const constrainedMaxWidth =
    constrainToContainer &&
    typeof maxWidthPx === "number" &&
    Number.isFinite(maxWidthPx) &&
    maxWidthPx > 0
      ? Math.floor(maxWidthPx)
      : undefined;
  const contextMenuTag = token.text.trim();
  const hasReadonlyContextMenu =
    !isEditable &&
    contextMenuTag.length > 0 &&
    (Boolean(onAddTagToSearch) || Boolean(onAddTagToGeneration));

  const inlineWeighted = Math.abs(draftWeight - 1.0) > 0.001;

  const chip = (
    <div
      ref={setCombinedRef}
      className={cn(
        "relative inline-flex",
        constrainToContainer && "min-w-0 max-w-full",
        sortable?.isDragging && "z-20",
      )}
      style={{
        ...sortable?.style,
        ...(constrainedMaxWidth ? { maxWidth: constrainedMaxWidth } : {}),
      }}
    >
      {inlineEditOpen ? (
        <div
          ref={setTriggerRef}
          data-token-chip="true"
          data-token-raw={raw}
          onContextMenu={handleContextMenu}
          className={cn(
            chipClass,
            "inline-flex items-center gap-1",
            constrainToContainer && "min-w-0 max-w-full",
          )}
        >
          <input
            ref={inlineInputRef}
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            onKeyDown={handleInlineKeyDown}
            onBlur={handleInlineBlur}
            className="bg-transparent outline-none text-xs min-w-[2ch]"
            size={Math.max(2, draftText.length + 1)}
          />
          {inlineWeighted ? (
            <span className="shrink-0 text-[10px] font-mono text-foreground/60">
              {`x${formatWeight(draftWeight)}`}
            </span>
          ) : null}
        </div>
      ) : (
        <div
          ref={setTriggerRef}
          role="button"
          tabIndex={0}
          data-token-chip="true"
          data-token-raw={raw}
          onClick={handleTrigger}
          onContextMenu={handleContextMenu}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          {...sortable?.attributes}
          {...(resolvedEditorOpen ? {} : sortable?.listeners)}
          className={cn(
            chipClass,
            "inline-flex items-center gap-1 cursor-pointer touch-none",
            constrainToContainer && "min-w-0 max-w-full",
            sortable?.isDragging && "opacity-70",
          )}
        >
          <span className={cn(constrainToContainer && "min-w-0 truncate")}>
            {token.text}
          </span>
          {weighted ? (
            <span className="shrink-0 text-[10px] font-mono text-foreground/60">
              {`x${formatWeight(token.weight)}`}
            </span>
          ) : null}
          {copied ? <Copy className="h-3 w-3 shrink-0" /> : null}
        </div>
      )}
    </div>
  );

  const popover =
    isEditable && resolvedEditorOpen && typeof document !== "undefined"
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
            onKeyDown={handlePopoverKeyDown}
          >
            <div className="space-y-2">
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">
                Tag
              </label>
              <input
                ref={editorInputRef}
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                onKeyDown={handleTagInputKeyDown}
                placeholder="tag"
                className="h-8 w-full rounded border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary/60"
              />
            </div>

            <div className="mt-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Emphasis
                </label>
                <span className="text-[10px] font-mono text-foreground/80">
                  {formatWeight(draftWeight)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={3}
                step={0.01}
                value={draftWeight}
                onChange={(e) =>
                  setDraftWeight(clampWeight(Number(e.target.value)))
                }
                className="h-1.5 w-full cursor-pointer accent-primary"
              />
            </div>

            <div className="mt-2.5">
              <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                Expression
              </p>
              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-1.5 text-xs text-foreground/80">
                  <input
                    type="radio"
                    name={radioName}
                    checked={draftExpression === "numerical"}
                    onChange={() => setDraftExpression("numerical")}
                  />
                  numerical
                </label>
                <label className="inline-flex items-center gap-1.5 text-xs text-foreground/80">
                  <input
                    type="radio"
                    name={radioName}
                    checked={draftExpression === "keyword"}
                    onChange={() => setDraftExpression("keyword")}
                  />
                  keyword
                </label>
              </div>
            </div>

            <div className="mt-2.5 space-y-1.5">
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">
                Raw Token
              </label>
              <input
                value={previewRawToken}
                readOnly
                className="h-8 w-full rounded border border-border bg-background px-2 font-mono text-[11px] text-foreground/80 outline-none"
              />
            </div>

            <div className="mt-3 flex items-center justify-end gap-1.5">
              <button
                type="button"
                className="h-7 rounded border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={cancelEditing}
              >
                Cancel
              </button>
              <button
                type="button"
                className="h-7 rounded border border-primary/50 bg-primary/10 px-2 text-[11px] text-primary hover:bg-primary/20"
                onClick={() => applyEditing(false)}
              >
                Apply
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {hasReadonlyContextMenu ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{chip}</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              onSelect={() => onAddTagToSearch?.(contextMenuTag)}
              disabled={!onAddTagToSearch}
            >
              <Search className="h-4 w-4" />
              검색어에 태그 추가
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => onAddTagToGeneration?.(contextMenuTag)}
              disabled={!onAddTagToGeneration}
            >
              <ImagePlus className="h-4 w-4" />
              생성모드에 태그 추가
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        chip
      )}
      {popover}
    </>
  );
}

function SortableTokenChip({
  sortableId,
  sortableDisabled = false,
  ...props
}: Omit<TokenChipProps, "isSortable"> & { sortableId: SortableId }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: sortableId,
    disabled: sortableDisabled,
  });

  return (
    <TokenChipCore
      {...props}
      sortable={{
        setNodeRef,
        attributes,
        listeners,
        style: {
          transform: CSS.Translate.toString(transform),
          transition,
        },
        isDragging,
      }}
    />
  );
}

export function TokenChip({
  isSortable = false,
  sortableId,
  sortableDisabled = false,
  ...props
}: TokenChipProps) {
  if (isSortable && sortableId !== undefined) {
    return (
      <SortableTokenChip
        {...props}
        sortableId={sortableId}
        sortableDisabled={sortableDisabled}
      />
    );
  }

  return <TokenChipCore {...props} />;
}
