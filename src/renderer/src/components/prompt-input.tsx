import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
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
import type { AnyToken, PromptToken } from "@/lib/token";
import {
  parsePromptTokens,
  parseRawToken,
  tokenToRawString,
  isGroupRef,
} from "@/lib/token";
import type { PromptGroup } from "@preload/index.d";
import { TokenChip } from "./token-chip";
import { GroupChip } from "./group-chip";

type EditableToken = AnyToken & { id: string };
type PromptInputEditorMode = "simple" | "advanced";
const INPUT_WRAP_SPACE_THRESHOLD_PX = 120;
const INPUT_WRAP_CARET_BUFFER_PX = 18;
const INPUT_WRAP_TOKEN_GAP_PX = 6;

interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  mode?: PromptInputEditorMode;
  placeholder?: string;
  className?: string;
  resizable?: boolean;
  minHeight?: number;
  maxHeight?: number;
  groups?: PromptGroup[];
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
    .filter((token) => isGroupRef(token) || token.text.trim().length > 0)
    .map((token) => ({ ...token, id: createTokenId() }));
}

function serializePrompt(tokens: EditableToken[], draft: string): string {
  const tokenText = tokens
    .filter((token) => isGroupRef(token) || token.text.trim().length > 0)
    .map((token) => tokenToRawString(token))
    .join(", ");
  const cleanDraft = draft.trim();
  if (!cleanDraft) return tokenText;
  return tokenText ? `${tokenText}, ${cleanDraft}` : cleanDraft;
}

export function PromptInput({
  value,
  onChange,
  mode = "simple",
  placeholder = "tag, tag, tag...",
  className,
  resizable = true,
  minHeight = 112,
  maxHeight = 420,
  groups: groupsProp,
}: PromptInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const measureCanvasContextRef = useRef<CanvasRenderingContext2D | null>(null);
  const tokenRowRef = useRef<HTMLDivElement | null>(null);
  const tokenRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const inlineEditTokenIdRef = useRef<string | null>(null);
  const previousModeRef = useRef<PromptInputEditorMode>(mode);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const [tokens, setTokens] = useState<EditableToken[]>(() =>
    toEditableTokens(parsePromptTokens(value)),
  );
  const [draft, setDraft] = useState("");
  const [inlineEditTokenId, setInlineEditTokenId] = useState<string | null>(null);
  const [popoverTokenId, setPopoverTokenId] = useState<string | null>(null);
  const [shouldWrapInput, setShouldWrapInput] = useState(false);
  const [tokenRowWidth, setTokenRowWidth] = useState(0);

  // @ group autocomplete
  const [groups, setGroups] = useState<PromptGroup[]>(groupsProp ?? []);
  const [groupDropdownOpen, setGroupDropdownOpen] = useState(false);
  const [groupSearch, setGroupSearch] = useState("");
  const [groupDropdownIndex, setGroupDropdownIndex] = useState(0);

  useEffect(() => {
    if (groupsProp !== undefined) {
      setGroups(groupsProp);
      return;
    }
    window.promptBuilder
      .listGroups()
      .then((gs) => setGroups(gs))
      .catch(() => {});
  }, [groupsProp]);

  const filteredGroups = useMemo(
    () =>
      groups.filter((g) =>
        g.name.toLowerCase().includes(groupSearch.toLowerCase()),
      ),
    [groups, groupSearch],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const serialized = useMemo(
    () => serializePrompt(tokens, draft),
    [tokens, draft],
  );

  useEffect(() => {
    if (mode !== "simple") return;
    if (value === serialized) return;
    setTokens(toEditableTokens(parsePromptTokens(value)));
    setDraft("");
  }, [mode, value, serialized]);

  useEffect(() => {
    const previousMode = previousModeRef.current;
    if (
      previousMode === "simple" &&
      mode === "advanced" &&
      value !== serialized
    ) {
      onChange(serialized);
    }
    previousModeRef.current = mode;
  }, [mode, onChange, serialized, value]);

  useEffect(() => {
    inlineEditTokenIdRef.current = inlineEditTokenId;
  }, [inlineEditTokenId]);

  useEffect(() => {
    setInlineEditTokenId((prev) =>
      prev && tokens.some((token) => token.id === prev) ? prev : null,
    );
    setPopoverTokenId((prev) =>
      prev && tokens.some((token) => token.id === prev) ? prev : null,
    );
  }, [tokens]);

  useEffect(() => {
    if (mode === "advanced") {
      setInlineEditTokenId(null);
      setPopoverTokenId(null);
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== "simple") {
      setTokenRowWidth(0);
      return;
    }
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
  }, [mode, tokens.length]);

  useEffect(() => {
    if (mode !== "simple" || tokens.length === 0) {
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
  }, [draft, mode, tokens]);

  const emit = (nextTokens: EditableToken[], nextDraft: string) => {
    setTokens(nextTokens);
    setDraft(nextDraft);
    onChange(serializePrompt(nextTokens, nextDraft));
  };

  const insertGroupToken = (groupName: string) => {
    const groupToken: EditableToken = {
      kind: "group",
      groupName,
      id: createTokenId(),
    };
    emit([...tokens, groupToken], "");
    setGroupDropdownOpen(false);
    setGroupSearch("");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleDraftChange = (nextValue: string) => {
    // Detect @{ prefix for group autocomplete
    const groupPrefixMatch = nextValue.match(/^@\{([^}]*)$/);
    if (groupPrefixMatch) {
      setGroupSearch(groupPrefixMatch[1]);
      setGroupDropdownOpen(true);
      setGroupDropdownIndex(0);
      setDraft(nextValue);
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

    const nextTokens = [
      ...tokens,
      ...finalized.map((chunk) => ({
        ...parseRawToken(chunk),
        id: createTokenId(),
      })),
    ];
    emit(nextTokens, nextDraft);
  };

  const handleTokenChange = (id: string, nextToken: PromptToken) => {
    const nextTokens = tokens
      .map((token) => (token.id === id ? { ...nextToken, id } : token))
      .filter((token) => isGroupRef(token) || token.text.trim().length > 0);
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
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const pos = cursor === "start" ? 0 : input.value.length;
    input.setSelectionRange(pos, pos);
  };

  const focusTokenAtIndex = (index: number) => {
    const token = tokens[index];
    if (!token) return;
    setInlineEditTokenId(token.id);
  };

  const handleInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
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
      if (e.key === "Escape") {
        setGroupDropdownOpen(false);
        return;
      }
    }

    if (e.key === "ArrowLeft") {
      const atStart =
        (e.currentTarget.selectionStart ?? 0) === 0 &&
        (e.currentTarget.selectionEnd ?? 0) === 0;
      if (atStart && tokens.length > 0) {
        e.preventDefault();
        focusTokenAtIndex(tokens.length - 1);
      }
      return;
    }

    if (e.key === "Backspace" && draft.length === 0 && tokens.length > 0) {
      e.preventDefault();
      const nextTokens = tokens.slice(0, -1);
      emit(nextTokens, "");
    }
  };

  const handleInputPaste = (e: ReactClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text/plain").trim();
    if (!pasted) return;
    const pastedTokens = toEditableTokens(parsePromptTokens(pasted));
    if (pastedTokens.length === 0) return;
    e.preventDefault();
    const nextTokens = [...tokens];
    const normalizedDraft = draft.trim();
    if (normalizedDraft) {
      nextTokens.push({
        ...parseRawToken(normalizedDraft),
        id: createTokenId(),
      });
    }
    nextTokens.push(...pastedTokens);
    emit(nextTokens, "");
  };

  const handleTokenKeyDown = (
    e: ReactKeyboardEvent<HTMLDivElement>,
    index: number,
  ) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (index > 0) focusTokenAtIndex(index - 1);
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
      const nextTokens = tokens.filter((_, i) => i !== index);
      emit(nextTokens, draft);
      requestAnimationFrame(() => {
        if (nextTokens.length === 0) {
          focusInput("start");
          return;
        }
        const nextIndex = Math.min(index, nextTokens.length - 1);
        const nextId = nextTokens[nextIndex]?.id;
        if (!nextId) {
          focusInput("start");
          return;
        }
        const nextNode = tokenRefs.current.get(nextId);
        if (nextNode) nextNode.focus();
        else focusInput("start");
      });
    }
  };

  if (mode === "advanced") {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "w-full rounded-lg border border-border/60 bg-secondary/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/60",
          resizable && "resize-y",
          className,
        )}
        style={{ minHeight, maxHeight }}
      />
    );
  }

  return (
    <div
      className={cn(
        "w-full min-w-0 rounded-lg border border-border/60 bg-secondary/60 px-2 py-2 overflow-y-auto overflow-x-hidden",
        resizable && "resize-y",
        className,
      )}
      style={{ minHeight, maxHeight }}
    >
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext
          items={tokens.map((token) => token.id)}
          strategy={rectSortingStrategy}
        >
          <div
            ref={tokenRowRef}
            className="flex w-full min-w-0 flex-wrap items-center gap-1.5"
          >
            {tokens.map((token, index) =>
              isGroupRef(token) ? (
                <GroupChip
                  key={token.id}
                  token={token}
                  groups={groups}
                  isEditable={true}
                  chipRef={(node) => setTokenRef(token.id, node)}
                  onTokenFocus={() => setInlineEditTokenId(null)}
                  onTokenKeyDown={(e) => handleTokenKeyDown(e, index)}
                  isSortable={true}
                  sortableId={token.id}
                />
              ) : (
                <TokenChip
                  key={token.id}
                  token={token}
                  raw={tokenToRawString(token)}
                  isEditable={true}
                  constrainToContainer={true}
                  maxWidthPx={Math.max(
                    0,
                    tokenRowWidth - INPUT_WRAP_TOKEN_GAP_PX,
                  )}
                  inlineEditOpen={inlineEditTokenId === token.id}
                  onInlineEditOpenChange={(open) =>
                    setInlineEditTokenId((prev) => {
                      if (open) return token.id;
                      if (prev !== token.id) return prev;
                      requestAnimationFrame(() => {
                        if (inlineEditTokenIdRef.current === null)
                          focusInput("end");
                      });
                      return null;
                    })
                  }
                  editorOpen={popoverTokenId === token.id}
                  onChange={(nextToken) =>
                    handleTokenChange(token.id, nextToken)
                  }
                  onApplyAdvance={() => {
                    if (index < tokens.length - 1) {
                      focusTokenAtIndex(index + 1);
                      return;
                    }
                    focusInput("end");
                  }}
                  onEditorOpenChange={(open) => {
                    if (open) {
                      setInlineEditTokenId(null);
                      setPopoverTokenId(token.id);
                    } else {
                      setPopoverTokenId((prev) => {
                        if (prev !== token.id) return prev;
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
                    if (index < tokens.length - 1) focusTokenAtIndex(index + 1);
                    else focusInput("start");
                  }}
                  onTokenKeyDown={(e) => handleTokenKeyDown(e, index)}
                  isSortable={true}
                  sortableId={token.id}
                  chipRef={(node) => setTokenRef(token.id, node)}
                />
              ),
            )}

            <div
              className={cn(
                "relative min-w-[3ch]",
                shouldWrapInput ? "basis-full" : "basis-0 flex-1",
              )}
            >
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => handleDraftChange(e.target.value)}
                onKeyDown={handleInputKeyDown}
                onPaste={handleInputPaste}
                onFocus={() => {
                  setInlineEditTokenId(null);
                }}
                onBlur={() => {
                  setTimeout(() => setGroupDropdownOpen(false), 150);
                }}
                placeholder={tokens.length > 0 ? "" : placeholder}
                className="h-7 w-full bg-transparent px-1 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none"
              />

              {/* Group autocomplete dropdown */}
              {groupDropdownOpen && filteredGroups.length > 0 && (
                <div
                  ref={dropdownRef}
                  className="absolute top-full left-0 mt-1 w-44 rounded-lg border border-border bg-popover shadow-lg z-50 overflow-hidden"
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
                      <span className="text-violet-500 font-semibold">@</span>
                      {`{${g.name}}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
