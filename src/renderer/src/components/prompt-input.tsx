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
import { SortableContext, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import type { PromptToken } from "@/lib/token";
import { parsePromptTokens, parseRawToken, tokenToRawString } from "@/lib/token";
import { TokenChip } from "./token-chip";

type EditablePromptToken = PromptToken & { id: string };

interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  resizable?: boolean;
  minHeight?: number;
  maxHeight?: number;
}

function createTokenId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tok-${Math.random().toString(36).slice(2, 10)}`;
}

function toEditableTokens(tokens: PromptToken[]): EditablePromptToken[] {
  return tokens
    .filter((token) => token.text.trim().length > 0)
    .map((token) => ({ ...token, id: createTokenId() }));
}

function serializePrompt(tokens: EditablePromptToken[], draft: string): string {
  const tokenText = tokens
    .filter((token) => token.text.trim().length > 0)
    .map((token) => tokenToRawString(token))
    .join(", ");
  const cleanDraft = draft.trim();
  if (!cleanDraft) return tokenText;
  return tokenText ? `${tokenText}, ${cleanDraft}` : cleanDraft;
}

export function PromptInput({
  value,
  onChange,
  placeholder = "tag, tag, tag...",
  className,
  resizable = true,
  minHeight = 112,
  maxHeight = 420,
}: PromptInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const tokenRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const activeEditorTokenIdRef = useRef<string | null>(null);
  const [tokens, setTokens] = useState<EditablePromptToken[]>(() =>
    toEditableTokens(parsePromptTokens(value)),
  );
  const [draft, setDraft] = useState("");
  const [activeEditorTokenId, setActiveEditorTokenId] = useState<string | null>(
    null,
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const serialized = useMemo(() => serializePrompt(tokens, draft), [tokens, draft]);

  useEffect(() => {
    if (value === serialized) return;
    setTokens(toEditableTokens(parsePromptTokens(value)));
    setDraft("");
  }, [value, serialized]);

  useEffect(() => {
    activeEditorTokenIdRef.current = activeEditorTokenId;
  }, [activeEditorTokenId]);

  useEffect(() => {
    setActiveEditorTokenId((prev) =>
      prev && tokens.some((token) => token.id === prev) ? prev : null,
    );
  }, [tokens]);

  const emit = (nextTokens: EditablePromptToken[], nextDraft: string) => {
    setTokens(nextTokens);
    setDraft(nextDraft);
    onChange(serializePrompt(nextTokens, nextDraft));
  };

  const handleDraftChange = (nextValue: string) => {
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
      ...finalized.map((chunk) => ({ ...parseRawToken(chunk), id: createTokenId() })),
    ];
    emit(nextTokens, nextDraft);
  };

  const handleTokenChange = (id: string, nextToken: PromptToken) => {
    const nextTokens = tokens
      .map((token) => (token.id === id ? { ...nextToken, id } : token))
      .filter((token) => token.text.trim().length > 0);
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
    setActiveEditorTokenId(null);
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const pos = cursor === "start" ? 0 : input.value.length;
    input.setSelectionRange(pos, pos);
  };

  const focusTokenAtIndex = (index: number) => {
    const token = tokens[index];
    if (!token) return;
    setActiveEditorTokenId(token.id);
    const node = tokenRefs.current.get(token.id);
    node?.focus();
  };

  const handleInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
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
      nextTokens.push({ ...parseRawToken(normalizedDraft), id: createTokenId() });
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

  return (
    <div
      className={cn(
        "w-full rounded-lg border border-border/60 bg-secondary/60 px-2 py-2 overflow-auto",
        resizable && "resize-y",
        className,
      )}
      style={{ minHeight, maxHeight }}
    >
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={tokens.map((token) => token.id)} strategy={rectSortingStrategy}>
          <div className="flex flex-wrap items-center gap-1.5">
            {tokens.map((token, index) => (
              <TokenChip
                key={token.id}
                token={token}
                raw={tokenToRawString(token)}
                isEditable={true}
                editorOpen={activeEditorTokenId === token.id}
                onChange={(nextToken) => handleTokenChange(token.id, nextToken)}
                onApplyAdvance={() => {
                  if (index < tokens.length - 1) {
                    focusTokenAtIndex(index + 1);
                    return;
                  }
                  focusInput("end");
                }}
                onEditorOpenChange={(open) =>
                  setActiveEditorTokenId((prev) => {
                    if (open) return token.id;
                    if (prev !== token.id) return prev;
                    requestAnimationFrame(() => {
                      if (activeEditorTokenIdRef.current === null) {
                        focusInput("end");
                      }
                    });
                    return null;
                  })
                }
                openOnFocus={true}
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
            ))}
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => handleDraftChange(e.target.value)}
              onKeyDown={handleInputKeyDown}
              onPaste={handleInputPaste}
              onFocus={() => setActiveEditorTokenId(null)}
              placeholder={placeholder}
              className="h-7 min-w-32 flex-1 bg-transparent px-1 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none"
            />
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
