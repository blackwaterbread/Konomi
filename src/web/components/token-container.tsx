import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type ReactNode,
} from "react";
import { DndContext } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { useDndPointerSensors } from "@/lib/dnd-sensors";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import type { PromptToken } from "@/lib/token";
import { tokenToRawString } from "@/lib/token";
import { TokenChip } from "./token-chip";

interface TokenContainerProps {
  tokens: PromptToken[];
  isEditable?: boolean;
  isDndEnabled?: boolean;
  onTokensChange?: (tokens: PromptToken[]) => void;
  onAddTagToSearch?: (tag: string) => void;
  onAddTagToGeneration?: (tag: string) => void;
  highlightFilter?: string;
}

interface SortableTokenContainerShellProps {
  items: string[];
  onDragEnd: (event: DragEndEvent) => void;
  children: ReactNode;
}

const SortableTokenContainerShell = memo(function SortableTokenContainerShell({
  items,
  onDragEnd,
  children,
}: SortableTokenContainerShellProps) {
  const sensors = useDndPointerSensors();

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <SortableContext items={items} strategy={rectSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
});

export const TokenContainer = memo(function TokenContainer({
  tokens,
  isEditable = false,
  isDndEnabled = false,
  onTokensChange,
  onAddTagToSearch,
  onAddTagToGeneration,
  highlightFilter,
}: TokenContainerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!copiedKey) return;
    const timeout = window.setTimeout(() => setCopiedKey(null), 1200);
    return () => window.clearTimeout(timeout);
  }, [copiedKey]);

  const handleCopy = useCallback(
    async (key: string, token: PromptToken) => {
      if (isEditable) return;
      const raw = tokenToRawString(token);
      try {
        await navigator.clipboard.writeText(raw);
        setCopiedKey(key);
      } catch {
        setCopiedKey(null);
      }
    },
    [isEditable],
  );

  const hasSelection = useCallback(() => {
    const selection = window.getSelection();
    return !!selection && !selection.isCollapsed;
  }, []);

  const handleChipCopy = useCallback(
    (key: string, token: PromptToken) => {
      if (hasSelection()) return;
      void handleCopy(key, token);
    },
    [handleCopy, hasSelection],
  );

  const handleChipChange = useCallback(
    (index: number, nextToken: PromptToken) => {
      if (!onTokensChange) return;
      onTokensChange(
        tokens.map((token, i) => (i === index ? nextToken : token)),
      );
    },
    [onTokensChange, tokens],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!isDndEnabled || !onTokensChange) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeIndex = Number(String(active.id).replace("token-", ""));
      const overIndex = Number(String(over.id).replace("token-", ""));
      if (!Number.isFinite(activeIndex) || !Number.isFinite(overIndex)) return;
      if (activeIndex < 0 || overIndex < 0) return;
      if (activeIndex >= tokens.length || overIndex >= tokens.length) return;

      onTokensChange(arrayMove(tokens, activeIndex, overIndex));
    },
    [isDndEnabled, onTokensChange, tokens],
  );

  const handleCopySelectedRaw = useCallback(
    (e: ClipboardEvent<HTMLDivElement>) => {
      const root = containerRef.current;
      const selection = window.getSelection();
      if (
        !root ||
        !selection ||
        selection.isCollapsed ||
        selection.rangeCount < 1
      )
        return;

      const chipNodes = Array.from(
        root.querySelectorAll<HTMLElement>("[data-token-chip='true']"),
      );
      const selectedRaw = chipNodes
        .filter((chip) => {
          for (let i = 0; i < selection.rangeCount; i += 1) {
            const range = selection.getRangeAt(i);
            if (range.intersectsNode(chip)) return true;
          }
          return false;
        })
        .map((chip) => chip.dataset.tokenRaw)
        .filter((raw): raw is string => Boolean(raw && raw.trim()));

      if (selectedRaw.length === 0) return;

      e.preventDefault();
      const text = selectedRaw.join(", ");
      e.clipboardData.setData("text/plain", text);
      e.clipboardData.setData("text", text);
    },
    [],
  );

  const tokenIds = useMemo(() => tokens.map((_, i) => `view-${i}`), [tokens]);

  const normalizedFilter = highlightFilter
    ? highlightFilter.trim().toLowerCase().replace(/_/g, " ")
    : "";

  const chips = useMemo(
    () =>
      tokens.map((token, i) => {
        const key = tokenIds[i];
        const raw = tokenToRawString(token);
        const isHighlighted =
          normalizedFilter.length > 0 &&
          token.text
            .toLowerCase()
            .replace(/_/g, " ")
            .includes(normalizedFilter);
        return (
          <TokenChip
            key={key}
            token={token}
            raw={raw}
            isEditable={isEditable}
            copied={copiedKey === key}
            highlighted={isHighlighted}
            onCopy={() => handleChipCopy(key, token)}
            onAddTagToSearch={onAddTagToSearch}
            onAddTagToGeneration={onAddTagToGeneration}
            onChange={(nextToken) => handleChipChange(i, nextToken)}
            isSortable={isDndEnabled}
            sortableId={key}
            sortableDisabled={!isDndEnabled}
          />
        );
      }),
    [
      copiedKey,
      handleChipChange,
      handleChipCopy,
      isDndEnabled,
      isEditable,
      normalizedFilter,
      onAddTagToGeneration,
      onAddTagToSearch,
      tokenIds,
      tokens,
    ],
  );

  if (tokens.length === 0) {
    return <span className="text-xs text-muted-foreground/70">None</span>;
  }

  const content = (
    <div
      ref={containerRef}
      onCopy={handleCopySelectedRaw}
      className="flex flex-wrap gap-1"
    >
      {chips}
    </div>
  );

  if (!isDndEnabled) return content;

  return (
    <SortableTokenContainerShell items={tokenIds} onDragEnd={handleDragEnd}>
      {content}
    </SortableTokenContainerShell>
  );
});
