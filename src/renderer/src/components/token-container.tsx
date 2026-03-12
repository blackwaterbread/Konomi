import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
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
}

export function TokenContainer({
  tokens,
  isEditable = false,
  isDndEnabled = false,
  onTokensChange,
  onAddTagToSearch,
  onAddTagToGeneration,
}: TokenContainerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  useEffect(() => {
    if (!copiedKey) return;
    const timeout = window.setTimeout(() => setCopiedKey(null), 1200);
    return () => window.clearTimeout(timeout);
  }, [copiedKey]);

  const handleCopy = async (key: string, token: PromptToken) => {
    if (isEditable) return;
    const raw = tokenToRawString(token);
    try {
      await navigator.clipboard.writeText(raw);
      setCopiedKey(key);
    } catch {
      setCopiedKey(null);
    }
  };

  const hasSelection = () => {
    const selection = window.getSelection();
    return !!selection && !selection.isCollapsed;
  };

  const handleChipCopy = (key: string, token: PromptToken) => {
    if (hasSelection()) return;
    void handleCopy(key, token);
  };

  const handleChipChange = (index: number, nextToken: PromptToken) => {
    if (!onTokensChange) return;
    onTokensChange(tokens.map((token, i) => (i === index ? nextToken : token)));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (!isDndEnabled || !onTokensChange) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeIndex = Number(String(active.id).replace("token-", ""));
    const overIndex = Number(String(over.id).replace("token-", ""));
    if (!Number.isFinite(activeIndex) || !Number.isFinite(overIndex)) return;
    if (activeIndex < 0 || overIndex < 0) return;
    if (activeIndex >= tokens.length || overIndex >= tokens.length) return;

    onTokensChange(arrayMove(tokens, activeIndex, overIndex));
  };

  const handleCopySelectedRaw = (e: ClipboardEvent<HTMLDivElement>) => {
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
  };

  if (tokens.length === 0) {
    return <span className="text-xs text-muted-foreground/70">None</span>;
  }

  const chips = tokens.map((token, i) => {
    const key = `view-${i}`;
    const raw = tokenToRawString(token);
    return (
      <TokenChip
        key={key}
        token={token}
        raw={raw}
        isEditable={isEditable}
        copied={copiedKey === key}
        onCopy={() => handleChipCopy(key, token)}
        onAddTagToSearch={onAddTagToSearch}
        onAddTagToGeneration={onAddTagToGeneration}
        onChange={(nextToken) => handleChipChange(i, nextToken)}
        isSortable={isDndEnabled}
        sortableId={key}
        sortableDisabled={!isDndEnabled}
      />
    );
  });

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
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <SortableContext
        items={tokens.map((_, i) => `view-${i}`)}
        strategy={rectSortingStrategy}
      >
        {content}
      </SortableContext>
    </DndContext>
  );
}
