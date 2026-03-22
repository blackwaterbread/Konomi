import {
  Fragment,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import {
  findPromptEmphasisHighlightRanges,
  findPromptEmphasisSyntaxIssues,
  type PromptEmphasisSyntaxIssueKind,
} from "@/lib/prompt-emphasis-syntax";
import type { AnyToken, PromptToken, WildcardToken } from "@/lib/token";
import {
  parsePromptTokens,
  parseRawToken,
  tokenToRawString,
  isGroupRef,
  isWildcard,
} from "@/lib/token";
import { getPromptWeightRawHighlightClass } from "@/lib/prompt-weight-style";
import type {
  PromptGroup,
  PromptTagSuggestion,
  PromptTagSuggestStats,
} from "@preload/index.d";
import { TokenChip } from "./token-chip";
import { GroupChip } from "./group-chip";
import { WildcardChip } from "./wildcard-chip";
import { PromptTagSuggestionIndicator } from "./prompt-tag-suggestion-indicator";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

type EditableToken = AnyToken & { id: string };
type RawHistoryEntry = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};
const INPUT_WRAP_SPACE_THRESHOLD_PX = 120;
const INPUT_WRAP_CARET_BUFFER_PX = 18;
const INPUT_WRAP_TOKEN_GAP_PX = 6;

const DRAG_TOKEN_MIME = "application/x-konomi-token";
const TAG_SUGGEST_LIMIT = 8;
const EMPTY_PROMPT_TAG_SUGGEST_STATS: PromptTagSuggestStats = {
  totalTags: 0,
  maxCount: 0,
  bucketThresholds: [],
};
const EMPTY_RAW_CONTEXT_MENU_STATE = {
  hasSelection: false,
  hasValue: false,
};

interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  displayMode?: "chips" | "raw";
  resizable?: boolean;
  minHeight?: number;
  maxHeight?: number;
  groups?: PromptGroup[];
  allowExternalDrop?: boolean;
}

function createTokenId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `tok-${Math.random().toString(36).slice(2, 10)}`;
}

function toEditableTokens(tokens: AnyToken[]): EditableToken[] {
  return tokens
    .filter(
      (token) =>
        isGroupRef(token) || isWildcard(token) || token.text.trim().length > 0,
    )
    .map((token) => ({ ...token, id: createTokenId() }));
}

function createEditableTokenFromChunk(chunk: string): EditableToken | null {
  const normalizedChunk = chunk.trim();
  if (!normalizedChunk) return null;
  const raw =
    normalizedChunk.includes("|") && !normalizedChunk.startsWith("%{")
      ? `%{${normalizedChunk}}`
      : normalizedChunk;
  return {
    ...parseRawToken(raw),
    id: createTokenId(),
  } as EditableToken;
}

function serializePrompt(tokens: EditableToken[], draft: string): string {
  const tokenText = tokens
    .filter(
      (token) =>
        isGroupRef(token) || isWildcard(token) || token.text.trim().length > 0,
    )
    .map((token) => tokenToRawString(token))
    .join(", ");
  const cleanDraft = draft.trim();
  if (!cleanDraft) return tokenText;
  return tokenText ? `${tokenText}, ${cleanDraft}` : cleanDraft;
}

function appendPromptChunk(prompt: string, chunk: string): string {
  const cleanChunk = chunk.trim();
  if (!cleanChunk) return prompt;
  const cleanPrompt = prompt.trim();
  return cleanPrompt ? `${cleanPrompt}, ${cleanChunk}` : cleanChunk;
}

function serializeExternalDrop(data: string): string | null {
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    if (parsed.kind === "group" && typeof parsed.groupName === "string") {
      return tokenToRawString({
        kind: "group",
        groupName: parsed.groupName,
        ...(Array.isArray(parsed.overrideTags)
          ? { overrideTags: parsed.overrideTags as string[] }
          : {}),
      });
    }

    if (typeof parsed.text === "string") {
      if (typeof parsed.raw === "string") return parsed.raw;
      return tokenToRawString({
        text: parsed.text,
        weight: typeof parsed.weight === "number" ? parsed.weight : 1,
      });
    }
  } catch {
    // ignore invalid data
  }

  return null;
}

function rangesOverlap(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): boolean {
  return leftStart < rightEnd && rightStart < leftEnd;
}

export const PromptInput = memo(function PromptInput({
  value,
  onChange,
  placeholder,
  className,
  displayMode = "chips",
  resizable = true,
  minHeight = 112,
  maxHeight = 420,
  groups: groupsProp,
  allowExternalDrop = false,
}: PromptInputProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t("promptInput.placeholder");
  const rawInputRef = useRef<HTMLTextAreaElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputAnchorRef = useRef<HTMLDivElement | null>(null);
  const measureCanvasContextRef = useRef<CanvasRenderingContext2D | null>(null);
  const tokenRowRef = useRef<HTMLDivElement | null>(null);
  const tokenRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const inlineEditTokenIdRef = useRef<string | null>(null);
  const chipCursorIndexRef = useRef<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const undoStackRef = useRef<{ tokens: EditableToken[]; draft: string }[]>([]);
  const isUndoingRef = useRef(false);
  const pendingControlledValueRef = useRef<string | null>(null);
  const rawUndoStackRef = useRef<RawHistoryEntry[]>([]);
  const rawRedoStackRef = useRef<RawHistoryEntry[]>([]);
  const rawSnapshotRef = useRef<RawHistoryEntry>({
    value,
    selectionStart: value.length,
    selectionEnd: value.length,
  });
  const lastRawEmittedRef = useRef<string>(value);

  const [externalDragOver, setExternalDragOver] = useState(false);
  const [tokens, setTokens] = useState<EditableToken[]>(() =>
    toEditableTokens(parsePromptTokens(value)),
  );
  const [draft, setDraft] = useState("");
  const [inlineEditTokenId, setInlineEditTokenId] = useState<string | null>(
    null,
  );
  const [popoverTokenId, setPopoverTokenId] = useState<string | null>(null);
  // When set, new tokens from the draft are inserted at this index (instead of appended).
  // Also controls where the input element is rendered in the chip list.
  const [insertIndex, setInsertIndex] = useState<number | null>(null);
  const [chipCursorIndex, setChipCursorIndex] = useState<number | null>(null);
  const [shouldWrapInput, setShouldWrapInput] = useState(false);
  const [tokenRowWidth, setTokenRowWidth] = useState(0);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [showTrailingEmptyInput, setShowTrailingEmptyInput] = useState(true);
  const [autocompleteStyle, setAutocompleteStyle] =
    useState<CSSProperties | null>(null);
  const isRawMode = displayMode === "raw";

  // @ group autocomplete
  const [groups, setGroups] = useState<PromptGroup[]>(groupsProp ?? []);
  const [groupDropdownOpen, setGroupDropdownOpen] = useState(false);
  const [groupSearch, setGroupSearch] = useState("");
  const [groupDropdownIndex, setGroupDropdownIndex] = useState(0);
  const [tagSuggestions, setTagSuggestions] = useState<PromptTagSuggestion[]>(
    [],
  );
  const [tagSuggestionStats, setTagSuggestionStats] =
    useState<PromptTagSuggestStats>(EMPTY_PROMPT_TAG_SUGGEST_STATS);
  const [tagSuggestionOpen, setTagSuggestionOpen] = useState(false);
  const [tagSuggestionIndex, setTagSuggestionIndex] = useState(-1);
  const [rawContextMenuState, setRawContextMenuState] = useState(
    EMPTY_RAW_CONTEXT_MENU_STATE,
  );
  const [rawScrollPosition, setRawScrollPosition] = useState({
    top: 0,
    left: 0,
  });
  const tagSuggestDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const tagSuggestRequestSeqRef = useRef(0);

  useEffect(() => {
    if (groupsProp !== undefined) {
      setGroups(groupsProp);
      return;
    }
    window.promptBuilder
      .listCategories()
      .then((cs) => setGroups(cs.flatMap((c) => c.groups)))
      .catch(() => {});
  }, [groupsProp]);

  useEffect(
    () => () => {
      if (tagSuggestDebounceRef.current) {
        clearTimeout(tagSuggestDebounceRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (value === rawSnapshotRef.current.value) {
      return;
    }

    rawSnapshotRef.current = {
      value,
      selectionStart: Math.min(rawSnapshotRef.current.selectionStart, value.length),
      selectionEnd: Math.min(rawSnapshotRef.current.selectionEnd, value.length),
    };

    if (value !== lastRawEmittedRef.current) {
      rawUndoStackRef.current = [];
      rawRedoStackRef.current = [];
    }

    lastRawEmittedRef.current = value;
  }, [value]);

  const filteredGroups = useMemo(
    () =>
      groups.filter((g) =>
        g.name.toLowerCase().includes(groupSearch.toLowerCase()),
      ),
    [groups, groupSearch],
  );
  const showGroupDropdown =
    !isRawMode && groupDropdownOpen && filteredGroups.length > 0;
  const showTagSuggestionDropdown =
    !isRawMode &&
    !groupDropdownOpen &&
    tagSuggestionOpen &&
    tagSuggestions.length > 0;
  const tokenSyntaxIssueByIndex = useMemo(() => {
    if (isRawMode) return new Map<number, PromptEmphasisSyntaxIssueKind>();
    const issues = findPromptEmphasisSyntaxIssues(value);
    if (issues.length === 0) {
      return new Map<number, PromptEmphasisSyntaxIssueKind>();
    }

    const mapped = new Map<number, PromptEmphasisSyntaxIssueKind>();
    let searchStartIndex = 0;

    issues.forEach((issue) => {
      const anchorText = issue.anchorText.trim();
      if (!anchorText) return;

      for (let index = searchStartIndex; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (isGroupRef(token) || isWildcard(token)) continue;
        if (token.text.trim() !== anchorText) continue;
        mapped.set(index, issue.kind);
        searchStartIndex = index + 1;
        break;
      }
    });

    return mapped;
  }, [isRawMode, tokens, value]);
  const rawSyntaxIssueRanges = useMemo(
    () =>
      isRawMode
        ? findPromptEmphasisSyntaxIssues(value).map(({ start, end }) => ({
            start,
            end,
          }))
        : [],
    [isRawMode, value],
  );
  const rawHighlightRanges = useMemo(
    () =>
      isRawMode
        ? findPromptEmphasisHighlightRanges(value).filter(
            (range) =>
              !rawSyntaxIssueRanges.some((issue) =>
                rangesOverlap(range.start, range.end, issue.start, issue.end),
              ),
          )
        : [],
    [isRawMode, rawSyntaxIssueRanges, value],
  );

  const promptTagExclusions = useMemo(
    () =>
      tokens
        .filter(
          (token): token is EditableToken & PromptToken =>
            !isGroupRef(token) && !isWildcard(token),
        )
        .map((token) => token.text.trim())
        .filter(Boolean),
    [tokens],
  );

  useEffect(() => {
    if (isRawMode || groupDropdownOpen) {
      setTagSuggestions([]);
      setTagSuggestionStats(EMPTY_PROMPT_TAG_SUGGEST_STATS);
      setTagSuggestionOpen(false);
      setTagSuggestionIndex(-1);
      if (tagSuggestDebounceRef.current) {
        clearTimeout(tagSuggestDebounceRef.current);
        tagSuggestDebounceRef.current = null;
      }
      return;
    }

    const prefix = draft.trim();
    if (!prefix) {
      setTagSuggestions([]);
      setTagSuggestionStats(EMPTY_PROMPT_TAG_SUGGEST_STATS);
      setTagSuggestionOpen(false);
      setTagSuggestionIndex(-1);
      if (tagSuggestDebounceRef.current) {
        clearTimeout(tagSuggestDebounceRef.current);
        tagSuggestDebounceRef.current = null;
      }
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
          exclude: promptTagExclusions,
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
  }, [draft, groupDropdownOpen, promptTagExclusions, isRawMode]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const serialized = useMemo(
    () => serializePrompt(tokens, draft),
    [tokens, draft],
  );

  useLayoutEffect(() => {
    if (isRawMode) return;
    if (value === serialized) return;
    if (pendingControlledValueRef.current !== null) {
      if (value === pendingControlledValueRef.current) {
        pendingControlledValueRef.current = null;
        return;
      }
      pendingControlledValueRef.current = null;
    }
    setTokens(toEditableTokens(parsePromptTokens(value)));
    setDraft("");
  }, [isRawMode, value, serialized]);

  useEffect(() => {
    if (!isRawMode) return;
    if (value === serialized) return;
    if (pendingControlledValueRef.current !== null) {
      if (value === pendingControlledValueRef.current) {
        pendingControlledValueRef.current = null;
        return;
      }
      pendingControlledValueRef.current = null;
    }
    setTokens(toEditableTokens(parsePromptTokens(value)));
    setDraft("");
  }, [isRawMode, value, serialized]);

  useEffect(() => {
    if (tokens.length === 0) {
      setShowTrailingEmptyInput(true);
    }
  }, [tokens.length]);

  useEffect(() => {
    inlineEditTokenIdRef.current = inlineEditTokenId;
  }, [inlineEditTokenId]);

  useEffect(() => {
    chipCursorIndexRef.current = chipCursorIndex;
  }, [chipCursorIndex]);

  useEffect(() => {
    setInlineEditTokenId((prev) =>
      prev && tokens.some((token) => token.id === prev) ? prev : null,
    );
    setPopoverTokenId((prev) =>
      prev && tokens.some((token) => token.id === prev) ? prev : null,
    );
  }, [tokens]);

  useEffect(() => {
    const tokenRow = tokenRowRef.current;
    if (!tokenRow) return;
    const updateTokenRowWidth = () => {
      const nextWidth = Math.floor(tokenRow.clientWidth);
      setTokenRowWidth((prev) => (prev === nextWidth ? prev : nextWidth));
    };
    const raf = window.requestAnimationFrame(updateTokenRowWidth);
    const observer = new ResizeObserver(updateTokenRowWidth);
    observer.observe(tokenRow);
    window.addEventListener("resize", updateTokenRowWidth);
    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", updateTokenRowWidth);
    };
  }, [tokens.length]);

  // Auto-focus input when it moves to cursor-insert position
  useEffect(() => {
    if (insertIndex === null) return;
    const raf = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(raf);
  }, [insertIndex]);

  useEffect(() => {
    if (tokens.length === 0 || insertIndex !== null) {
      setShouldWrapInput(false);
      return;
    }
    const tokenRow = tokenRowRef.current;
    const lastToken = tokenRefs.current.get(
      tokens[tokens.length - 1]?.id ?? "",
    );
    if (!tokenRow || !lastToken) {
      setShouldWrapInput(false);
      return;
    }
    const updateInputWrap = () => {
      const input = inputRef.current;
      if (!input) {
        setShouldWrapInput(false);
        return;
      }
      const rowRect = tokenRow.getBoundingClientRect();
      const lastTokenRect = lastToken.getBoundingClientRect();
      const remainingSpace = Math.max(
        0,
        rowRect.right - lastTokenRect.right - INPUT_WRAP_TOKEN_GAP_PX,
      );
      if (draft.length === 0) {
        setShouldWrapInput(false);
        return;
      }
      if (!measureCanvasContextRef.current) {
        const canvas = document.createElement("canvas");
        measureCanvasContextRef.current = canvas.getContext("2d");
      }
      const ctx = measureCanvasContextRef.current;
      if (!ctx) {
        setShouldWrapInput(remainingSpace <= INPUT_WRAP_SPACE_THRESHOLD_PX);
        return;
      }
      const inputStyle = window.getComputedStyle(input);
      const font =
        inputStyle.font ||
        `${inputStyle.fontWeight} ${inputStyle.fontSize} ${inputStyle.fontFamily}`;
      ctx.font = font;
      let textWidth = ctx.measureText(draft).width;
      const letterSpacing = Number.parseFloat(inputStyle.letterSpacing);
      if (Number.isFinite(letterSpacing) && draft.length > 1)
        textWidth += letterSpacing * (draft.length - 1);
      const requiredInlineWidth =
        Math.ceil(textWidth) + INPUT_WRAP_CARET_BUFFER_PX;
      const shouldWrap =
        remainingSpace <= INPUT_WRAP_SPACE_THRESHOLD_PX &&
        requiredInlineWidth > remainingSpace;
      setShouldWrapInput((prev) => (prev === shouldWrap ? prev : shouldWrap));
    };
    const raf = window.requestAnimationFrame(updateInputWrap);
    const observer = new ResizeObserver(updateInputWrap);
    observer.observe(tokenRow);
    observer.observe(lastToken);
    window.addEventListener("resize", updateInputWrap);
    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", updateInputWrap);
    };
  }, [draft, insertIndex, tokens]);

  useEffect(() => {
    if (!showGroupDropdown && !showTagSuggestionDropdown) {
      setAutocompleteStyle(null);
      return;
    }

    const updateAutocompletePosition = () => {
      const anchor = inputAnchorRef.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const desiredWidth = showGroupDropdown ? 176 : 288;
      const width = Math.min(desiredWidth, viewportWidth - 16);
      const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));

      setAutocompleteStyle({
        position: "fixed",
        top: rect.bottom + 4,
        left,
        width,
        zIndex: 3200,
      });
    };

    const raf = window.requestAnimationFrame(updateAutocompletePosition);
    window.addEventListener("resize", updateAutocompletePosition);
    window.addEventListener("scroll", updateAutocompletePosition, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateAutocompletePosition);
      window.removeEventListener("scroll", updateAutocompletePosition, true);
    };
  }, [
    draft,
    insertIndex,
    showGroupDropdown,
    showTagSuggestionDropdown,
    shouldWrapInput,
    tokens.length,
  ]);

  const emit = (nextTokens: EditableToken[], nextDraft: string) => {
    const currentSerialized = serializePrompt(tokens, draft);
    const nextSerialized = serializePrompt(nextTokens, nextDraft);
    const tokensChanged =
      nextTokens.length !== tokens.length ||
      nextTokens.some(
        (t, i) =>
          t.id !== tokens[i]?.id ||
          tokenToRawString(t) !== tokenToRawString(tokens[i]!),
      );
    if (!isUndoingRef.current && tokensChanged) {
      undoStackRef.current = [
        ...undoStackRef.current.slice(-49),
        { tokens, draft },
      ];
    }
    setTokens(nextTokens);
    setDraft(nextDraft);
    if (nextSerialized !== currentSerialized) {
      pendingControlledValueRef.current = nextSerialized;
      onChange(nextSerialized);
    }
  };

  const insertTokensAtCursor = (
    nextInsertedTokens: EditableToken[],
    nextDraft = "",
  ) => {
    if (nextInsertedTokens.length === 0) {
      emit(tokens, nextDraft);
      return;
    }
    const nextTokens =
      insertIndex !== null
        ? [
            ...tokens.slice(0, insertIndex),
            ...nextInsertedTokens,
            ...tokens.slice(insertIndex),
          ]
        : [...tokens, ...nextInsertedTokens];
    if (insertIndex !== null) {
      setInsertIndex(insertIndex + nextInsertedTokens.length);
    }
    emit(nextTokens, nextDraft);
  };

  const finalizeDraftAsToken = () => {
    const nextToken = createEditableTokenFromChunk(draft);
    if (!nextToken) return false;
    insertTokensAtCursor([nextToken]);
    setGroupDropdownOpen(false);
    setGroupSearch("");
    setTagSuggestions([]);
    setTagSuggestionStats(EMPTY_PROMPT_TAG_SUGGEST_STATS);
    setTagSuggestionOpen(false);
    setTagSuggestionIndex(-1);
    requestAnimationFrame(() => inputRef.current?.focus());
    return true;
  };

  const handleUndo = () => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const prev = stack[stack.length - 1];
    undoStackRef.current = stack.slice(0, -1);
    isUndoingRef.current = true;
    setTokens(prev.tokens);
    setDraft(prev.draft);
    const undoSerialized = serializePrompt(prev.tokens, prev.draft);
    pendingControlledValueRef.current = undoSerialized;
    onChange(undoSerialized);
    isUndoingRef.current = false;
  };

  const insertGroupToken = (groupName: string) => {
    const groupToken: EditableToken = {
      kind: "group",
      groupName,
      id: createTokenId(),
    };
    insertTokensAtCursor([groupToken]);
    setGroupDropdownOpen(false);
    setGroupSearch("");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const applyTagSuggestion = (suggestion: PromptTagSuggestion) => {
    const nextToken = createEditableTokenFromChunk(suggestion.tag);
    if (!nextToken) return;
    insertTokensAtCursor([nextToken]);
    setTagSuggestions([]);
    setTagSuggestionStats(EMPTY_PROMPT_TAG_SUGGEST_STATS);
    setTagSuggestionOpen(false);
    setTagSuggestionIndex(-1);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleDraftChange = (nextValue: string) => {
    // Detect @{ prefix for group autocomplete
    const groupPrefixMatch = nextValue.match(/^@\{([^}]*)$/);
    if (groupPrefixMatch) {
      setGroupSearch(groupPrefixMatch[1]);
      setGroupDropdownOpen(true);
      setGroupDropdownIndex(0);
      emit(tokens, nextValue);
      return;
    }

    // Check if a complete @{...} was typed (closing })
    const completeGroupMatch = nextValue.match(/^@\{([^}]+)\}$/);
    if (completeGroupMatch) {
      insertGroupToken(completeGroupMatch[1]);
      return;
    }

    setGroupDropdownOpen(false);

    if (!nextValue.includes(",")) {
      emit(tokens, nextValue);
      return;
    }

    const chunks = nextValue.split(",");
    const completedChunks = chunks.slice(0, -1).map((chunk) => chunk.trim());
    const nextDraft = chunks.at(-1)?.replace(/^\s+/, "") ?? "";
    const finalized = completedChunks.filter((chunk) => chunk.length > 0);

    if (finalized.length === 0) {
      emit(tokens, nextDraft);
      return;
    }

    const newTokens = finalized
      .map((chunk) => createEditableTokenFromChunk(chunk))
      .filter((token): token is EditableToken => token !== null);
    insertTokensAtCursor(newTokens, nextDraft);
  };

  const handleTokenChange = (id: string, nextToken: PromptToken) => {
    const nextTokens = tokens
      .map((token) => (token.id === id ? { ...nextToken, id } : token))
      .filter(
        (token) =>
          isGroupRef(token) ||
          isWildcard(token) ||
          token.text.trim().length > 0,
      );
    emit(nextTokens, draft);
  };

  const handleWildcardChange = (id: string, nextToken: WildcardToken) => {
    const nextTokens = tokens.map((token) =>
      token.id === id ? { ...nextToken, id } : token,
    );
    emit(nextTokens, draft);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tokens.findIndex((token) => token.id === active.id);
    const newIndex = tokens.findIndex((token) => token.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    emit(arrayMove(tokens, oldIndex, newIndex), draft);
  };

  const setTokenRef = (id: string, node: HTMLDivElement | null) => {
    if (!node) {
      tokenRefs.current.delete(id);
      return;
    }
    tokenRefs.current.set(id, node);
  };

  const focusInput = (cursor: "start" | "end" = "end") => {
    setInlineEditTokenId(null);
    setPopoverTokenId(null);
    setChipCursorIndex(null);
    setInsertIndex(null);
    setShowTrailingEmptyInput(true);
    // RAF so the input re-mounts at end position before we focus it
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      const pos = cursor === "start" ? 0 : input.value.length;
      input.setSelectionRange(pos, pos);
    });
  };

  const focusInputAtIndex = (
    index: number,
    nextTokensArg = tokens,
    cursor: "start" | "end" = "end",
  ) => {
    const clampedIndex = Math.max(0, Math.min(index, nextTokensArg.length));
    setInlineEditTokenId(null);
    setPopoverTokenId(null);
    setChipCursorIndex(null);
    setInsertIndex(clampedIndex);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      const pos = cursor === "start" ? 0 : input.value.length;
      input.setSelectionRange(pos, pos);
    });
  };

  const removeTokenAtIndex = (index: number) => {
    const nextTokens = tokens.filter((_, i) => i !== index);
    emit(nextTokens, draft);
    focusInputAtIndex(index, nextTokens);
  };

  const focusTokenAtIndex = (index: number) => {
    const token = tokens[index];
    if (!token) return;
    if (isGroupRef(token) || isWildcard(token)) {
      setInlineEditTokenId(null);
      setChipCursorIndex(index);
      tokenRefs.current.get(token.id)?.focus();
    } else {
      setChipCursorIndex(null);
      setInlineEditTokenId(token.id);
    }
  };

  const focusChipCursorAtIndex = (index: number) => {
    const token = tokens[index];
    if (!token) return;
    setInlineEditTokenId(null);
    setChipCursorIndex(index);
    requestAnimationFrame(() => {
      tokenRefs.current.get(token.id)?.focus();
    });
  };

  const dismissEmptyDraftInput = () => {
    if (draft.trim().length > 0) return;
    if (draft.length > 0) {
      setDraft("");
    }
    setInsertIndex(null);
    if (tokens.length > 0) {
      setShowTrailingEmptyInput(false);
    }
  };

  const cancelComposingToken = () => {
    const targetIndex =
      insertIndex !== null ? insertIndex - 1 : tokens.length - 1;
    setGroupDropdownOpen(false);
    setGroupSearch("");
    setTagSuggestions([]);
    setTagSuggestionOpen(false);
    setTagSuggestionIndex(-1);
    if (draft.length > 0) {
      emit(tokens, "");
    } else {
      setDraft("");
    }
    if (tokens.length > 0) {
      setShowTrailingEmptyInput(false);
    }
    setInsertIndex(null);
    if (targetIndex >= 0) {
      focusChipCursorAtIndex(targetIndex);
      return;
    }
    requestAnimationFrame(() => inputRef.current?.blur());
  };

  const handleInputBlur = () => {
    setIsInputFocused(false);
    requestAnimationFrame(() => {
      if (document.activeElement === inputRef.current) return;
      dismissEmptyDraftInput();
    });
    setTimeout(() => {
      setGroupDropdownOpen(false);
      setTagSuggestionOpen(false);
    }, 150);
  };

  const handleContainerMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    focusInput("end");
  };

  const handleInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelComposingToken();
      return;
    }

    // Group dropdown navigation
    if (groupDropdownOpen && filteredGroups.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setGroupDropdownIndex((i) =>
          Math.min(i + 1, filteredGroups.length - 1),
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setGroupDropdownIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const selected = filteredGroups[groupDropdownIndex];
        if (selected) insertGroupToken(selected.name);
        return;
      }
    }

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
    }

    if (
      !groupDropdownOpen &&
      draft.trim().length > 0 &&
      (e.key === "Enter" || e.key === "Tab")
    ) {
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      finalizeDraftAsToken();
      return;
    }

    if (e.key === "ArrowLeft") {
      const atStart =
        (e.currentTarget.selectionStart ?? 0) === 0 &&
        (e.currentTarget.selectionEnd ?? 0) === 0;
      if (atStart && tokens.length > 0) {
        e.preventDefault();
        const targetIndex =
          insertIndex !== null ? insertIndex - 1 : tokens.length - 1;
        if (targetIndex >= 0) {
          setInsertIndex(null);
          focusTokenAtIndex(targetIndex);
        }
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      if (draft.length > 0) {
        setDraft("");
        const cleared = serializePrompt(tokens, "");
        pendingControlledValueRef.current = cleared;
        onChange(cleared);
      } else {
        handleUndo();
      }
      return;
    }

    if (e.key === "Backspace" && draft.length === 0 && tokens.length > 0) {
      e.preventDefault();
      cancelComposingToken();
    }
  };

  const handleInputPaste = (e: ReactClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text/plain").trim();
    if (!pasted) return;
    const pastedTokens = toEditableTokens(parsePromptTokens(pasted));
    if (pastedTokens.length === 0) return;
    e.preventDefault();
    const draftToken = draft.trim()
      ? [{ ...parseRawToken(draft.trim()), id: createTokenId() }]
      : [];
    const toInsert = [...draftToken, ...pastedTokens];
    insertTokensAtCursor(toInsert);
  };

  const navigateVertical = (direction: "up" | "down", fromIndex: number) => {
    const currentToken = tokens[fromIndex];
    if (!currentToken) return;
    const currentNode = tokenRefs.current.get(currentToken.id);
    if (!currentNode) return;

    const currentRect = currentNode.getBoundingClientRect();
    const cursorX = currentRect.right;
    const currentCenterY = (currentRect.top + currentRect.bottom) / 2;
    const lineThreshold = Math.max(currentRect.height / 2, 8);

    const chipData = tokens
      .map((token, i) => {
        const node = tokenRefs.current.get(token.id);
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return { index: i, rect, centerY: (rect.top + rect.bottom) / 2 };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const candidates = chipData.filter(({ centerY }) =>
      direction === "up"
        ? centerY < currentCenterY - lineThreshold
        : centerY > currentCenterY + lineThreshold,
    );

    if (candidates.length === 0) {
      if (direction === "down") focusInput("end");
      return;
    }

    const targetCenterY =
      direction === "up"
        ? Math.max(...candidates.map((c) => c.centerY))
        : Math.min(...candidates.map((c) => c.centerY));

    const lineChips = candidates.filter(
      ({ centerY }) => Math.abs(centerY - targetCenterY) <= lineThreshold,
    );

    const best = lineChips.reduce((prev, curr) =>
      Math.abs(curr.rect.right - cursorX) < Math.abs(prev.rect.right - cursorX)
        ? curr
        : prev,
    );

    focusTokenAtIndex(best.index);
  };

  const handleTokenKeyDown = (
    e: ReactKeyboardEvent<HTMLDivElement>,
    index: number,
  ) => {
    // Printable key while chip cursor is active → start typing at this position
    if (
      chipCursorIndex === index &&
      e.key.length === 1 &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      e.preventDefault();
      setInsertIndex(index + 1);
      setChipCursorIndex(null);
      emit(tokens, e.key);
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      navigateVertical(e.key === "ArrowUp" ? "up" : "down", index);
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      const currentToken = tokens[index];
      if (
        currentToken &&
        !isGroupRef(currentToken) &&
        chipCursorIndex === index
      )
        focusTokenAtIndex(index);
      else if (index > 0) focusTokenAtIndex(index - 1);
      else focusInput("start");
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      if (index < tokens.length - 1) focusTokenAtIndex(index + 1);
      else focusInput("start");
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      removeTokenAtIndex(index);
    }
  };

  const handleRawDrop = (data: string) => {
    const droppedText = serializeExternalDrop(data);
    if (!droppedText) return;
    const nextValue = appendPromptChunk(value, droppedText);
    rawUndoStackRef.current = [
      ...rawUndoStackRef.current.slice(-49),
      rawSnapshotRef.current,
    ];
    rawRedoStackRef.current = [];
    rawSnapshotRef.current = {
      value: nextValue,
      selectionStart: nextValue.length,
      selectionEnd: nextValue.length,
    };
    lastRawEmittedRef.current = nextValue;
    onChange(nextValue);
    requestAnimationFrame(() => {
      const textarea = rawInputRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(nextValue.length, nextValue.length);
    });
  };

  const queueRawSelection = (start: number, end = start) => {
    window.requestAnimationFrame(() => {
      const textarea = rawInputRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(start, end);
    });
  };

  const getRawSelection = () => {
    const textarea = rawInputRef.current;
    if (!textarea) return null;
    const selectionStart = textarea.selectionStart ?? 0;
    const selectionEnd = textarea.selectionEnd ?? selectionStart;
    return {
      currentValue: textarea.value,
      selectionStart,
      selectionEnd,
      selectedText: textarea.value.slice(selectionStart, selectionEnd),
    };
  };

  const syncRawSnapshot = () => {
    const selection = getRawSelection();
    if (!selection) return null;
    const nextSnapshot: RawHistoryEntry = {
      value: selection.currentValue,
      selectionStart: selection.selectionStart,
      selectionEnd: selection.selectionEnd,
    };
    rawSnapshotRef.current = nextSnapshot;
    return nextSnapshot;
  };

  const syncRawContextMenuState = () => {
    const snapshot = syncRawSnapshot();
    if (!snapshot) {
      setRawContextMenuState({
        hasSelection: false,
        hasValue: value.length > 0,
      });
      return;
    }
    setRawContextMenuState({
      hasSelection: snapshot.selectionStart !== snapshot.selectionEnd,
      hasValue: snapshot.value.length > 0,
    });
  };

  const commitRawValue = (
    nextValue: string,
    selection = { start: nextValue.length, end: nextValue.length },
    currentSnapshot = rawSnapshotRef.current,
  ) => {
    if (nextValue === currentSnapshot.value) {
      rawSnapshotRef.current = {
        value: nextValue,
        selectionStart: selection.start,
        selectionEnd: selection.end,
      };
      queueRawSelection(selection.start, selection.end);
      return;
    }

    rawUndoStackRef.current = [
      ...rawUndoStackRef.current.slice(-49),
      currentSnapshot,
    ];
    rawRedoStackRef.current = [];
    rawSnapshotRef.current = {
      value: nextValue,
      selectionStart: selection.start,
      selectionEnd: selection.end,
    };
    lastRawEmittedRef.current = nextValue;
    onChange(nextValue);
    queueRawSelection(selection.start, selection.end);
  };

  const applyRawHistoryEntry = (entry: RawHistoryEntry) => {
    rawSnapshotRef.current = entry;
    lastRawEmittedRef.current = entry.value;
    onChange(entry.value);
    queueRawSelection(entry.selectionStart, entry.selectionEnd);
  };

  const handleRawUndo = () => {
    const stack = rawUndoStackRef.current;
    if (stack.length === 0) return;
    const previous = stack[stack.length - 1];
    rawUndoStackRef.current = stack.slice(0, -1);
    rawRedoStackRef.current = [
      ...rawRedoStackRef.current.slice(-49),
      syncRawSnapshot() ?? rawSnapshotRef.current,
    ];
    applyRawHistoryEntry(previous);
  };

  const handleRawRedo = () => {
    const stack = rawRedoStackRef.current;
    if (stack.length === 0) return;
    const next = stack[stack.length - 1];
    rawRedoStackRef.current = stack.slice(0, -1);
    rawUndoStackRef.current = [
      ...rawUndoStackRef.current.slice(-49),
      syncRawSnapshot() ?? rawSnapshotRef.current,
    ];
    applyRawHistoryEntry(next);
  };

  const replaceRawSelection = (nextText: string) => {
    const selection = getRawSelection();
    if (!selection) return false;
    const { currentValue, selectionStart, selectionEnd } = selection;
    const nextValue =
      currentValue.slice(0, selectionStart) +
      nextText +
      currentValue.slice(selectionEnd);
    const nextCursor = selectionStart + nextText.length;
    commitRawValue(nextValue, {
      start: nextCursor,
      end: nextCursor,
    }, {
      value: currentValue,
      selectionStart,
      selectionEnd,
    });
    return true;
  };

  const handleRawCopy = async () => {
    const selection = getRawSelection();
    if (
      !selection ||
      selection.selectionStart === selection.selectionEnd ||
      typeof navigator?.clipboard?.writeText !== "function"
    ) {
      return;
    }
    await navigator.clipboard.writeText(selection.selectedText);
    queueRawSelection(selection.selectionStart, selection.selectionEnd);
  };

  const handleRawCut = async () => {
    const selection = getRawSelection();
    if (
      !selection ||
      selection.selectionStart === selection.selectionEnd ||
      typeof navigator?.clipboard?.writeText !== "function"
    ) {
      return;
    }
    await navigator.clipboard.writeText(selection.selectedText);
    replaceRawSelection("");
  };

  const handleRawPaste = async () => {
    if (typeof navigator?.clipboard?.readText !== "function") return;
    const pastedText = await navigator.clipboard.readText();
    if (!pastedText) return;
    replaceRawSelection(pastedText);
  };

  const handleRawDelete = () => {
    const selection = getRawSelection();
    if (!selection || selection.selectionStart === selection.selectionEnd) {
      return;
    }
    replaceRawSelection("");
  };

  const handleRawSelectAll = () => {
    const selection = getRawSelection();
    if (!selection || selection.currentValue.length === 0) return;
    queueRawSelection(0, selection.currentValue.length);
  };

  const handleRawKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          handleRawRedo();
        } else {
          handleRawUndo();
        }
        return;
      }

      if (!e.shiftKey && e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleRawRedo();
        return;
      }
    }

    syncRawSnapshot();
  };

  if (isRawMode) {
    return (
      <ContextMenu
        onOpenChange={(open) => {
          if (open) syncRawContextMenuState();
        }}
      >
        <div
          className={cn(
            "relative w-full min-w-0 rounded-lg border bg-secondary/60 px-2 py-2 overflow-y-auto overflow-x-hidden",
            externalDragOver ? "border-primary/60" : "border-border/60",
            resizable && "resize-y",
            className,
          )}
          style={{ minHeight, maxHeight }}
          onDragOver={
            allowExternalDrop
              ? (e) => {
                  if (e.dataTransfer.types.includes(DRAG_TOKEN_MIME)) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                    setExternalDragOver(true);
                  }
                }
              : undefined
          }
          onDragLeave={
            allowExternalDrop ? () => setExternalDragOver(false) : undefined
          }
          onDrop={
            allowExternalDrop
              ? (e) => {
                  setExternalDragOver(false);
                  const data = e.dataTransfer.getData(DRAG_TOKEN_MIME);
                  if (!data) return;
                  e.preventDefault();
                  handleRawDrop(data);
                }
              : undefined
          }
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-2 overflow-hidden"
          >
            <div
              className="min-h-full w-full px-1 py-0.5 text-sm leading-6 whitespace-pre-wrap break-words"
              style={{
                transform: `translate(${-rawScrollPosition.left}px, ${-rawScrollPosition.top}px)`,
              }}
            >
              {value.length === 0 ? (
                <span className="text-transparent">{"\u200b"}</span>
              ) : (
                (() => {
                  const segments: ReactNode[] = [];
                  let cursor = 0;

                  const decoratedRanges = [
                    ...rawSyntaxIssueRanges.map((range) => ({
                      ...range,
                      kind: "error" as const,
                    })),
                    ...rawHighlightRanges.map((range) => ({
                      ...range,
                      kind: "highlight" as const,
                    })),
                  ].sort((left, right) =>
                    left.start === right.start
                      ? left.kind === right.kind
                        ? right.end - left.end
                        : left.kind === "error"
                          ? -1
                          : 1
                      : left.start - right.start,
                  );

                  decoratedRanges.forEach((range) => {
                    if (range.start > cursor) {
                      segments.push(
                        <span
                          key={`raw-plain-${cursor}`}
                          className="text-transparent"
                        >
                          {value.slice(cursor, range.start)}
                        </span>,
                      );
                    }

                    segments.push(
                      <span
                        key={`raw-highlight-${range.start}-${range.end}`}
                        data-prompt-raw-highlight={
                          range.kind === "highlight" ? "" : undefined
                        }
                        data-prompt-raw-syntax-error={
                          range.kind === "error" ? "" : undefined
                        }
                        className={cn(
                          "rounded-[4px] box-decoration-clone",
                          range.kind === "error"
                            ? "bg-destructive/42"
                            : getPromptWeightRawHighlightClass(range.weight),
                          "text-transparent",
                        )}
                      >
                        {value.slice(range.start, range.end)}
                      </span>,
                    );
                    cursor = range.end;
                  });

                  if (cursor < value.length) {
                    segments.push(
                      <span
                        key={`raw-plain-tail-${cursor}`}
                        className="text-transparent"
                      >
                        {value.slice(cursor)}
                      </span>,
                    );
                  }

                  if (value.endsWith("\n")) {
                    segments.push(
                      <span key="raw-trailing-break" className="text-transparent">
                        {"\u200b"}
                      </span>,
                    );
                  }

                  return segments;
                })()
              )}
            </div>
          </div>
          <ContextMenuTrigger asChild>
            <textarea
              ref={rawInputRef}
              value={value}
              onChange={(e) =>
                commitRawValue(e.target.value, {
                  start: e.target.selectionStart ?? e.target.value.length,
                  end: e.target.selectionEnd ?? e.target.value.length,
                }, rawSnapshotRef.current)
              }
              onKeyDown={handleRawKeyDown}
              onKeyUp={syncRawSnapshot}
              onMouseUp={syncRawSnapshot}
              onSelect={syncRawSnapshot}
              onFocus={syncRawSnapshot}
              onContextMenu={syncRawContextMenuState}
              onScroll={(e) =>
                setRawScrollPosition((prev) => {
                  const nextTop = e.currentTarget.scrollTop;
                  const nextLeft = e.currentTarget.scrollLeft;
                  if (prev.top === nextTop && prev.left === nextLeft) {
                    return prev;
                  }
                  return { top: nextTop, left: nextLeft };
                })
              }
              aria-label={resolvedPlaceholder}
              placeholder={resolvedPlaceholder}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              className="relative z-10 block w-full resize-none bg-transparent px-1 py-0.5 text-sm leading-6 outline-none placeholder:text-muted-foreground/40"
              style={{
                minHeight: Math.max(40, minHeight - 16),
                maxHeight: Math.max(40, maxHeight - 16),
              }}
            />
          </ContextMenuTrigger>
          <ContextMenuContent className="min-w-40">
            <ContextMenuItem
              disabled={!rawContextMenuState.hasSelection}
              onSelect={() => {
                void handleRawCut();
              }}
            >
              {t("promptInput.context.cut")}
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!rawContextMenuState.hasSelection}
              onSelect={() => {
                void handleRawCopy();
              }}
            >
              {t("promptInput.context.copy")}
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                void handleRawPaste();
              }}
            >
              {t("promptInput.context.paste")}
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!rawContextMenuState.hasSelection}
              onSelect={handleRawDelete}
            >
              {t("promptInput.context.delete")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={!rawContextMenuState.hasValue}
              onSelect={handleRawSelectAll}
            >
              {t("promptInput.context.selectAll")}
            </ContextMenuItem>
          </ContextMenuContent>
        </div>
      </ContextMenu>
    );
  }

  const inputInner = (
    <>
      <div
        ref={inputAnchorRef}
        className={cn(
          "relative min-h-7 rounded-sm transition-colors",
          isInputFocused && "bg-background/35",
        )}
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => handleDraftChange(e.target.value)}
          onKeyDown={handleInputKeyDown}
          onPaste={handleInputPaste}
          onFocus={() => {
            setIsInputFocused(true);
            setShowTrailingEmptyInput(true);
            setInlineEditTokenId(null);
            setChipCursorIndex(null);
          }}
          onBlur={handleInputBlur}
          aria-label={resolvedPlaceholder}
          placeholder={tokens.length === 0 ? resolvedPlaceholder : ""}
          className="h-7 w-full bg-transparent px-1 text-sm leading-7 outline-none placeholder:text-muted-foreground/40"
          style={{
            color: "transparent",
            caretColor: "var(--color-primary)",
            textShadow:
              draft.length > 0 ? "0 0 0 var(--color-foreground)" : undefined,
          }}
        />
      </div>
    </>
  );

  const autocompletePortal =
    (showGroupDropdown || showTagSuggestionDropdown) &&
    typeof document !== "undefined"
      ? createPortal(
          showGroupDropdown ? (
            <div
              ref={dropdownRef}
              style={
                autocompleteStyle ?? {
                  position: "fixed",
                  top: 8,
                  left: 8,
                  width: 176,
                  zIndex: 3200,
                  visibility: "hidden",
                }
              }
              className="max-h-56 overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-popover shadow-lg"
            >
              {filteredGroups.map((g, i) => (
                <button
                  key={g.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertGroupToken(g.name);
                  }}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-xs transition-colors",
                    i === groupDropdownIndex
                      ? "bg-primary/15 text-primary"
                      : "text-foreground/80 hover:bg-secondary",
                  )}
                >
                  <span className="font-semibold text-group">@</span>
                  {`{${g.name}}`}
                </button>
              ))}
            </div>
          ) : (
            <div
              ref={dropdownRef}
              style={
                autocompleteStyle ?? {
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
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyTagSuggestion(suggestion);
                  }}
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
          ),
          document.body,
        )
      : null;

  const showTrailingInput =
    insertIndex === null &&
    chipCursorIndex === null &&
    inlineEditTokenId === null &&
    popoverTokenId === null &&
    (tokens.length === 0 ||
      isInputFocused ||
      draft.trim().length > 0 ||
      showTrailingEmptyInput);

  return (
    <div
      className={cn(
        "w-full min-w-0 rounded-lg border bg-secondary/60 px-2 py-2 overflow-y-auto overflow-x-hidden",
        externalDragOver ? "border-primary/60" : "border-border/60",
        resizable && "resize-y",
        className,
      )}
      style={{ minHeight, maxHeight }}
      onMouseDown={handleContainerMouseDown}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
          if ((e.target as HTMLElement).tagName !== "INPUT") {
            e.preventDefault();
            handleUndo();
          }
        }
      }}
      onDragOver={
        allowExternalDrop
          ? (e) => {
              if (e.dataTransfer.types.includes(DRAG_TOKEN_MIME)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                setExternalDragOver(true);
              }
            }
          : undefined
      }
      onDragLeave={
        allowExternalDrop ? () => setExternalDragOver(false) : undefined
      }
      onDrop={
        allowExternalDrop
          ? (e) => {
              setExternalDragOver(false);
              const data = e.dataTransfer.getData(DRAG_TOKEN_MIME);
              if (!data) return;
              e.preventDefault();
              try {
                const parsed = JSON.parse(data) as Record<string, unknown>;
                if (
                  parsed.kind === "group" &&
                  typeof parsed.groupName === "string"
                ) {
                  const groupToken: EditableToken = {
                    kind: "group",
                    groupName: parsed.groupName,
                    ...(Array.isArray(parsed.overrideTags)
                      ? { overrideTags: parsed.overrideTags as string[] }
                      : {}),
                    id: createTokenId(),
                  };
                  emit([...tokens, groupToken], draft);
                } else if (typeof parsed.text === "string") {
                  emit(
                    [
                      ...tokens,
                      {
                        text: parsed.text,
                        weight:
                          typeof parsed.weight === "number" ? parsed.weight : 1,
                        raw:
                          typeof parsed.raw === "string"
                            ? parsed.raw
                            : undefined,
                        id: createTokenId(),
                      },
                    ],
                    draft,
                  );
                }
                requestAnimationFrame(() => inputRef.current?.focus());
              } catch {
                // ignore invalid data
              }
            }
          : undefined
      }
    >
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext
          items={tokens.map((token) => token.id)}
          strategy={rectSortingStrategy}
        >
          <div
            ref={tokenRowRef}
            className="flex w-full min-w-0 flex-wrap items-center gap-1.5"
            onMouseDown={handleContainerMouseDown}
          >
            {insertIndex === 0 && (
              <div className="relative min-w-[3ch] basis-0 flex-1">
                {inputInner}
              </div>
            )}
            {tokens.map((token, index) =>
              isGroupRef(token) ? (
                <Fragment key={token.id}>
                  <GroupChip
                    token={token}
                    groups={groups}
                    readOnly={true}
                    onChange={(nextToken) => {
                      const nextTokens = tokens.map((t) =>
                        t.id === token.id ? { ...nextToken, id: token.id } : t,
                      );
                      emit(nextTokens, draft);
                    }}
                    onDelete={() => {
                      removeTokenAtIndex(index);
                    }}
                    chipRef={(node) => setTokenRef(token.id, node)}
                    onTokenFocus={() => {
                      setInlineEditTokenId(null);
                      setChipCursorIndex(index);
                    }}
                    onTokenKeyDown={(e) => handleTokenKeyDown(e, index)}
                    isSortable={true}
                    sortableId={token.id}
                  />
                  {insertIndex === index + 1 ? (
                    <div className="relative min-w-[3ch] basis-0 flex-1">
                      {inputInner}
                    </div>
                  ) : chipCursorIndex === index ? (
                    <span
                      className="inline-block w-0.5 h-4 self-center rounded-full bg-primary/80"
                      style={{
                        animation: "chip-cursor-blink 0.7s step-end infinite",
                      }}
                    />
                  ) : null}
                </Fragment>
              ) : isWildcard(token) ? (
                <Fragment key={token.id}>
                  <WildcardChip
                    token={token}
                    onChange={(nextToken) =>
                      handleWildcardChange(token.id, nextToken)
                    }
                    onDelete={() => {
                      removeTokenAtIndex(index);
                    }}
                    onTokenFocus={() => setChipCursorIndex(index)}
                    onTokenKeyDown={(e) => handleTokenKeyDown(e, index)}
                    isSortable={true}
                    sortableId={token.id}
                    chipRef={(node) => setTokenRef(token.id, node)}
                  />
                  {insertIndex === index + 1 ? (
                    <div className="relative min-w-[3ch] basis-0 flex-1">
                      {inputInner}
                    </div>
                  ) : chipCursorIndex === index ? (
                    <span
                      className="inline-block w-0.5 h-4 self-center rounded-full bg-primary/80"
                      style={{
                        animation: "chip-cursor-blink 0.7s step-end infinite",
                      }}
                    />
                  ) : null}
                </Fragment>
              ) : (
                <Fragment key={token.id}>
                  <TokenChip
                    key={token.id}
                    token={token as PromptToken & { id: string }}
                    raw={tokenToRawString(token)}
                    isEditable={true}
                    tagSuggestionExclude={tokens
                      .filter(
                        (t): t is EditableToken & PromptToken =>
                          t.id !== token.id &&
                          !isGroupRef(t) &&
                          !isWildcard(t) &&
                          t.text.trim().length > 0,
                      )
                      .map((t) => t.text.trim())}
                    constrainToContainer={true}
                    maxWidthPx={Math.max(
                      0,
                      tokenRowWidth - INPUT_WRAP_TOKEN_GAP_PX,
                    )}
                    syntaxIssueKind={tokenSyntaxIssueByIndex.get(index)}
                    inlineEditOpen={inlineEditTokenId === token.id}
                    onInlineEditOpenChange={(open, reason) =>
                      setInlineEditTokenId((prev) => {
                        if (open) return token.id;
                        if (prev !== token.id) return prev;
                        if (reason !== "cancel" && reason !== "stay") {
                          requestAnimationFrame(() => {
                            if (
                              inlineEditTokenIdRef.current === null &&
                              chipCursorIndexRef.current === null
                            )
                              focusInput("end");
                          });
                        }
                        return null;
                      })
                    }
                    editorOpen={popoverTokenId === token.id}
                    onChange={(nextToken) =>
                      handleTokenChange(token.id, nextToken)
                    }
                    onDelete={() => {
                      removeTokenAtIndex(index);
                    }}
                    onApplyAdvance={() => {
                      if (index < tokens.length - 1) {
                        focusTokenAtIndex(index + 1);
                        return;
                      }
                      focusInput("end");
                    }}
                    onTokenFocus={() => setChipCursorIndex(index)}
                    onEditorOpenChange={(open, reason) => {
                      if (open) {
                        setInlineEditTokenId(null);
                        setChipCursorIndex(null);
                        setPopoverTokenId(token.id);
                      } else {
                        setPopoverTokenId((prev) => {
                          if (prev !== token.id) return prev;
                          if (reason === "advance") {
                            return null;
                          }
                          requestAnimationFrame(() => {
                            tokenRefs.current.get(token.id)?.focus();
                          });
                          return null;
                        });
                      }
                    }}
                    openOnFocus={false}
                    focusEditorOnOpen={true}
                    onRequestAdjacentEdit={(direction) => {
                      if (direction === "prev") {
                        if (index > 0) focusTokenAtIndex(index - 1);
                        else focusInput("start");
                        return;
                      }
                      if (index < tokens.length - 1)
                        focusTokenAtIndex(index + 1);
                      else focusInput("start");
                    }}
                    onRequestVerticalNavigation={(direction) =>
                      navigateVertical(direction, index)
                    }
                    onTokenKeyDown={(e) => handleTokenKeyDown(e, index)}
                    isSortable={true}
                    sortableId={token.id}
                    chipRef={(node) => setTokenRef(token.id, node)}
                  />
                  {insertIndex === index + 1 ? (
                    <div className="relative min-w-[3ch] basis-0 flex-1">
                      {inputInner}
                    </div>
                  ) : chipCursorIndex === index ||
                    inlineEditTokenId === token.id ? (
                    <span
                      className="inline-block w-0.5 h-4 self-center rounded-full bg-primary/80"
                      style={{
                        animation: "chip-cursor-blink 0.7s step-end infinite",
                      }}
                    />
                  ) : null}
                </Fragment>
              ),
            )}

            {showTrailingInput && (
              <div
                className={cn(
                  "relative min-w-[3ch]",
                  shouldWrapInput ? "basis-full" : "basis-0 flex-1",
                )}
              >
                {inputInner}
              </div>
            )}
          </div>
        </SortableContext>
      </DndContext>
      {autocompletePortal}
    </div>
  );
});
