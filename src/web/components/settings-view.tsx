import {
  Settings as SettingsIcon,
  X,
  RotateCcw,
  RefreshCw,
  Trash2,
  Info,
  Check,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DEFAULTS, type Settings } from "@/hooks/useSettings";
import { THEMES } from "@/lib/themes";
import { SUPPORTED_APP_LANGUAGES } from "@/lib/language";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
import { KeybindingPanel } from "@/components/keybinding-panel";
import type { KeyBinding, KeyBindingId, Keybindings } from "@/lib/keybindings";

interface SettingsViewProps {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  onReset: (keys?: (keyof Settings)[]) => void;
  onClose: () => void;
  onResetHashes: () => Promise<void>;
  onRescanMetadata: () => Promise<number>;
  isAnalyzing: boolean;
  scanning: boolean;
  bindings: Keybindings;
  onUpdateBinding: (id: KeyBindingId, binding: KeyBinding) => void;
  onResetBinding: (id: KeyBindingId) => void;
  onResetAllBindings: () => void;
}

function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground transition-colors"
      title={i18n.t("settings.resetToDefault")}
    >
      <RotateCcw className="h-3.5 w-3.5" />
    </button>
  );
}

function SectionHeader({
  children,
  onReset,
  suffix,
}: {
  children: React.ReactNode;
  onReset: () => void;
  suffix?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium text-foreground select-none">
          {children}
        </h2>
        <ResetButton onClick={onReset} />
      </div>
      {suffix}
    </div>
  );
}

function OptionGroup<T extends number>({
  value,
  options,
  label,
  onChange,
}: {
  value: T;
  options: T[];
  label: (v: T) => string;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={cn(
            "px-3 py-1.5 text-sm rounded-md border transition-colors max-sm:py-2.5",
            value === opt
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-secondary text-muted-foreground border-border hover:text-foreground hover:border-foreground/30",
          )}
        >
          {label(opt)}
        </button>
      ))}
    </div>
  );
}

const similarityQualityLabel = (value: number): string =>
  i18n.t(`settings.similarity.quality.${value}`, {
    defaultValue: String(value),
  });

const jaccardLabel = (value: number): string => {
  if (value >= 0.68) return i18n.t("settings.similarity.jaccard.veryStrict");
  if (value >= 0.64) return i18n.t("settings.similarity.jaccard.strict");
  if (value >= 0.58) return i18n.t("settings.similarity.jaccard.balanced");
  if (value >= 0.54) return i18n.t("settings.similarity.jaccard.loose");
  return i18n.t("settings.similarity.jaccard.veryLoose");
};

const PAGE_SIZE_PRESETS = [10, 20, 50, 100] as const;
const PAGE_SIZE_MIN = 10;
const PAGE_SIZE_MAX = 100;

function PageSizeSection({
  value,
  onUpdate,
  onReset,
}: {
  value: number;
  onUpdate: (patch: Partial<Settings>) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const isPreset = (PAGE_SIZE_PRESETS as readonly number[]).includes(value);
  const [editing, setEditing] = useState(false);
  const [customDraft, setCustomDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  const openEditor = () => {
    setCustomDraft(String(value));
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const commitCustomValue = () => {
    const parsed = parseInt(customDraft, 10);
    if (Number.isNaN(parsed)) {
      setEditing(false);
      return;
    }
    const clamped = Math.max(PAGE_SIZE_MIN, Math.min(PAGE_SIZE_MAX, parsed));
    onUpdate({ pageSize: clamped });
    setCustomDraft(String(clamped));
    setEditing(false);
  };

  const cancelEditor = () => {
    setCustomDraft(String(value));
    setEditing(false);
  };

  return (
    <div className="space-y-2">
      <SectionHeader onReset={onReset}>
        {t("settings.pageSize.title")}
      </SectionHeader>
      <p className="text-xs text-muted-foreground select-none">
        {t("settings.pageSize.description")}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {PAGE_SIZE_PRESETS.map((opt) => (
          <button
            key={opt}
            onClick={() => {
              onUpdate({ pageSize: opt });
              setEditing(false);
            }}
            className={cn(
              "px-3 py-1.5 text-sm rounded-md border transition-colors max-sm:py-2.5",
              value === opt && isPreset && !editing
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-secondary text-muted-foreground border-border hover:text-foreground hover:border-foreground/30",
            )}
          >
            {t("settings.pageSize.unit", { count: opt })}
          </button>
        ))}
        <div className="flex items-center gap-1.5">
          <button
            onClick={openEditor}
            className={cn(
              "px-3 py-1.5 text-sm rounded-md border transition-colors max-sm:py-2.5",
              !isPreset || editing
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-secondary text-muted-foreground border-border hover:text-foreground hover:border-foreground/30",
            )}
          >
            {!isPreset && !editing
              ? t("settings.pageSize.unit", { count: value })
              : t("settings.pageSize.custom")}
          </button>
          {editing && (
            <>
              <Input
                ref={inputRef}
                type="number"
                min={PAGE_SIZE_MIN}
                max={PAGE_SIZE_MAX}
                value={customDraft}
                onChange={(e) => setCustomDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitCustomValue();
                  if (e.key === "Escape") cancelEditor();
                }}
                className="h-auto w-16 px-2 py-1.5 text-sm rounded-md border border-border bg-secondary dark:bg-secondary text-foreground text-center tabular-nums shadow-none focus-visible:ring-1 focus-visible:ring-primary focus-visible:border-border"
              />
              <button
                onClick={commitCustomValue}
                className="p-1.5 rounded-md border border-border bg-secondary text-foreground hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors"
                title={t("settings.pageSize.confirm")}
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={cancelEditor}
                className="p-1.5 rounded-md border border-border bg-secondary text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                title={t("settings.pageSize.cancel")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const SIMILARITY_MIN = 8;
const SIMILARITY_MAX = 16;
const SIMILARITY_SPAN = SIMILARITY_MAX - SIMILARITY_MIN;
const TEXT_LINK_THRESHOLD_STRICT = 0.64;
const TEXT_LINK_THRESHOLD_LOOSE = 0.54;
const JACCARD_MIN = 0.5;
const JACCARD_MAX = 0.7;

function formatBytes(bytes: number | null): string {
  if (bytes === null) return i18n.t("settings.database.unknown");
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function derivePromptThreshold(similarityThreshold: number): number {
  const looseness = Math.min(
    1,
    Math.max(0, (similarityThreshold - SIMILARITY_MIN) / SIMILARITY_SPAN),
  );
  const threshold =
    TEXT_LINK_THRESHOLD_STRICT +
    (TEXT_LINK_THRESHOLD_LOOSE - TEXT_LINK_THRESHOLD_STRICT) * looseness;
  return Number(threshold.toFixed(2));
}

export function SettingsView({
  settings,
  onUpdate,
  onReset,
  onClose,
  onResetHashes,
  onRescanMetadata,
  isAnalyzing,
  scanning,
  bindings,
  onUpdateBinding,
  onResetBinding,
  onResetAllBindings,
}: SettingsViewProps) {
  const { t } = useTranslation();
  const [rescanProgress, setRescanProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  useEffect(() => {
    const offProgress = window.image.onRescanMetadataProgress((data) => {
      setRescanProgress(data);
    });
    const offReset = window.appInfo.onUtilityReset(() => {
      setRescanProgress(null);
    });
    return () => {
      offProgress();
      offReset();
    };
  }, []);
  const [resetting, setResetting] = useState(false);
  const rescanning =
    !!rescanProgress &&
    rescanProgress.total > 0 &&
    rescanProgress.done < rescanProgress.total;
  const [ignoredDuplicates, setIgnoredDuplicates] = useState<string[]>([]);
  const [ignoredLoading, setIgnoredLoading] = useState(false);
  const [ignoredClearing, setIgnoredClearing] = useState(false);
  const [ignoredError, setIgnoredError] = useState<string | null>(null);
  const [dbFileSize, setDbFileSize] = useState<number | null>(null);
  const [promptsDbSchemaVersion, setPromptsDbSchemaVersion] = useState<
    number | null
  >(null);
  const visualSliderValue = Number(
    (
      SIMILARITY_MAX -
      (settings.visualSimilarityThreshold - SIMILARITY_MIN)
    ).toFixed(0),
  );

  const sliderToSimilarityThreshold = (sliderValue: number): number =>
    SIMILARITY_MIN + (SIMILARITY_SPAN - (sliderValue - SIMILARITY_MIN));

  const handleBaseSimilarityChange = (nextSimilarity: number): void => {
    if (settings.useAdvancedSimilarityThresholds) {
      onUpdate({ similarityThreshold: nextSimilarity });
      return;
    }

    onUpdate({
      similarityThreshold: nextSimilarity,
      visualSimilarityThreshold: nextSimilarity,
      promptSimilarityThreshold: derivePromptThreshold(nextSimilarity),
    });
  };

  const handleSimilarityModeChange = (useAdvanced: boolean): void => {
    if (!useAdvanced) {
      onUpdate({ useAdvancedSimilarityThresholds: false });
      return;
    }

    const shouldBootstrapFromBasic =
      settings.visualSimilarityThreshold ===
        DEFAULTS.visualSimilarityThreshold &&
      settings.promptSimilarityThreshold === DEFAULTS.promptSimilarityThreshold;

    if (!shouldBootstrapFromBasic) {
      onUpdate({ useAdvancedSimilarityThresholds: true });
      return;
    }

    onUpdate({
      useAdvancedSimilarityThresholds: true,
      visualSimilarityThreshold: settings.similarityThreshold,
      promptSimilarityThreshold: derivePromptThreshold(
        settings.similarityThreshold,
      ),
    });
  };

  const loadIgnoredDuplicates = useCallback(async () => {
    setIgnoredLoading(true);
    setIgnoredError(null);
    try {
      const rows = await window.image.listIgnoredDuplicates();
      setIgnoredDuplicates(rows);
    } catch (e: unknown) {
      setIgnoredError(
        e instanceof Error ? e.message : i18n.t("settings.ignored.loadError"),
      );
    } finally {
      setIgnoredLoading(false);
    }
  }, []);

  const handleResetAll = () => {
    onReset();
  };

  const handleReset = async () => {
    setResetting(true);
    await onResetHashes();
    setResetting(false);
  };

  const handleRescanMetadata = async () => {
    try {
      const count = await onRescanMetadata();
      if (count > 0) {
        toast.success(t("settings.metadataRescan.success", { count }));
      } else {
        toast.info(t("settings.metadataRescan.noChanges"));
      }
    } catch {
      setRescanProgress(null);
    }
  };

  const handleClearIgnoredDuplicates = async () => {
    setIgnoredClearing(true);
    setIgnoredError(null);
    try {
      await window.image.clearIgnoredDuplicates();
      await loadIgnoredDuplicates();
    } catch (e: unknown) {
      setIgnoredError(
        e instanceof Error ? e.message : t("settings.ignored.clearError"),
      );
    } finally {
      setIgnoredClearing(false);
    }
  };

  useEffect(() => {
    void loadIgnoredDuplicates();
  }, [loadIgnoredDuplicates]);

  useEffect(() => {
    window.appInfo
      .getDbFileSize()
      .then((size) => setDbFileSize(size))
      .catch(() => setDbFileSize(null));

    window.appInfo
      .getPromptsDbSchemaVersion()
      .then((version) => setPromptsDbSchemaVersion(version))
      .catch(() => setPromptsDbSchemaVersion(null));
  }, []);

  return (
    <div className="flex-1 overflow-y-auto p-8 max-sm:p-5">
      <div className="max-w-lg space-y-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <SettingsIcon className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold text-foreground select-none">
              {t("settings.title")}
            </h1>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleResetAll}
              className="text-xs h-8 gap-1.5 text-muted-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t("settings.resetAll")}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <SectionHeader onReset={() => onReset(["language"])}>
            {t("settings.language.title")}
          </SectionHeader>
          <p className="text-xs text-muted-foreground select-none">
            {t("settings.language.description")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SUPPORTED_APP_LANGUAGES.map((language) => (
              <button
                key={language}
                onClick={() => onUpdate({ language })}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-md border transition-colors max-sm:py-2.5",
                  settings.language === language
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary text-muted-foreground border-border hover:text-foreground hover:border-foreground/30",
                )}
              >
                {t(`settings.language.${language}`)}
              </button>
            ))}
          </div>
        </div>

        <Separator className="bg-border" />

        <div className="space-y-2">
          <SectionHeader onReset={() => onReset(["theme"])}>
            {t("settings.theme.title")}
          </SectionHeader>
          <p className="text-xs text-muted-foreground select-none">
            {t("settings.theme.description")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {THEMES.map((theme) => (
              <button
                key={theme.id}
                onClick={() => onUpdate({ theme: theme.id })}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-md border transition-colors max-sm:py-2.5",
                  settings.theme === theme.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary text-muted-foreground border-border hover:text-foreground hover:border-foreground/30",
                )}
              >
                {t(`settings.theme.options.${theme.id}`)}
              </button>
            ))}
          </div>
        </div>

        <Separator className="bg-border" />

        <div className="space-y-2">
          <SectionHeader onReset={() => onReset(["thumbnailQuality"])}>
            {t("settings.thumbnailQuality.title")}
          </SectionHeader>
          <p className="text-xs text-muted-foreground select-none">
            {t("settings.thumbnailQuality.description")}
          </p>
          <div className="flex flex-wrap gap-2">
            {(["low", "normal", "high"] as const).map((q) => (
              <button
                key={q}
                onClick={() => onUpdate({ thumbnailQuality: q })}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-md border transition-colors max-sm:py-2.5",
                  settings.thumbnailQuality === q
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary text-muted-foreground border-border hover:text-foreground hover:border-foreground/30",
                )}
              >
                {t(`settings.thumbnailQuality.${q}`)}
              </button>
            ))}
          </div>
        </div>

        <Separator className="bg-border" />

        <PageSizeSection
          value={settings.pageSize}
          onUpdate={onUpdate}
          onReset={() => onReset(["pageSize"])}
        />

        <Separator className="bg-border" />

        <div className="space-y-2">
          <SectionHeader onReset={() => onReset(["recentDays"])}>
            {t("settings.recentRange.title")}
          </SectionHeader>
          <p className="text-xs text-muted-foreground select-none">
            {t("settings.recentRange.description")}
          </p>
          <OptionGroup
            value={settings.recentDays}
            options={[1, 3, 7, 14, 30, 60, 90] as number[]}
            label={(v) => t("settings.recentRange.unit", { count: v })}
            onChange={(v) => onUpdate({ recentDays: v })}
          />
        </div>

        <Separator className="bg-border" />

        <div className="space-y-2">
          <SectionHeader onReset={() => onReset(["similarPageSize"])}>
            {t("settings.similarPageSize.title")}
          </SectionHeader>
          <p className="text-xs text-muted-foreground select-none">
            {t("settings.similarPageSize.description")}
          </p>
          <OptionGroup
            value={settings.similarPageSize}
            options={[5, 10, 20, 50] as number[]}
            label={(v) => t("settings.similarPageSize.unit", { count: v })}
            onChange={(v) => onUpdate({ similarPageSize: v })}
          />
        </div>

        <Separator className="bg-border" />

        <div className="space-y-2">
          <SectionHeader
            onReset={() =>
              onReset([
                "similarityThreshold",
                "useAdvancedSimilarityThresholds",
                "visualSimilarityThreshold",
                "promptSimilarityThreshold",
              ])
            }
            suffix={
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={t("settings.similarity.tooltipAria")}
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border/60 bg-transparent text-muted-foreground transition-colors hover:border-border hover:bg-secondary/40 hover:text-foreground"
                    >
                      <Info className="h-3 w-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    sideOffset={8}
                    className="max-w-80 text-foreground/85 p-2"
                  >
                    {t("settings.similarity.tooltipDescription")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            }
          >
            {t("settings.similarity.title")}
          </SectionHeader>
          <p className="text-xs text-muted-foreground select-none">
            {t("settings.similarity.description")}
          </p>
          <div className="rounded-md border border-border/60 p-3 space-y-3">
            <div className="space-y-2">
              {/* Mobile: segmented control */}
              <div
                className="flex sm:hidden rounded-md border border-border overflow-hidden"
                role="radiogroup"
                aria-label={t("settings.similarity.modeAria")}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={!settings.useAdvancedSimilarityThresholds}
                  onClick={() => handleSimilarityModeChange(false)}
                  className={cn(
                    "flex-1 px-3 py-2 text-sm font-medium transition-colors",
                    !settings.useAdvancedSimilarityThresholds
                      ? "bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/40",
                  )}
                >
                  {t("settings.similarity.mode.basic.title")}
                </button>
                <div className="w-px bg-border" />
                <button
                  type="button"
                  role="radio"
                  aria-checked={settings.useAdvancedSimilarityThresholds}
                  onClick={() => handleSimilarityModeChange(true)}
                  className={cn(
                    "flex-1 px-3 py-2 text-sm font-medium transition-colors",
                    settings.useAdvancedSimilarityThresholds
                      ? "bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/40",
                  )}
                >
                  {t("settings.similarity.mode.advanced.title")}
                </button>
              </div>
              <p className="block sm:hidden text-xs text-muted-foreground">
                {settings.useAdvancedSimilarityThresholds
                  ? t("settings.similarity.mode.advanced.description")
                  : t("settings.similarity.mode.basic.description")}
              </p>

              {/* Desktop: card layout */}
              <div
                className="hidden sm:grid grid-cols-2 gap-2"
                role="radiogroup"
                aria-label={t("settings.similarity.modeAria")}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={!settings.useAdvancedSimilarityThresholds}
                  onClick={() => handleSimilarityModeChange(false)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-left transition-colors",
                    !settings.useAdvancedSimilarityThresholds
                      ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                      : "border-border bg-secondary/20 hover:border-foreground/30 hover:bg-secondary/40",
                  )}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-block h-2.5 w-2.5 rounded-full",
                        !settings.useAdvancedSimilarityThresholds
                          ? "bg-primary"
                          : "bg-border",
                      )}
                    />
                    <p className="text-sm font-medium text-foreground">
                      {t("settings.similarity.mode.basic.title")}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("settings.similarity.mode.basic.description")}
                  </p>
                </button>

                <button
                  type="button"
                  role="radio"
                  aria-checked={settings.useAdvancedSimilarityThresholds}
                  onClick={() => handleSimilarityModeChange(true)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-left transition-colors",
                    settings.useAdvancedSimilarityThresholds
                      ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                      : "border-border bg-secondary/20 hover:border-foreground/30 hover:bg-secondary/40",
                  )}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-block h-2.5 w-2.5 rounded-full",
                        settings.useAdvancedSimilarityThresholds
                          ? "bg-primary"
                          : "bg-border",
                      )}
                    />
                    <p className="text-sm font-medium text-foreground">
                      {t("settings.similarity.mode.advanced.title")}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("settings.similarity.mode.advanced.description")}
                  </p>
                </button>
              </div>
            </div>

            <div className="rounded-md border border-border/50 bg-secondary/20 px-3 py-2 text-xs text-muted-foreground">
              {settings.useAdvancedSimilarityThresholds
                ? t("settings.similarity.currentApplied", {
                    visual: settings.visualSimilarityThreshold,
                    visualLabel: similarityQualityLabel(
                      settings.visualSimilarityThreshold,
                    ),
                    prompt: settings.promptSimilarityThreshold.toFixed(2),
                    promptLabel: jaccardLabel(
                      settings.promptSimilarityThreshold,
                    ),
                  })
                : t("settings.similarity.currentApplied", {
                    visual: settings.similarityThreshold,
                    visualLabel: similarityQualityLabel(
                      settings.similarityThreshold,
                    ),
                    prompt: derivePromptThreshold(
                      settings.similarityThreshold,
                    ).toFixed(2),
                    promptLabel: jaccardLabel(
                      settings.promptSimilarityThreshold,
                    ),
                  })}
            </div>

            {!settings.useAdvancedSimilarityThresholds ? (
              <div className="space-y-3 border-t border-border/50 pt-3">
                {/* <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>기본 유사도: {settings.similarityThreshold}</span>
                  <span>
                    {similarityQualityLabel(settings.similarityThreshold)}
                  </span>
                </div> */}
                <OptionGroup
                  value={settings.similarityThreshold}
                  options={[16, 14, 12, 10, 8] as number[]}
                  label={(v) => `${similarityQualityLabel(v)}`}
                  onChange={(v) => handleBaseSimilarityChange(v)}
                />
                {/* <p className="text-[11px] text-muted-foreground/80">
                  대부분의 사용자에게 적합합니다.
                </p> */}
              </div>
            ) : (
              <div className="space-y-4 border-t border-border/50 pt-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-center space-x-1 text-xs text-muted-foreground">
                    <span>
                      {`Visual (Perceptual Hash): ${settings.visualSimilarityThreshold}`}
                    </span>
                    <span>
                      (
                      {similarityQualityLabel(
                        settings.visualSimilarityThreshold,
                      )}
                      )
                    </span>
                  </div>
                  <input
                    type="range"
                    min={SIMILARITY_MIN}
                    max={SIMILARITY_MAX}
                    step={1}
                    value={visualSliderValue}
                    onChange={(e) =>
                      onUpdate({
                        visualSimilarityThreshold: sliderToSimilarityThreshold(
                          Number(e.target.value),
                        ),
                      })
                    }
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-primary bg-secondary"
                  />
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground/80">
                    <span>{t("settings.similarity.visualRange.loose")}</span>
                    <span>{t("settings.similarity.visualRange.strict")}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-center space-x-1 text-xs text-muted-foreground">
                    <span>
                      Prompt (Jaccard):{" "}
                      {settings.promptSimilarityThreshold.toFixed(2)}
                    </span>
                    <span>
                      ({jaccardLabel(settings.promptSimilarityThreshold)})
                    </span>
                  </div>
                  <input
                    type="range"
                    min={JACCARD_MIN}
                    max={JACCARD_MAX}
                    step={0.01}
                    value={settings.promptSimilarityThreshold}
                    onChange={(e) =>
                      onUpdate({
                        promptSimilarityThreshold: Number(
                          Number(e.target.value).toFixed(2),
                        ),
                      })
                    }
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-primary bg-secondary"
                  />
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground/80">
                    <span>{t("settings.similarity.promptRange.loose")}</span>
                    <span>{t("settings.similarity.promptRange.strict")}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <Separator className="bg-border" />

        <div className="space-y-2">
          <h2 className="text-sm font-medium text-foreground select-none">
            {t("settings.keybindings.title")}
          </h2>
          <p className="hidden max-sm:block rounded-md border border-border/60 bg-secondary/20 px-3 py-2 text-xs text-muted-foreground select-none">
            {t("settings.keybindings.mobileNotice")}
          </p>
          <div className="hidden sm:block">
            <KeybindingPanel
              bindings={bindings}
              onUpdate={onUpdateBinding}
              onReset={onResetBinding}
              onResetAll={onResetAllBindings}
            />
          </div>
        </div>

        <Separator className="bg-border" />

        <div className="space-y-2">
          <h2 className="text-sm font-medium text-foreground select-none">
            {t("settings.ignored.title")}
          </h2>
          <p className="text-xs text-muted-foreground select-none">
            {t("settings.ignored.description")}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={loadIgnoredDuplicates}
              disabled={ignoredLoading || ignoredClearing}
            >
              <RefreshCw
                className={cn(
                  "h-4 w-4 mr-1.5",
                  ignoredLoading && "animate-spin",
                )}
              />
              {t("settings.ignored.refresh")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleClearIgnoredDuplicates}
              disabled={ignoredClearing || ignoredLoading}
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              {ignoredClearing
                ? t("settings.ignored.clearing")
                : t("settings.ignored.clear")}
            </Button>
          </div>
          {ignoredError && (
            <p className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2">
              {ignoredError}
            </p>
          )}
          <div className="rounded-md border border-border/60 bg-secondary/10">
            <div className="px-3 py-2 border-b border-border/60 text-xs text-muted-foreground">
              {t("settings.ignored.total", { count: ignoredDuplicates.length })}
            </div>
            <div className="max-h-40 overflow-auto px-3 py-2">
              {ignoredDuplicates.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("settings.ignored.empty")}
                </p>
              ) : (
                <ul className="space-y-1">
                  {ignoredDuplicates.map((filePath) => (
                    <li
                      key={filePath}
                      className="text-xs text-muted-foreground font-mono break-all"
                    >
                      {filePath}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <Separator className="bg-border" />

        <div className="space-y-2">
          <h2 className="text-sm font-medium text-foreground select-none">
            {t("settings.database.title")}
          </h2>
          <div className="rounded-md border border-border/60 bg-secondary/10">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-muted-foreground select-none">
                {t("settings.database.imageSize")}
              </span>
              <span className="text-xs font-mono text-foreground">
                {formatBytes(dbFileSize)}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-border/60 px-3 py-2">
              <span className="text-xs text-muted-foreground select-none">
                {t("settings.database.tagSchemaVersion")}
              </span>
              <span className="text-xs font-mono text-foreground">
                {promptsDbSchemaVersion ?? "-"}
              </span>
            </div>
          </div>
        </div>

        <Separator className="bg-border" />

        <div className="space-y-2">
          <h2 className="text-sm font-medium text-foreground select-none">
            {t("settings.metadataRescan.title")}
          </h2>
          <p className="text-xs text-muted-foreground select-none">
            {t("settings.metadataRescan.description")}
          </p>
          <Button
            variant="secondary"
            onClick={handleRescanMetadata}
            disabled={rescanning || scanning}
          >
            {rescanning && rescanProgress
              ? t("settings.metadataRescan.rescanning", rescanProgress)
              : rescanning
                ? t("settings.metadataRescan.rescanning", {
                    done: 0,
                    total: "?",
                  })
                : t("settings.metadataRescan.action")}
          </Button>
        </div>

        <Separator className="bg-border" />

        <div className="space-y-2">
          <h2 className="text-sm font-medium text-foreground select-none">
            {t("settings.hashReset.title")}
          </h2>
          <p className="text-xs text-muted-foreground select-none">
            {t("settings.hashReset.description")}
          </p>
          <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-warning/35 bg-warning/15 text-[11px] font-bold leading-none">
              !
            </span>
            <p className="select-none">{t("settings.hashReset.warning")}</p>
          </div>
          <Button
            variant="secondary"
            onClick={handleReset}
            disabled={resetting || isAnalyzing || scanning}
          >
            {resetting
              ? t("settings.hashReset.resetting")
              : isAnalyzing
                ? t("settings.hashReset.calculating")
                : t("settings.hashReset.action")}
          </Button>
        </div>
      </div>
    </div>
  );
}
