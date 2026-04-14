import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  DEFAULT_KEYBINDINGS,
  findConflicts,
  formatKeyBinding,
  isModifiedBinding,
  type KeyBinding,
  type KeyBindingId,
  type Keybindings,
} from "@/lib/keybindings";
import { useTranslation } from "react-i18next";

interface KeybindingPanelProps {
  bindings: Keybindings;
  onUpdate: (id: KeyBindingId, binding: KeyBinding) => void;
  onReset: (id: KeyBindingId) => void;
  onResetAll: () => void;
}

type Group = {
  labelKey: string;
  ids: KeyBindingId[];
};

const GROUPS: Group[] = [
  {
    labelKey: "settings.keybindings.groups.panel",
    ids: [
      "panel.generator",
      "panel.gallery",
      "panel.tagSearch",
      "panel.settings",
    ],
  },
  {
    labelKey: "settings.keybindings.groups.browse",
    ids: [
      "browse.all",
      "browse.recent",
      "browse.favorites",
      "browse.randomPick",
      "browse.randomRefresh",
    ],
  },
  {
    labelKey: "settings.keybindings.groups.gallery",
    ids: [
      "gallery.focusSearch",
      "gallery.prevPage",
      "gallery.nextPage",
    ],
  },
  {
    labelKey: "settings.keybindings.groups.detail",
    ids: [
      "detail.close",
      "detail.prev",
      "detail.next",
      "detail.favorite",
      "detail.copyPrompt",
      "detail.delete",
    ],
  },
  {
    labelKey: "settings.keybindings.groups.generator",
    ids: ["generator.generate"],
  },
];

const ID_TO_GROUP_LABEL: Record<KeyBindingId, string> = Object.fromEntries(
  GROUPS.flatMap((g) => g.ids.map((id) => [id, g.labelKey])),
) as Record<KeyBindingId, string>;

// 캡처 시 무시할 단독 modifier 키
const MODIFIER_KEYS = new Set([
  "Control",
  "Shift",
  "Alt",
  "Meta",
  "CapsLock",
  "NumLock",
  "ScrollLock",
]);

function KeyCapture({
  onCapture,
  onCancel,
}: {
  onCapture: (binding: KeyBinding) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        onCancel();
        return;
      }
      if (MODIFIER_KEYS.has(e.key)) return;

      onCapture({
        key: e.key,
        ctrl: e.ctrlKey || undefined,
        shift: e.shiftKey || undefined,
        alt: e.altKey || undefined,
      });
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onCapture, onCancel]);

  return (
    <span className="animate-pulse text-xs text-primary font-medium">
      {t("settings.keybindings.pressKey")}
    </span>
  );
}

function KeyBindingRow({
  id,
  bindings,
  capturing,
  onStartCapture,
  onCapture,
  onCancelCapture,
  onReset,
}: {
  id: KeyBindingId;
  bindings: Keybindings;
  capturing: boolean;
  onStartCapture: () => void;
  onCapture: (binding: KeyBinding) => void;
  onCancelCapture: () => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const binding = bindings[id];
  const modified = isModifiedBinding(id, bindings);
  const conflicts = findConflicts(id, binding, bindings);
  const hasConflict = conflicts.length > 0;

  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="flex-1 text-xs text-foreground select-none truncate">
        {t(`settings.keybindings.actions.${id}`)}
      </span>

      <button
        onClick={onStartCapture}
        className={cn(
          "min-w-[96px] rounded border px-2 py-1 text-xs font-mono text-center transition-colors",
          capturing
            ? "border-primary bg-primary/10"
            : hasConflict
              ? "border-warning/60 bg-warning/10 text-warning hover:bg-warning/15"
              : "border-border bg-secondary/40 text-foreground hover:bg-secondary/70",
        )}
        title={t("settings.keybindings.clickToChange")}
      >
        {capturing ? (
          <KeyCapture onCapture={onCapture} onCancel={onCancelCapture} />
        ) : (
          formatKeyBinding(binding)
        )}
      </button>

      <button
        onClick={onReset}
        disabled={!modified}
        className={cn(
          "transition-colors",
          modified
            ? "text-muted-foreground hover:text-foreground"
            : "text-muted-foreground/30 cursor-default",
        )}
        title={t("settings.resetToDefault")}
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>

      {hasConflict && !capturing && (
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-default text-[10px] text-warning leading-none">
                ⚠
              </span>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8} className="max-w-80 text-foreground/85 p-2">
              {conflicts
                .map(
                  (c) =>
                    `${t(ID_TO_GROUP_LABEL[c])} · ${t(`settings.keybindings.actions.${c}`)}`,
                )
                .join(", ")}
              {t("settings.keybindings.conflictSuffix")}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

export function KeybindingPanel({
  bindings,
  onUpdate,
  onReset,
  onResetAll,
}: KeybindingPanelProps) {
  const { t } = useTranslation();
  const [capturingId, setCapturingId] = useState<KeyBindingId | null>(null);
  const hasAnyModified = (
    Object.keys(DEFAULT_KEYBINDINGS) as KeyBindingId[]
  ).some((id) => isModifiedBinding(id, bindings));

  const handleCapture = useCallback(
    (id: KeyBindingId, binding: KeyBinding) => {
      onUpdate(id, binding);
      setCapturingId(null);
    },
    [onUpdate],
  );

  const handleCancelCapture = useCallback(() => {
    setCapturingId(null);
  }, []);

  // 패널 외부 클릭 시 캡처 취소
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!capturingId) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setCapturingId(null);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [capturingId]);

  return (
    <div ref={panelRef} className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground select-none">
          {t("settings.keybindings.description")}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={onResetAll}
          disabled={!hasAnyModified}
          className="h-7 px-2 text-xs text-muted-foreground"
        >
          <RotateCcw className="mr-1 h-3 w-3" />
          {t("settings.keybindings.resetAll")}
        </Button>
      </div>

      {GROUPS.map((group) => (
        <div key={group.labelKey} className="space-y-0.5">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide select-none mb-1">
            {t(group.labelKey)}
          </p>
          <div className="rounded-md border border-border/60 bg-secondary/10 divide-y divide-border/40 px-3">
            {group.ids.map((id) => (
              <KeyBindingRow
                key={id}
                id={id}
                bindings={bindings}
                capturing={capturingId === id}
                onStartCapture={() => setCapturingId(id)}
                onCapture={(b) => handleCapture(id, b)}
                onCancelCapture={handleCancelCapture}
                onReset={() => onReset(id)}
              />
            ))}
          </div>
        </div>
      ))}

    </div>
  );
}
