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
import {
  Copy,
  ImagePlus,
  Minus,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type { DraggableAttributes } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  getPromptEmphasisSyntaxIssueKind,
  type PromptEmphasisSyntaxIssueKind,
} from "@/lib/prompt-emphasis-syntax";
import { getPromptWeightToneClass } from "@/lib/prompt-weight-style";
import { cn } from "@/lib/utils";
import type { PromptToken, TokenWeightExpression } from "@/lib/token";
import type {
  PromptTagSuggestion,
  PromptTagSuggestStats,
} from "@preload/index.d";
import { PromptTagSuggestionIndicator } from "./prompt-tag-suggestion-indicator";

function formatWeight(weight: number): string {
  if (!Number.isFinite(weight)) return "1";
  return weight.toFixed(2).replace(/\.?0+$/, "");
}

const KEYWORD_MULT = 1.05;

function inferWeightExpression(token: PromptToken): TokenWeightExpression {
  if (token.weightExpression) return token.weightExpression;
  return "numerical";
}

const MIN_WEIGHT = -1;
const MAX_WEIGHT = 3;

function clampWeight(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, value));
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
const TAG_SUGGEST_LIMIT = 8;
const EMPTY_PROMPT_TAG_SUGGEST_STATS: PromptTagSuggestStats = {
  totalTags: 0,
  maxCount: 0,
  bucketThresholds: [],
};

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
  onDelete?: () => void;
  onEditorOpenChange?: (
    open: boolean,
    reason?: "cancel" | "apply" | "advance",
  ) => void;
  onInlineEditOpenChange?: (open: boolean, reason?: "cancel" | "stay") => void;
  onApplyAdvance?: () => void;
  chipRef?: (node: HTMLDivElement | null) => void;
  onRequestAdjacentEdit?: (direction: "prev" | "next") => void;
  onRequestVerticalNavigation?: (direction: "up" | "down") => void;
  openOnFocus?: boolean;
  focusEditorOnOpen?: boolean;
  onTokenFocus?: () => void;
  onTokenKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  isSortable?: boolean;
  sortableId?: SortableId;
  sortableDisabled?: boolean;
  tagSuggestionExclude?: string[];
  syntaxIssueKind?: PromptEmphasisSyntaxIssueKind | null;
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
  onDelete,
  onEditorOpenChange,
  onInlineEditOpenChange,
  onApplyAdvance,
  chipRef,
  onRequestAdjacentEdit,
  onRequestVerticalNavigation,
  openOnFocus = false,
  focusEditorOnOpen = true,
  onTokenFocus,
  onTokenKeyDown,
  tagSuggestionExclude = [],
  syntaxIssueKind,
  sortable,
}: Omit<TokenChipProps, "isSortable" | "sortableId" | "sortableDisabled"> & {
  sortable?: SortableBindings;
}) {
  const { t } = useTranslation();
  const radioName = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const editorInputRef = useRef<HTMLInputElement | null>(null);
  const inlineInputRef = useRef<HTMLInputElement | null>(null);
  const inlineHandlingRef = useRef<"apply" | "cancel" | null>(null);
  const selectingTagSuggestionRef = useRef(false);
  const suppressTagSuggestOnceRef = useRef(false);
  const tagSuggestDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const tagSuggestRequestSeqRef = useRef(0);
  const [internalEditorOpen, setInternalEditorOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);
  const [inlineSuggestionStyle, setInlineSuggestionStyle] =
    useState<CSSProperties | null>(null);
  const [draftText, setDraftText] = useState(token.text);
  const [draftWeight, setDraftWeight] = useState(clampWeight(token.weight));
  const [draftExpression, setDraftExpression] = useState<TokenWeightExpression>(
    inferWeightExpression(token),
  );
  const [tagSuggestions, setTagSuggestions] = useState<PromptTagSuggestion[]>(
    [],
  );
  const [tagSuggestionStats, setTagSuggestionStats] =
    useState<PromptTagSuggestStats>(EMPTY_PROMPT_TAG_SUGGEST_STATS);
  const [tagSuggestionOpen, setTagSuggestionOpen] = useState(false);
  const [tagSuggestionIndex, setTagSuggestionIndex] = useState(-1);
  const showInlineSuggestions =
    inlineEditOpen && tagSuggestionOpen && tagSuggestions.length > 0;

  useEffect(() => {
    setDraftText(token.text);
    setDraftWeight(clampWeight(token.weight));
    setDraftExpression(inferWeightExpression(token));
  }, [token, raw]);

  useEffect(
    () => () => {
      if (tagSuggestDebounceRef.current) {
        clearTimeout(tagSuggestDebounceRef.current);
      }
    },
    [],
  );

  const isEditorOpenControlled = typeof editorOpen === "boolean";
  const resolvedEditorOpen = isEditorOpenControlled
    ? Boolean(editorOpen)
    : internalEditorOpen;

  const setEditorOpenState = (
    open: boolean,
    reason?: "cancel" | "apply" | "advance",
  ) => {
    if (!isEditorOpenControlled) setInternalEditorOpen(open);
    onEditorOpenChange?.(open, reason);
  };

  useEffect(() => {
    if (!resolvedEditorOpen) return;
    suppressTagSuggestOnceRef.current = true;
    setTagSuggestions([]);
    setTagSuggestionStats(EMPTY_PROMPT_TAG_SUGGEST_STATS);
    setTagSuggestionOpen(false);
    setTagSuggestionIndex(-1);
  }, [resolvedEditorOpen]);

  useEffect(() => {
    const canSuggest = inlineEditOpen || resolvedEditorOpen;
    const prefix = draftText.trim();

    if (!canSuggest || !prefix) {
      setTagSuggestions((prev) => (prev.length === 0 ? prev : []));
      setTagSuggestionStats(EMPTY_PROMPT_TAG_SUGGEST_STATS);
      setTagSuggestionOpen(false);
      setTagSuggestionIndex(-1);
      if (tagSuggestDebounceRef.current) {
        clearTimeout(tagSuggestDebounceRef.current);
        tagSuggestDebounceRef.current = null;
      }
      return;
    }

    if (suppressTagSuggestOnceRef.current) {
      suppressTagSuggestOnceRef.current = false;
      return;
    }

    if (tagSuggestDebounceRef.current) {
      clearTimeout(tagSuggestDebounceRef.current);
      tagSuggestDebounceRef.current = null;
    }

    tagSuggestDebounceRef.current = setTimeout(() => {
      const requestId = ++tagSuggestRequestSeqRef.current;
      window.promptBuilder
        .suggestTags({
          prefix,
          limit: TAG_SUGGEST_LIMIT,
          exclude: tagSuggestionExclude,
        })
        .then(({ suggestions, stats }) => {
          if (requestId !== tagSuggestRequestSeqRef.current) return;
          setTagSuggestions(suggestions);
          setTagSuggestionStats(stats);
          setTagSuggestionOpen(suggestions.length > 0);
          setTagSuggestionIndex((prev) =>
            suggestions.length === 0
              ? -1
              : prev < 0
                ? -1
                : Math.min(prev, suggestions.length - 1),
          );
        })
        .catch(() => {
          if (requestId !== tagSuggestRequestSeqRef.current) return;
          setTagSuggestions([]);
          setTagSuggestionStats(EMPTY_PROMPT_TAG_SUGGEST_STATS);
          setTagSuggestionOpen(false);
          setTagSuggestionIndex(-1);
        });
    }, 120);

    return () => {
      if (tagSuggestDebounceRef.current) {
        clearTimeout(tagSuggestDebounceRef.current);
        tagSuggestDebounceRef.current = null;
      }
    };
  }, [draftText, inlineEditOpen, resolvedEditorOpen, tagSuggestionExclude]);

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
      setEditorOpenState(false, "cancel");
    };

    const onPointerDown = (e: MouseEvent) => {
      if (selectingTagSuggestionRef.current) return;
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

  useEffect(() => {
    if (!showInlineSuggestions) {
      setInlineSuggestionStyle(null);
      return;
    }

    const updateInlineSuggestionPosition = () => {
      const anchor = triggerRef.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const width = Math.min(288, viewportWidth - 16);
      const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));

      setInlineSuggestionStyle({
        position: "fixed",
        top: rect.bottom + 4,
        left,
        width,
        zIndex: 3200,
      });
    };

    const raf = window.requestAnimationFrame(updateInlineSuggestionPosition);
    window.addEventListener("resize", updateInlineSuggestionPosition);
    window.addEventListener("scroll", updateInlineSuggestionPosition, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateInlineSuggestionPosition);
      window.removeEventListener(
        "scroll",
        updateInlineSuggestionPosition,
        true,
      );
    };
  }, [draftText, showInlineSuggestions]);

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
    onInlineEditOpenChange?.(false, "cancel");
    window.requestAnimationFrame(() => {
      inlineHandlingRef.current = null;
      triggerRef.current?.focus();
    });
  };

  const handleInlineKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (tagSuggestionOpen && tagSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setTagSuggestionIndex((i) =>
          i < 0 ? 0 : (i + 1) % tagSuggestions.length,
        );
        return;
      }
      if (e.key === "ArrowUp" && tagSuggestionIndex >= 0) {
        e.preventDefault();
        setTagSuggestionIndex((i) =>
          i <= 0 ? tagSuggestions.length - 1 : i - 1,
        );
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && tagSuggestionIndex >= 0)) {
        e.preventDefault();
        applyTagSuggestion(
          tagSuggestions[tagSuggestionIndex] ?? tagSuggestions[0],
        );
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setTagSuggestionOpen(false);
        setTagSuggestionIndex(-1);
        return;
      }
    }

    if (e.key === "Backspace" && e.currentTarget.value === "") {
      e.preventDefault();
      applyInlineEdit(false);
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
    if (
      !e.ctrlKey &&
      !e.altKey &&
      (e.key === "ArrowUp" || e.key === "ArrowDown")
    ) {
      e.preventDefault();
      applyInlineEdit(false);
      onRequestVerticalNavigation?.(e.key === "ArrowUp" ? "up" : "down");
      return;
    }
    // if (handleExpressionShortcut(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      if (inlineHandlingRef.current !== null) return;
      inlineHandlingRef.current = "apply";
      emitChange(draftText, draftWeight, draftExpression);
      onInlineEditOpenChange?.(false, "stay");
      window.requestAnimationFrame(() => {
        inlineHandlingRef.current = null;
        triggerRef.current?.focus();
      });
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
    if (inlineHandlingRef.current !== null || selectingTagSuggestionRef.current)
      return;
    applyInlineEdit(false);
  };

  // TODO: 프롬프트 강조 문법 깨짐 감지 표시가 TokenChip상태에선 좀 완벽하진 않다. 예를 들어 앞에서 시작된 깨짐인데 뒤의 토큰에 엉뚱하게 전염됨. 추후 개선
  const weighted = Math.abs(token.weight - 1.0) > 0.001;
  const emphasisSyntaxIssue =
    syntaxIssueKind ?? getPromptEmphasisSyntaxIssueKind(raw);
  const hasEmphasisSyntaxIssue = emphasisSyntaxIssue !== null;
  const chipClass = cn(
    "px-1.5 py-1 text-xs rounded border border-border/40 transition-colors cursor-text hover:brightness-105",
    hasEmphasisSyntaxIssue
      ? "border-destructive/55 bg-destructive/16 text-destructive"
      : weighted
        ? getPromptWeightToneClass(token.weight)
        : "bg-muted text-foreground/80",
    copied && "ring-1 ring-primary/50 text-primary",
  );
  const syntaxWarningMessage = hasEmphasisSyntaxIssue
    ? emphasisSyntaxIssue === "invalidExplicitWeight"
      ? t("tokenChip.syntax.invalidExplicitWeight")
      : t("tokenChip.syntax.invalidBracketEmphasis")
    : null;

  const previewRawToken =
    draftExpression === "keyword"
      ? buildKeywordRaw(draftText.trim(), draftWeight)
      : buildNumericalRaw(draftText.trim(), draftWeight);

  const resetDraft = () => {
    setDraftText(token.text);
    setDraftWeight(clampWeight(token.weight));
    setDraftExpression(inferWeightExpression(token));
  };

  const applyTagSuggestion = (suggestion: PromptTagSuggestion) => {
    suppressTagSuggestOnceRef.current = true;
    setDraftText(suggestion.tag);
    setTagSuggestions([]);
    setTagSuggestionOpen(false);
    setTagSuggestionIndex(-1);
    window.requestAnimationFrame(() => {
      if (inlineEditOpen) {
        inlineInputRef.current?.focus();
        return;
      }
      if (resolvedEditorOpen) {
        editorInputRef.current?.focus();
      }
    });
  };

  const handleTagSuggestionMouseDown = (
    e: ReactMouseEvent<HTMLButtonElement>,
    suggestion: PromptTagSuggestion,
  ) => {
    e.preventDefault();
    selectingTagSuggestionRef.current = true;
    applyTagSuggestion(suggestion);
    window.requestAnimationFrame(() => {
      selectingTagSuggestionRef.current = false;
    });
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
    setEditorOpenState(false, advance ? "advance" : "apply");
  };

  const cancelEditing = () => {
    resetDraft();
    setEditorOpenState(false, "cancel");
  };

  const stepWeight = (delta: number) => {
    setDraftWeight((prev) => {
      const stepped = prev + delta;
      return clampWeight(Math.round(stepped * 10) / 10);
    });
  };

  // const handleExpressionShortcut = (
  //   e: ReactKeyboardEvent<HTMLElement>,
  // ): boolean => {
  //   if (!e.altKey || e.ctrlKey) return false;
  //   if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return false;
  //   e.preventDefault();
  //   setDraftExpression(e.key === "ArrowUp" ? "keyword" : "numerical");
  //   return true;
  // };

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
    if (tagSuggestionOpen && tagSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setTagSuggestionIndex((i) =>
          i < 0 ? 0 : (i + 1) % tagSuggestions.length,
        );
        return;
      }
      if (e.key === "ArrowUp" && tagSuggestionIndex >= 0) {
        e.preventDefault();
        setTagSuggestionIndex((i) =>
          i <= 0 ? tagSuggestions.length - 1 : i - 1,
        );
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && tagSuggestionIndex >= 0)) {
        e.preventDefault();
        applyTagSuggestion(
          tagSuggestions[tagSuggestionIndex] ?? tagSuggestions[0],
        );
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setTagSuggestionOpen(false);
        setTagSuggestionIndex(-1);
        return;
      }
    }

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
    // handleExpressionShortcut(e);
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
    // handleExpressionShortcut(e);
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
          title={syntaxWarningMessage ?? undefined}
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
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            className="bg-transparent outline-none text-xs min-w-[2ch]"
            size={Math.max(2, draftText.length + 1)}
          />
          {inlineWeighted ? (
            <span className="shrink-0 text-[10px] font-mono text-foreground/60">
              {draftWeight < 0
                ? `${formatWeight(draftWeight)}x`
                : `x${formatWeight(draftWeight)}`}
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
          title={syntaxWarningMessage ?? undefined}
          onClick={handleTrigger}
          onDoubleClick={() => {
            if (isEditable) onInlineEditOpenChange?.(true);
          }}
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
          {hasEmphasisSyntaxIssue ? (
            <TriangleAlert
              data-token-syntax-warning=""
              aria-hidden="true"
              className="h-3 w-3 shrink-0 text-destructive"
            />
          ) : null}
          {weighted ? (
            <span className="shrink-0 text-[10px] font-mono text-foreground/60">
              {token.weight < 0
                ? `${formatWeight(token.weight)}x`
                : `x${formatWeight(token.weight)}`}
            </span>
          ) : null}
          {copied ? <Copy className="h-3 w-3 shrink-0" /> : null}
        </div>
      )}
    </div>
  );

  const inlineSuggestionDropdown =
    showInlineSuggestions && typeof document !== "undefined"
      ? createPortal(
          <div
            style={
              inlineSuggestionStyle ?? {
                position: "fixed",
                top: 8,
                left: 8,
                width: 288,
                zIndex: 3200,
                visibility: "hidden",
              }
            }
            className="max-h-56 overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-popover shadow-lg"
          >
            {tagSuggestions.map((suggestion, index) => (
              <button
                key={`${suggestion.tag}-${suggestion.count}`}
                type="button"
                onMouseDown={(e) => handleTagSuggestionMouseDown(e, suggestion)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors",
                  index === tagSuggestionIndex
                    ? "bg-primary/15 text-primary"
                    : "text-foreground/85 hover:bg-secondary",
                )}
              >
                <span className="truncate">{suggestion.tag}</span>
                <PromptTagSuggestionIndicator
                  count={suggestion.count}
                  bucketThresholds={tagSuggestionStats.bucketThresholds}
                />
              </button>
            ))}
          </div>,
          document.body,
        )
      : null;

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
                {t("tokenChip.editor.tag")}
              </label>
              <div className="relative">
                <input
                  ref={editorInputRef}
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  onKeyDown={handleTagInputKeyDown}
                  placeholder={t("tokenChip.editor.tagPlaceholder")}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="h-8 w-full rounded border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary/60"
                />
                {tagSuggestionOpen && tagSuggestions.length > 0 ? (
                  <div className="absolute top-full left-0 z-40 mt-1 max-h-56 w-full overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-popover shadow-lg">
                    {tagSuggestions.map((suggestion, index) => (
                      <button
                        key={`${suggestion.tag}-${suggestion.count}`}
                        type="button"
                        onMouseDown={(e) =>
                          handleTagSuggestionMouseDown(e, suggestion)
                        }
                        className={cn(
                          "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors",
                          index === tagSuggestionIndex
                            ? "bg-primary/15 text-primary"
                            : "text-foreground/85 hover:bg-secondary",
                        )}
                      >
                        <span className="truncate">{suggestion.tag}</span>
                        <PromptTagSuggestionIndicator
                          count={suggestion.count}
                          bucketThresholds={tagSuggestionStats.bucketThresholds}
                        />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t("tokenChip.editor.emphasis")}
                </label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => stepWeight(-0.1)}
                    disabled={draftWeight <= MIN_WEIGHT}
                    className="h-5 w-5 flex items-center justify-center rounded border border-border/50 text-muted-foreground hover:text-foreground hover:border-border disabled:opacity-30 transition-colors"
                  >
                    <Minus className="h-2.5 w-2.5" />
                  </button>
                  <span className="text-[10px] font-mono text-foreground/80 w-7 text-center tabular-nums">
                    {formatWeight(draftWeight)}
                  </span>
                  <button
                    type="button"
                    onClick={() => stepWeight(0.1)}
                    disabled={draftWeight >= MAX_WEIGHT}
                    className="h-5 w-5 flex items-center justify-center rounded border border-border/50 text-muted-foreground hover:text-foreground hover:border-border disabled:opacity-30 transition-colors"
                  >
                    <Plus className="h-2.5 w-2.5" />
                  </button>
                </div>
              </div>
              <input
                type="range"
                min={MIN_WEIGHT}
                max={MAX_WEIGHT}
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
                {t("tokenChip.editor.expression")}
              </p>
              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-1.5 text-xs text-foreground/80">
                  <input
                    type="radio"
                    name={radioName}
                    checked={draftExpression === "numerical"}
                    onChange={() => setDraftExpression("numerical")}
                  />
                  {t("tokenChip.editor.numerical")}
                </label>
                <label className="inline-flex items-center gap-1.5 text-xs text-foreground/80">
                  <input
                    type="radio"
                    name={radioName}
                    checked={draftExpression === "keyword"}
                    onChange={() => setDraftExpression("keyword")}
                  />
                  {t("tokenChip.editor.keyword")}
                </label>
              </div>
            </div>

            <div className="mt-2.5 space-y-1.5">
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">
                {t("tokenChip.editor.rawToken")}
              </label>
              <input
                value={previewRawToken}
                readOnly
                className="h-8 w-full rounded border border-border bg-background px-2 font-mono text-[11px] text-foreground/80 outline-none"
              />
            </div>

            <div className="mt-3 flex items-center justify-between gap-1.5">
              {onDelete ? (
                <button
                  type="button"
                  className="h-7 w-7 rounded border border-destructive/40 text-destructive/70 hover:bg-destructive/10 hover:text-destructive flex items-center justify-center transition-colors"
                  onClick={() => {
                    setEditorOpenState(false);
                    onDelete();
                  }}
                  title={t("common.delete")}
                  aria-label={t("common.delete")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="h-7 rounded border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={cancelEditing}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="h-7 rounded border border-primary/50 bg-primary/10 px-2 text-[11px] text-primary hover:bg-primary/20"
                  onClick={() => applyEditing(false)}
                >
                  {t("tokenChip.editor.apply")}
                </button>
              </div>
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
              {t("tokenChip.context.addToSearch")}
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => onAddTagToGeneration?.(contextMenuTag)}
              disabled={!onAddTagToGeneration}
            >
              <ImagePlus className="h-4 w-4" />
              {t("tokenChip.context.addToGeneration")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        chip
      )}
      {inlineSuggestionDropdown}
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
