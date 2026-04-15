import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  Copy,
  Minus,
  Plus,
  RotateCcw,
  Scissors,
  Trash2,
} from "lucide-react";
import type { DraggableAttributes } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  tokenToRawString,
  type GroupRefToken,
  type TokenWeightExpression,
} from "@/lib/token";
import type { PromptGroup } from "@preload/index.d";
import { PromptInput } from "@/components/prompt-input";
import { Switch } from "@/components/ui/switch";

const POPOVER_WIDTH = 264;
const EDITOR_POPOVER_WIDTH = 300;
const POPOVER_GAP = 6;
const POPOVER_EDGE_PADDING = 8;

const MIN_WEIGHT = -1;
const MAX_WEIGHT = 3;
const WEIGHT_STEP = 0.1;

function clampWeight(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, value));
}

function formatWeight(weight: number): string {
  if (!Number.isFinite(weight)) return "1";
  return weight.toFixed(2).replace(/\.?0+$/, "");
}

const BRACKET_MULT = 1.05;

function previewWeightedTags(
  tags: string[],
  weight: number,
  expression: "numerical" | "keyword",
): string {
  const joined = tags.join(", ");
  if (Math.abs(weight - 1.0) <= 0.001) return joined;
  if (expression === "keyword") {
    const power = Math.round(
      Math.log(Math.abs(weight)) / Math.log(BRACKET_MULT),
    );
    if (power > 0) return "{".repeat(power) + joined + "}".repeat(power);
    if (power < 0) return "[".repeat(-power) + joined + "]".repeat(-power);
    return joined;
  }
  const w = weight.toFixed(2).replace(/\.?0+$/, "");
  return `${w}::${joined}::`;
}

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
  readOnly?: boolean;
  onChange?: (token: GroupRefToken) => void;
  onDelete?: () => void;
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
  readOnly = false,
  onChange,
  onDelete,
  chipRef,
  onTokenFocus,
  onTokenKeyDown,
  sortable,
}: Omit<GroupChipProps, "isSortable" | "sortableId" | "sortableDisabled"> & {
  sortable?: SortableBindings;
}) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const [activePopup, setActivePopup] = useState<
    "preview" | "editor" | "actions" | null
  >(null);
  const [actionsCopied, setActionsCopied] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);
  const [draftWeight, setDraftWeight] = useState(token.weight ?? 1);
  const [draftExpression, setDraftExpression] = useState<TokenWeightExpression>(
    token.weightExpression ?? "numerical",
  );

  const [draftName, setDraftName] = useState(token.groupName);
  const [draftTagsValue, setDraftTagsValue] = useState("");
  const [editorBlockMode, setEditorBlockMode] = useState(false);

  const group = groups.find((item) => item.name === token.groupName);
  const currentTags =
    token.overrideTags ?? group?.tokens.map((item) => item.label) ?? [];
  const hasOverride = token.overrideTags !== undefined;

  const tagsToValue = (tags: string[]) => tags.join(", ");
  const valueToTags = (value: string) =>
    value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const openEditor = () => {
    const currentGroup = groups.find((item) => item.name === token.groupName);
    setDraftName(token.groupName);
    setDraftTagsValue(
      tagsToValue(
        token.overrideTags ??
          currentGroup?.tokens.map((item) => item.label) ??
          [],
      ),
    );
    setDraftWeight(token.weight ?? 1);
    setDraftExpression(token.weightExpression ?? "numerical");
    setActivePopup("editor");
  };

  const buildDraftToken = (): GroupRefToken => {
    const trimmedName = draftName.trim() || token.groupName;
    const targetGroup = groups.find((item) => item.name === trimmedName);
    const dbTags = targetGroup?.tokens.map((item) => item.label) ?? [];
    const draftTags = valueToTags(draftTagsValue);
    const tagsMatchDb =
      draftTags.length === dbTags.length &&
      draftTags.every((tag, index) => tag === dbTags[index]);

    const hasWeight = Math.abs(draftWeight - 1.0) > 0.001;
    return {
      kind: "group",
      groupName: trimmedName,
      ...(tagsMatchDb ? {} : { overrideTags: draftTags }),
      ...(hasWeight ? { weight: draftWeight } : {}),
      ...(draftExpression === "keyword"
        ? { weightExpression: "keyword" as const }
        : {}),
    };
  };

  const handleApply = () => {
    onChange?.(buildDraftToken());
    setActivePopup(null);
  };

  const handleCancel = () => {
    setActivePopup(null);
  };

  const handleResetTags = () => {
    const targetGroup = groups.find((item) => item.name === draftName.trim());
    setDraftTagsValue(
      tagsToValue(targetGroup?.tokens.map((item) => item.label) ?? []),
    );
  };

  useEffect(() => {
    if (activePopup === null) return;

    const updatePosition = () => {
      const triggerNode = triggerRef.current;
      if (!triggerNode) return;
      const rect = triggerNode.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const popoverHeight =
        popoverRef.current?.offsetHeight ??
        (activePopup === "actions" ? 180 : 160);

      const currentWidth =
        activePopup === "editor" ? EDITOR_POPOVER_WIDTH : POPOVER_WIDTH;
      let left = rect.left;
      left = Math.max(POPOVER_EDGE_PADDING, left);
      left = Math.min(
        left,
        viewportWidth - currentWidth - POPOVER_EDGE_PADDING,
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
        width: currentWidth,
        zIndex: 3000,
      });
    };

    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      if (popoverRef.current?.contains(event.target as Node)) return;
      // PromptInput 내 TokenChip 등의 중첩 popover는 document.body에
      // portal되므로 popoverRef 밖에 위치함. 중첩 popover 클릭을 무시.
      const target = event.target as HTMLElement;
      if (target.closest?.("[data-token-chip-popover]")) return;
      setActivePopup(null);
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
  }, [activePopup]);

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
    width: activePopup === "editor" ? EDITOR_POPOVER_WIDTH : POPOVER_WIDTH,
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
        data-token-raw={tokenToRawString(token)}
        onDoubleClick={(e) => {
          if (!onChange) return;
          e.preventDefault();
          openEditor();
        }}
        onContextMenu={(e) => {
          if (!onChange) return;
          e.preventDefault();
          openEditor();
        }}
        onFocus={onTokenFocus}
        onKeyDown={(e) => {
          onTokenKeyDown?.(e);
          if (e.defaultPrevented) return;
          if (!readOnly && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setActivePopup((previous) =>
              previous === "preview" ? null : "preview",
            );
          }
        }}
        {...sortable?.attributes}
        {...(activePopup !== null ? {} : sortable?.listeners)}
        className={cn(
          "inline-flex cursor-pointer touch-none select-none items-center gap-1 rounded border px-1.5 py-1 text-xs transition-colors",
          "border-group/35 bg-group/14 text-group",
          "hover:brightness-105",
          sortable?.isDragging && "opacity-70",
          hasOverride && "ring-1 ring-group/40",
        )}
      >
        <span className="shrink-0 font-semibold text-group">@</span>
        <span>{`{${token.groupName}}`}</span>
        {token.weight !== undefined && Math.abs(token.weight - 1.0) > 0.001 ? (
          <span className="font-mono text-[9px] text-group/60">
            x{formatWeight(token.weight)}
          </span>
        ) : null}
        <ChevronDown className="h-2.5 w-2.5 shrink-0 text-group/80" />
      </div>
    </div>
  );

  const previewPopover =
    activePopup === "preview" ? (
      <div
        ref={popoverRef}
        style={popoverStyle ?? hiddenStyle}
        className="rounded-md border border-border bg-popover p-2.5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {token.groupName}
          </p>
          {hasOverride ? (
            <span className="rounded bg-group/12 px-1.5 py-0.5 text-[9px] text-group/85">
              {t("groupChip.edited")}
            </span>
          ) : null}
        </div>
        {currentTags.length === 0 ? (
          <p className="text-xs italic text-muted-foreground/60">
            {t("groupChip.noTags")}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {currentTags.map((tag, index) => (
              <span
                key={index}
                className="rounded border border-border/40 bg-muted px-1.5 py-0.5 text-[11px] text-foreground/80"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    ) : null;

  const editorPopover =
    activePopup === "editor" ? (
      <div
        ref={popoverRef}
        style={popoverStyle ?? hiddenStyle}
        className="rounded-md border border-border bg-popover p-2.5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3">
          <label className="mb-1.5 block text-[10px] uppercase tracking-wider text-muted-foreground">
            {t("groupChip.groupName")}
          </label>
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleApply();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                handleCancel();
              }
            }}
            className="h-8 w-full rounded border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary/60"
          />
        </div>

        <div className="mb-3">
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("groupChip.tags")}
            </label>
            <label className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <span>{t("generation.promptDisplay.blockMode")}</span>
              <Switch
                checked={editorBlockMode}
                onCheckedChange={setEditorBlockMode}
                aria-label={t("generation.promptDisplay.blockMode")}
              />
            </label>
          </div>

          <PromptInput
            value={draftTagsValue}
            onChange={setDraftTagsValue}
            displayMode={editorBlockMode ? "chips" : "raw"}
            placeholder={t("groupChip.addTagPlaceholder")}
            minHeight={100}
            maxHeight={200}
            resizable={false}
          />
          <div className="mt-1 flex justify-end">
            <button
              type="button"
              onClick={handleResetTags}
              title={t("groupChip.resetTags")}
              aria-label={t("groupChip.resetTags")}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/50 transition-colors hover:text-muted-foreground"
            >
              <RotateCcw className="h-2.5 w-2.5" />
              {t("groupChip.resetTags")}
            </button>
          </div>
        </div>

        <div className="mb-2.5">
          <div className="flex items-center justify-between">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("tokenChip.editor.emphasis")}
            </label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  setDraftWeight(clampWeight(draftWeight - WEIGHT_STEP))
                }
                disabled={draftWeight <= MIN_WEIGHT}
                className="flex h-5 w-5 items-center justify-center rounded border border-border/50 text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:opacity-30"
              >
                <Minus className="h-2.5 w-2.5" />
              </button>
              <span className="w-7 text-center font-mono text-[10px] tabular-nums text-foreground/80">
                {formatWeight(draftWeight)}
              </span>
              <button
                type="button"
                onClick={() =>
                  setDraftWeight(clampWeight(draftWeight + WEIGHT_STEP))
                }
                disabled={draftWeight >= MAX_WEIGHT}
                className="flex h-5 w-5 items-center justify-center rounded border border-border/50 text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:opacity-30"
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
            className="mt-1 h-1.5 w-full cursor-pointer accent-primary"
          />
          <div className="mt-2">
            <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("tokenChip.editor.expression")}
            </p>
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-1.5 text-xs text-foreground/80 cursor-pointer">
                <input
                  type="radio"
                  name="group-editor-weight-expr"
                  checked={draftExpression === "numerical"}
                  onChange={() => setDraftExpression("numerical")}
                />
                {t("tokenChip.editor.numerical")}
              </label>
              <label className="inline-flex items-center gap-1.5 text-xs text-foreground/80 cursor-pointer">
                <input
                  type="radio"
                  name="group-editor-weight-expr"
                  checked={draftExpression === "keyword"}
                  onChange={() => setDraftExpression("keyword")}
                />
                {t("tokenChip.editor.keyword")}
              </label>
            </div>
          </div>
        </div>

        <p className="mb-2.5 text-[10px] text-muted-foreground/40 select-none">
          {t("groupChip.note")}
        </p>

        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded border transition-colors",
                actionsCopied
                  ? "border-primary/50 text-primary"
                  : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
              onClick={() => {
                void navigator.clipboard.writeText(
                  tokenToRawString(buildDraftToken()),
                );
                setActionsCopied(true);
                setTimeout(() => setActionsCopied(false), 1200);
              }}
              title={t("promptInput.context.copy")}
              aria-label={t("promptInput.context.copy")}
            >
              {actionsCopied ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
            {onDelete ? (
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded border border-border text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                onClick={() => {
                  void navigator.clipboard.writeText(
                    tokenToRawString(buildDraftToken()),
                  );
                  setActivePopup(null);
                  onDelete();
                }}
                title={t("promptInput.context.cut")}
                aria-label={t("promptInput.context.cut")}
              >
                <Scissors className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {onDelete ? (
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded border border-destructive/40 text-destructive/70 hover:bg-destructive/10 hover:text-destructive transition-colors"
                onClick={() => {
                  setActivePopup(null);
                  onDelete();
                }}
                title={t("common.delete")}
                aria-label={t("common.delete")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
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
              {t("groupChip.apply")}
            </button>
          </div>
        </div>
      </div>
    ) : null;

  const actionsRawText = previewWeightedTags(
    currentTags,
    draftWeight,
    draftExpression,
  );

  const handleActionsApply = () => {
    if (!onChange) return;
    const hasWeight = Math.abs(draftWeight - 1.0) > 0.001;
    onChange({
      ...token,
      weight: hasWeight ? draftWeight : undefined,
      weightExpression: draftExpression === "keyword" ? "keyword" : undefined,
    });
    setActivePopup(null);
  };

  const actionsPopover =
    activePopup === "actions" ? (
      <div
        ref={popoverRef}
        style={popoverStyle ?? hiddenStyle}
        className="rounded-md border border-border bg-popover p-2.5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2">
          <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">
            {t("tokenChip.editor.rawToken")}
          </label>
          <input
            value={actionsRawText}
            readOnly
            className="h-8 w-full rounded border border-border bg-background px-2 font-mono text-[11px] text-foreground/80 outline-none"
          />
        </div>
        {onChange ? (
          <div className="mb-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {t("tokenChip.editor.emphasis")}
              </label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    setDraftWeight(clampWeight(draftWeight - WEIGHT_STEP))
                  }
                  disabled={draftWeight <= MIN_WEIGHT}
                  className="flex h-5 w-5 items-center justify-center rounded border border-border/50 text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:opacity-30"
                >
                  <Minus className="h-2.5 w-2.5" />
                </button>
                <span className="w-7 text-center font-mono text-[10px] tabular-nums text-foreground/80">
                  {formatWeight(draftWeight)}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setDraftWeight(clampWeight(draftWeight + WEIGHT_STEP))
                  }
                  disabled={draftWeight >= MAX_WEIGHT}
                  className="flex h-5 w-5 items-center justify-center rounded border border-border/50 text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:opacity-30"
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
              className="mt-1 h-1.5 w-full cursor-pointer accent-primary"
            />
            <div className="mt-2">
              <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                {t("tokenChip.editor.expression")}
              </p>
              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-1.5 text-xs text-foreground/80">
                  <input
                    type="radio"
                    name="group-weight-expr"
                    checked={draftExpression === "numerical"}
                    onChange={() => setDraftExpression("numerical")}
                  />
                  {t("tokenChip.editor.numerical")}
                </label>
                <label className="inline-flex items-center gap-1.5 text-xs text-foreground/80">
                  <input
                    type="radio"
                    name="group-weight-expr"
                    checked={draftExpression === "keyword"}
                    onChange={() => setDraftExpression("keyword")}
                  />
                  {t("tokenChip.editor.keyword")}
                </label>
              </div>
            </div>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-1.5 pt-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded border transition-colors",
                actionsCopied
                  ? "border-primary/50 text-primary"
                  : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
              onClick={() => {
                void navigator.clipboard.writeText(tokenToRawString(token));
                setActionsCopied(true);
                setTimeout(() => setActionsCopied(false), 1200);
              }}
              title={t("promptInput.context.copy")}
              aria-label={t("promptInput.context.copy")}
            >
              {actionsCopied ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
            {onDelete ? (
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded border border-border text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                onClick={() => {
                  void navigator.clipboard.writeText(tokenToRawString(token));
                  setActivePopup(null);
                  onDelete();
                }}
                title={t("promptInput.context.cut")}
                aria-label={t("promptInput.context.cut")}
              >
                <Scissors className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {onDelete ? (
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded border border-destructive/40 text-destructive/70 hover:bg-destructive/10 hover:text-destructive transition-colors"
                onClick={() => {
                  setActivePopup(null);
                  onDelete();
                }}
                title={t("common.delete")}
                aria-label={t("common.delete")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="h-7 rounded border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => setActivePopup(null)}
            >
              {t("common.cancel")}
            </button>
            {onChange ? (
              <button
                type="button"
                onClick={handleActionsApply}
                className="h-7 rounded border border-primary/50 bg-primary/10 px-2 text-[11px] text-primary hover:bg-primary/20"
              >
                {t("groupChip.apply")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    ) : null;

  const popoverContent =
    activePopup === "preview"
      ? previewPopover
      : activePopup === "actions"
        ? actionsPopover
        : activePopup === "editor"
          ? editorPopover
          : null;

  const popover =
    activePopup !== null && typeof document !== "undefined"
      ? createPortal(popoverContent, document.body)
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
        style: { transform: CSS.Translate.toString(transform), transition },
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
