import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  PromptCategory,
  PromptGroup,
  PromptTagSuggestion,
  PromptTagSuggestStats,
} from "@preload/index.d";
import { PromptTagSuggestionIndicator } from "./prompt-tag-suggestion-indicator";

const DRAG_MIME = "application/x-konomi-token";
const TAG_SUGGEST_LIMIT = 8;
const EMPTY_PROMPT_TAG_SUGGEST_STATS: PromptTagSuggestStats = {
  totalTags: 0,
  maxCount: 0,
  bucketThresholds: [],
};

function parseGroupTagDraft(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function formatGroupTagDraft(group: PromptGroup): string {
  return group.tokens.map((token) => token.label).join(", ");
}

function getGroupTagDraftContext(value: string, caretPosition: number) {
  const clampedCaret = Math.max(0, Math.min(caretPosition, value.length));

  let segmentStart = clampedCaret;
  while (
    segmentStart > 0 &&
    value[segmentStart - 1] !== "," &&
    value[segmentStart - 1] !== "\n"
  ) {
    segmentStart -= 1;
  }

  let segmentEnd = clampedCaret;
  while (
    segmentEnd < value.length &&
    value[segmentEnd] !== "," &&
    value[segmentEnd] !== "\n"
  ) {
    segmentEnd += 1;
  }

  const currentPrefix = value.slice(segmentStart, clampedCaret).trim();
  const exclude = [
    ...parseGroupTagDraft(value.slice(0, segmentStart)),
    ...parseGroupTagDraft(value.slice(segmentEnd)),
  ];

  return {
    segmentStart,
    segmentEnd,
    prefix: currentPrefix,
    exclude,
  };
}

async function syncGroupTokens(
  groupId: number,
  currentTokens: PromptGroup["tokens"],
  nextLabels: string[],
): Promise<PromptGroup["tokens"]> {
  const reusableTokens = new Map<string, PromptGroup["tokens"]>();

  currentTokens.forEach((token) => {
    const queue = reusableTokens.get(token.label);
    if (queue) {
      queue.push(token);
      return;
    }
    reusableTokens.set(token.label, [token]);
  });

  const nextTokens: PromptGroup["tokens"] = [];

  for (const label of nextLabels) {
    const queue = reusableTokens.get(label);
    const reusable = queue?.shift();
    if (reusable) {
      nextTokens.push(reusable);
      continue;
    }
    nextTokens.push(await window.promptBuilder.createToken(groupId, label));
  }

  const staleTokens = [...reusableTokens.values()].flat();
  if (staleTokens.length > 0) {
    await Promise.all(
      staleTokens.map((token) => window.promptBuilder.deleteToken(token.id)),
    );
  }

  const needsReorder = nextTokens.some(
    (token, index) =>
      token.id !== currentTokens[index]?.id || token.order !== index,
  );
  if (needsReorder && nextTokens.length > 0) {
    await window.promptBuilder.reorderTokens(
      groupId,
      nextTokens.map((token) => token.id),
    );
  }

  return nextTokens.map((token, index) => ({
    ...token,
    groupId,
    order: index,
  }));
}

interface PromptGroupPanelProps {
  categories: PromptCategory[];
  onCategoriesChange: (categories: PromptCategory[]) => void;
}

function DraggableGroupChip({ groupName }: { groupName: string }) {
  const [dragging, setDragging] = useState(false);

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(
                DRAG_MIME,
                JSON.stringify({ kind: "group", groupName }),
              );
              e.dataTransfer.effectAllowed = "copy";
              setDragging(true);
            }}
            onDragEnd={() => setDragging(false)}
            className={cn(
              "inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-xs",
              "cursor-grab active:cursor-grabbing select-none transition-opacity shrink-0",
              "bg-group/14 text-group border-group/35",
              dragging && "opacity-40",
            )}
          >
            <GripVertical className="h-2.5 w-2.5 text-group/70 shrink-0 -ml-0.5" />
            <span className="font-semibold text-group">@</span>
            <span className="truncate max-w-20">{`{${groupName}}`}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>{`@{${groupName}}`}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface GroupFormAreaProps {
  initialName?: string;
  initialTags?: string;
  submitLabel: string;
  onSubmit: (name: string, tags: string[]) => void;
  onClose: () => void;
}

function GroupFormArea({
  initialName = "",
  initialTags = "",
  submitLabel,
  onSubmit,
  onClose,
}: GroupFormAreaProps) {
  const { t } = useTranslation();
  const [nameDraft, setNameDraft] = useState(initialName);
  const [tagsDraft, setTagsDraft] = useState(initialTags);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const tagsInputRef = useRef<HTMLTextAreaElement | null>(null);
  const tagSuggestDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const tagSuggestRequestSeqRef = useRef(0);
  const suppressTagSuggestOnceRef = useRef(false);
  const parsedTags = useMemo(() => parseGroupTagDraft(tagsDraft), [tagsDraft]);
  const canSubmit = nameDraft.trim().length > 0 && parsedTags.length > 0;
  const [tagCaretPosition, setTagCaretPosition] = useState(initialTags.length);
  const [tagSuggestions, setTagSuggestions] = useState<PromptTagSuggestion[]>(
    [],
  );
  const [tagSuggestionStats, setTagSuggestionStats] =
    useState<PromptTagSuggestStats>(EMPTY_PROMPT_TAG_SUGGEST_STATS);
  const [tagSuggestionOpen, setTagSuggestionOpen] = useState(false);
  const [tagSuggestionIndex, setTagSuggestionIndex] = useState(-1);
  const [isTagsInputFocused, setIsTagsInputFocused] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => nameInputRef.current?.focus());
  }, []);

  useEffect(
    () => () => {
      if (tagSuggestDebounceRef.current) {
        clearTimeout(tagSuggestDebounceRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!isTagsInputFocused) {
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

    const { prefix, exclude } = getGroupTagDraftContext(
      tagsDraft,
      tagCaretPosition,
    );

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
          exclude,
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
  }, [isTagsInputFocused, tagCaretPosition, tagsDraft]);

  const handleSubmit = () => {
    const name = nameDraft.trim();
    if (!name || parsedTags.length === 0) return;
    onSubmit(name, parsedTags);
  };

  const applyTagSuggestion = (suggestion: PromptTagSuggestion) => {
    const textarea = tagsInputRef.current;
    const caretPosition = textarea?.selectionStart ?? tagCaretPosition;
    const { segmentStart, segmentEnd } = getGroupTagDraftContext(
      tagsDraft,
      caretPosition,
    );
    const currentSegment = tagsDraft.slice(segmentStart, segmentEnd);
    const leadingWhitespace = currentSegment.match(/^\s*/)?.[0] ?? "";
    const trailingWhitespace = currentSegment.match(/\s*$/)?.[0] ?? "";
    const replacement = `${leadingWhitespace}${suggestion.tag}${trailingWhitespace}`;
    const nextValue =
      tagsDraft.slice(0, segmentStart) +
      replacement +
      tagsDraft.slice(segmentEnd);
    const nextCaretPosition =
      segmentStart + leadingWhitespace.length + suggestion.tag.length;

    suppressTagSuggestOnceRef.current = true;
    setTagsDraft(nextValue);
    setTagCaretPosition(nextCaretPosition);
    setTagSuggestions([]);
    setTagSuggestionStats(EMPTY_PROMPT_TAG_SUGGEST_STATS);
    setTagSuggestionOpen(false);
    setTagSuggestionIndex(-1);

    requestAnimationFrame(() => {
      const nextTextarea = tagsInputRef.current;
      if (!nextTextarea) return;
      nextTextarea.focus();
      nextTextarea.setSelectionRange(nextCaretPosition, nextCaretPosition);
    });
  };

  const syncTagCaretPosition = () => {
    const textarea = tagsInputRef.current;
    if (!textarea) return;
    setTagCaretPosition(textarea.selectionStart ?? textarea.value.length);
  };

  return (
    <div className="mx-2 mb-2 rounded border border-border/40 bg-secondary/30 p-2.5">
      <div className="space-y-2">
        <input
          ref={nameInputRef}
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
            if (e.key === "Escape") onClose();
          }}
          placeholder={t("promptGroupPanel.groupNamePlaceholder")}
          aria-label={t("promptGroupPanel.groupNamePlaceholder")}
          className="h-8 w-full rounded border border-border/60 bg-background px-2 text-xs text-foreground outline-none focus:border-primary/60"
        />
        <div className="relative">
          <textarea
            ref={tagsInputRef}
            value={tagsDraft}
            onChange={(e) => {
              setTagsDraft(e.target.value);
              setTagCaretPosition(
                e.target.selectionStart ?? e.target.value.length,
              );
            }}
            onFocus={() => {
              setIsTagsInputFocused(true);
              syncTagCaretPosition();
            }}
            onBlur={() => {
              setIsTagsInputFocused(false);
            }}
            onClick={syncTagCaretPosition}
            onKeyUp={syncTagCaretPosition}
            onSelect={syncTagCaretPosition}
            onKeyDown={(e) => {
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
                if (e.key === "Tab") {
                  e.preventDefault();
                  applyTagSuggestion(
                    tagSuggestions[tagSuggestionIndex] ?? tagSuggestions[0],
                  );
                  return;
                }
                if (e.key === "Enter" && tagSuggestionIndex >= 0) {
                  e.preventDefault();
                  applyTagSuggestion(
                    tagSuggestions[tagSuggestionIndex] ?? tagSuggestions[0],
                  );
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setTagSuggestions([]);
                  setTagSuggestionStats(EMPTY_PROMPT_TAG_SUGGEST_STATS);
                  setTagSuggestionOpen(false);
                  setTagSuggestionIndex(-1);
                  return;
                }
              }

              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                handleSubmit();
                return;
              }
              if (e.key === "Escape") onClose();
            }}
            rows={3}
            placeholder={t("promptGroupPanel.tagsPlaceholder")}
            aria-label={t("promptGroupPanel.groupTags")}
            className="block w-full resize-none rounded border border-border/60 bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/60 placeholder:text-muted-foreground/40"
          />
          {tagSuggestionOpen && tagSuggestions.length > 0 ? (
            <div className="absolute top-full left-0 z-20 mt-1 max-h-56 w-full overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-popover shadow-lg">
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
          ) : null}
        </div>
      </div>

      {parsedTags.length === 0 ? (
        <p className="mt-2 py-1 text-center text-[11px] text-muted-foreground/40">
          {t("promptGroupPanel.noTags")}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1">
          {parsedTags.map((tag, index) => (
            <span
              key={`${tag}-${index}`}
              className="rounded border border-border/40 bg-muted px-1.5 py-0.5 text-[11px] text-foreground/80"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onClose}
          className="h-7 rounded border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="h-7 rounded border border-primary/50 bg-primary/10 px-2 text-[11px] text-primary hover:bg-primary/20 disabled:opacity-40"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

interface GroupRowProps {
  group: PromptGroup;
  onSave: (name: string, tags: string[]) => void;
  onDelete: () => void;
}

function GroupRow({ group, onSave, onDelete }: GroupRowProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div>
      <div className="group/grow flex items-center gap-1 px-2 py-0.5">
        <DraggableGroupChip groupName={group.name} />

        <span className="flex-1 min-w-0 truncate select-none text-[11px] text-muted-foreground/50">
          {group.tokens.length > 0
            ? group.tokens.map((token) => token.label).join(", ")
            : ""}
        </span>

        {!editing && !confirmDelete && (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/grow:opacity-100">
            <button
              type="button"
              onClick={() => setEditing(true)}
              title={t("promptGroupPanel.editGroup")}
              aria-label={t("promptGroupPanel.editGroup")}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/40 transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Pencil className="h-2.5 w-2.5" />
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              title={t("common.delete")}
              aria-label={t("common.delete")}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-2.5 w-2.5" />
            </button>
          </div>
        )}

        {confirmDelete && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onDelete}
              className="h-5 rounded border border-destructive/30 bg-destructive/15 px-1.5 text-[10px] text-destructive transition-colors hover:bg-destructive/25"
            >
              {t("common.delete")}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              title={t("common.close")}
              aria-label={t("common.close")}
              className="flex h-5 w-5 items-center justify-center rounded text-xs text-muted-foreground/40 transition-colors hover:bg-secondary hover:text-foreground"
            >
              x
            </button>
          </div>
        )}
      </div>

      {editing && (
        <GroupFormArea
          initialName={group.name}
          initialTags={formatGroupTagDraft(group)}
          submitLabel={t("promptGroupPanel.saveGroup")}
          onSubmit={(name, tags) => {
            onSave(name, tags);
            setEditing(false);
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

interface CategoryItemProps {
  category: PromptCategory;
  onRename: (name: string) => void;
  onDelete: () => void;
  onAddGroup: (name: string, tags: string[]) => void;
  onDeleteGroup: (groupId: number) => void;
  onSaveGroup: (groupId: number, name: string, tags: string[]) => void;
}

const BUILTIN_PROMPT_CATEGORY_KEYS = [
  "peopleCount",
  "rating",
  "artStyle",
  "composition",
  "location",
  "effects",
  "qualityTags",
  "characterGender",
  "characterSpecific",
  "characterAge",
  "characterHairEyes",
  "characterOutfit",
  "characterPose",
  "characterAction",
  "characterBodyPart",
  "characterFace",
  "characterEffects",
] as const;

function getDisplayCategoryName(
  category: PromptCategory,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (!category.isBuiltin) return category.name;

  const builtinKey = BUILTIN_PROMPT_CATEGORY_KEYS[category.order];
  if (!builtinKey) return category.name;

  return t(`promptGroupPanel.builtinCategories.${builtinKey}`);
}

function CategoryItem({
  category,
  onRename,
  onDelete,
  onAddGroup,
  onDeleteGroup,
  onSaveGroup,
}: CategoryItemProps) {
  const { t } = useTranslation();
  const displayName = getDisplayCategoryName(category, t);
  const [expanded, setExpanded] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(category.name);
  const [addingGroup, setAddingGroup] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (renaming) {
      setRenameDraft(category.name);
      requestAnimationFrame(() => renameInputRef.current?.select());
    }
  }, [renaming, category.name]);

  const commitRename = () => {
    const name = renameDraft.trim();
    if (name && name !== category.name) onRename(name);
    setRenaming(false);
  };

  return (
    <div className="border-b border-border/20 last:border-b-0">
      <div className="group/cat flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground/80 hover:text-foreground"
          title={
            expanded
              ? t("promptGroupPanel.collapse")
              : t("promptGroupPanel.expand")
          }
          aria-label={
            expanded
              ? t("promptGroupPanel.collapse")
              : t("promptGroupPanel.expand")
          }
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </button>

        {renaming ? (
          <input
            ref={renameInputRef}
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              }
              if (e.key === "Escape") setRenaming(false);
            }}
            onBlur={commitRename}
            className="flex-1 min-w-0 h-5 rounded border border-primary/60 bg-background px-1.5 text-xs text-foreground outline-none"
          />
        ) : (
          <span
            className="flex-1 min-w-0 cursor-pointer truncate select-none text-xs font-medium text-foreground/80"
            onClick={() => setExpanded((value) => !value)}
          >
            {displayName}
          </span>
        )}

        <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground/80">
          {category.groups.length}
        </span>

        {!renaming && !confirmDelete && (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => {
                setExpanded(true);
                setAddingGroup(true);
              }}
              title={t("promptGroupPanel.addGroup")}
              aria-label={t("promptGroupPanel.addGroup")}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/80 transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Plus className="h-2.5 w-2.5" />
            </button>
            {!category.isBuiltin && (
              <button
                type="button"
                onClick={() => setRenaming(true)}
                title={t("promptGroupPanel.renameCategory")}
                aria-label={t("promptGroupPanel.renameCategory")}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/80 transition-colors hover:bg-secondary hover:text-foreground"
              >
                <Pencil className="h-2.5 w-2.5" />
              </button>
            )}
            {!category.isBuiltin && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                title={t("common.delete")}
                aria-label={t("common.delete")}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/80 transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        )}

        {confirmDelete && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onDelete}
              className="h-5 rounded border border-destructive/30 bg-destructive/15 px-1.5 text-[10px] text-destructive transition-colors hover:bg-destructive/25"
            >
              {t("common.delete")}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              title={t("common.close")}
              aria-label={t("common.close")}
              className="flex h-5 w-5 items-center justify-center rounded text-xs text-muted-foreground/40 transition-colors hover:bg-secondary hover:text-foreground"
            >
              x
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <div className="bg-secondary/10">
          {category.groups.length === 0 && !addingGroup ? (
            <p className="py-1.5 text-center text-[11px] text-muted-foreground/60">
              {t("promptGroupPanel.noGroups")}
            </p>
          ) : (
            <div className="py-0.5">
              {category.groups.map((group) => (
                <GroupRow
                  key={group.id}
                  group={group}
                  onSave={(name, tags) => onSaveGroup(group.id, name, tags)}
                  onDelete={() => onDeleteGroup(group.id)}
                />
              ))}
            </div>
          )}

          {addingGroup ? (
            <GroupFormArea
              submitLabel={t("promptGroupPanel.addGroup")}
              onSubmit={(name, tags) => {
                onAddGroup(name, tags);
                setAddingGroup(false);
              }}
              onClose={() => setAddingGroup(false)}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

export const PromptGroupPanel = memo(function PromptGroupPanel({
  categories,
  onCategoriesChange,
}: PromptGroupPanelProps) {
  const { t } = useTranslation();
  const [newCategoryName, setNewCategoryName] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);

  const handleCreateCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    const created = await window.promptBuilder.createCategory(name);
    onCategoriesChange([...categories, created]);
    setNewCategoryName("");
  };

  const handleRenameCategory = async (id: number, name: string) => {
    await window.promptBuilder.renameCategory(id, name);
    onCategoriesChange(
      categories.map((category) =>
        category.id === id ? { ...category, name } : category,
      ),
    );
  };

  const handleDeleteCategory = async (id: number) => {
    await window.promptBuilder.deleteCategory(id);
    onCategoriesChange(categories.filter((category) => category.id !== id));
  };

  const handleAddGroup = async (
    categoryId: number,
    name: string,
    tags: string[],
  ) => {
    const group = await window.promptBuilder.createGroup(categoryId, name);
    const nextTokens: PromptGroup["tokens"] = [];

    for (const label of tags) {
      nextTokens.push(await window.promptBuilder.createToken(group.id, label));
    }

    onCategoriesChange(
      categories.map((category) =>
        category.id === categoryId
          ? {
              ...category,
              groups: [
                ...category.groups,
                { ...group, name, tokens: nextTokens },
              ],
            }
          : category,
      ),
    );
  };

  const handleDeleteGroup = async (categoryId: number, groupId: number) => {
    await window.promptBuilder.deleteGroup(groupId);
    onCategoriesChange(
      categories.map((category) =>
        category.id === categoryId
          ? {
              ...category,
              groups: category.groups.filter((group) => group.id !== groupId),
            }
          : category,
      ),
    );
  };

  const handleSaveGroup = async (
    categoryId: number,
    groupId: number,
    name: string,
    tags: string[],
  ) => {
    const currentGroup = categories
      .find((category) => category.id === categoryId)
      ?.groups.find((group) => group.id === groupId);

    if (!currentGroup) return;

    if (name !== currentGroup.name) {
      await window.promptBuilder.renameGroup(groupId, name);
    }

    const nextTokens = await syncGroupTokens(
      groupId,
      currentGroup.tokens,
      tags,
    );

    onCategoriesChange(
      categories.map((category) =>
        category.id === categoryId
          ? {
              ...category,
              groups: category.groups.map((group) =>
                group.id === groupId
                  ? { ...group, name, tokens: nextTokens }
                  : group,
              ),
            }
          : category,
      ),
    );
  };

  const handleResetCategories = async () => {
    await window.promptBuilder.resetCategories();
    const nextCategories = await window.promptBuilder.listCategories();
    onCategoriesChange(nextCategories);
    setConfirmReset(false);
  };

  useEffect(() => {
    if (categories.length > 0) return;
    window.promptBuilder
      .listCategories()
      .then((nextCategories) => onCategoriesChange(nextCategories))
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-border/30 px-3 pt-2.5 pb-1.5">
        <p className="select-none text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t("promptGroupPanel.title")}
        </p>
        {confirmReset ? (
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-destructive">
              {t("promptGroupPanel.resetDescription")}
            </span>
            <button
              type="button"
              onClick={() => void handleResetCategories()}
              className="h-5 rounded border border-destructive/30 bg-destructive/15 px-1.5 text-[10px] text-destructive transition-colors hover:bg-destructive/25"
            >
              {t("generation.dialogs.confirm")}
            </button>
            <button
              type="button"
              onClick={() => setConfirmReset(false)}
              title={t("common.close")}
              aria-label={t("common.close")}
              className="flex h-5 w-5 items-center justify-center rounded text-xs text-muted-foreground/80 transition-colors hover:bg-secondary hover:text-foreground"
            >
              x
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            title={t("promptGroupPanel.resetToDefault")}
            aria-label={t("promptGroupPanel.resetToDefault")}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/80 transition-colors hover:bg-secondary hover:text-muted-foreground"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        )}
      </div>

      <p className="shrink-0 border-b border-border/20 px-3 py-1.5 text-xs text-muted-foreground/80 select-none">
        {t("promptGroupPanel.dragHint")}
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {categories.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground/40">
            {t("promptGroupPanel.noCategories")}
          </p>
        ) : (
          categories.map((category) => (
            <CategoryItem
              key={category.id}
              category={category}
              onRename={(name) => void handleRenameCategory(category.id, name)}
              onDelete={() => void handleDeleteCategory(category.id)}
              onAddGroup={(name, tags) =>
                void handleAddGroup(category.id, name, tags)
              }
              onDeleteGroup={(groupId) =>
                void handleDeleteGroup(category.id, groupId)
              }
              onSaveGroup={(groupId, name, tags) =>
                void handleSaveGroup(category.id, groupId, name, tags)
              }
            />
          ))
        )}
      </div>

      <div className="shrink-0 border-t border-border/40 p-2">
        <div className="flex gap-1">
          <input
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleCreateCategory();
              }
            }}
            placeholder={t("promptGroupPanel.newCategoryPlaceholder")}
            className="flex-1 min-w-0 h-7 rounded border border-border/60 bg-secondary/60 px-2 text-xs text-foreground outline-none focus:border-primary/60 placeholder:text-muted-foreground/40"
          />
          <button
            type="button"
            onClick={() => void handleCreateCategory()}
            disabled={!newCategoryName.trim()}
            title={t("promptGroupPanel.createCategory")}
            aria-label={t("promptGroupPanel.createCategory")}
            className="flex h-7 w-7 items-center justify-center rounded border border-primary/30 bg-primary/15 text-primary transition-colors hover:bg-primary/25 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
});
