import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  Loader2,
  Save,
  Wand2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Shuffle,
  Settings,
  X,
  ImagePlus,
  Sparkles,
  Crosshair,
  Plus,
  Trash2,
  FolderOpen,
  Check,
  LayoutList,
  Image as ImageIcon,
  Info,
  TriangleAlert,
  ChevronUp,
  Hash,
  Copy,
  Download,
  ArrowRightLeft,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select as RadixSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { cn } from "@/lib/utils";
import type {
  NaiConfig,
  GenerateParams,
  PromptCategory,
  PromptGroup,
} from "@preload/index.d";
import type { NovelAIMeta } from "@/types/nai";
import type { ImageData } from "@/components/image-card";
import { PromptInput } from "@/components/prompt-input";
import { PromptGroupPanel } from "@/components/prompt-group-panel";
import { PromptSourcePanel } from "@/components/prompt-source-panel";

type DropItem =
  | { kind: "file"; file: File; name: string }
  | { kind: "image"; image: ImageData; name: string }
  | { kind: "path"; path: string; src: string; name: string };

type RefImage = {
  data: Uint8Array;
  previewUrl: string;
  name: string;
  isObjectUrl: boolean;
};

type I2IRef = RefImage & { strength: number; noise: number };
type VibeRef = RefImage & {
  id: string;
  infoExtracted: number;
  strength: number;
};
type PreciseRef = RefImage & { fidelity: number };

type CharacterPromptMode = "prompt" | "negativePrompt";
type GenerationService = "novelai" | "webui";

type CharacterPosition =
  | "global"
  | "A1"
  | "A2"
  | "A3"
  | "A4"
  | "A5"
  | "B1"
  | "B2"
  | "B3"
  | "B4"
  | "B5"
  | "C1"
  | "C2"
  | "C3"
  | "C4"
  | "C5"
  | "D1"
  | "D2"
  | "D3"
  | "D4"
  | "D5"
  | "E1"
  | "E2"
  | "E3"
  | "E4"
  | "E5";

const POSITION_COLS = ["A", "B", "C", "D", "E"] as const;
const POSITION_ROWS = [1, 2, 3, 4, 5] as const;
const GENERATION_SERVICES: Array<{
  id: GenerationService;
  label: string;
  disabled?: boolean;
}> = [
  { id: "novelai", label: "NovelAI" },
  { id: "webui", label: "WebUI", disabled: true },
];

const POSITION_GRID_GAP = 6;
const POSITION_GRID_EDGE_PAD = 8;

// Per-character: position picker popover button (shown only when AI's Choice is OFF)
function PositionAdjustButton({
  value,
  onChange,
}: {
  value: CharacterPosition;
  onChange: (v: CharacterPosition) => void;
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const btn = btnRef.current;
      const pop = popoverRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const popH = pop?.offsetHeight ?? 140;
      const popW = pop?.offsetWidth ?? 120;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = rect.left;
      left = Math.max(
        POSITION_GRID_EDGE_PAD,
        Math.min(left, vw - popW - POSITION_GRID_EDGE_PAD),
      );
      const spaceBelow = vh - rect.bottom - POSITION_GRID_EDGE_PAD;
      const spaceAbove = rect.top - POSITION_GRID_EDGE_PAD;
      const top =
        spaceBelow >= popH || spaceBelow >= spaceAbove
          ? rect.bottom + POSITION_GRID_GAP
          : rect.top - popH - POSITION_GRID_GAP;
      setPopoverStyle({ position: "fixed", top, left, zIndex: 3000 });
    };
    const raf = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const onMouseDown = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (popoverRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [open]);

  const popover =
    open &&
    createPortal(
      <div
        ref={popoverRef}
        style={
          popoverStyle ?? {
            position: "fixed",
            top: -9999,
            left: -9999,
            zIndex: 3000,
            visibility: "hidden",
          }
        }
        className="rounded-md border border-border bg-popover p-2.5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
          Position
        </p>
        <div
          className="grid gap-0.5"
          style={{ gridTemplateColumns: "repeat(5, 1fr)" }}
        >
          {POSITION_ROWS.map((row) =>
            POSITION_COLS.map((col) => {
              const key = `${col}${row}` as CharacterPosition;
              return (
                <button
                  key={key}
                  type="button"
                  title={key}
                  onClick={() => {
                    onChange(key);
                    setOpen(false);
                  }}
                  className={cn(
                    "w-5 h-5 rounded-sm transition-colors text-[8px] font-mono",
                    value === key
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary/60 hover:bg-secondary text-muted-foreground/40 hover:text-foreground",
                  )}
                >
                  {key}
                </button>
              );
            }),
          )}
        </div>
      </div>,
      document.body,
    );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1 text-[11px] px-2 py-1 rounded border transition-colors",
          open
            ? "bg-secondary border-border text-foreground"
            : "border-border/50 text-muted-foreground hover:text-foreground hover:border-border",
        )}
      >
        <Crosshair className="h-3 w-3" />
        {value}
        <ChevronDown className="h-2.5 w-2.5" />
      </button>
      {popover}
    </>
  );
}

type CharacterPromptInput = {
  prompt: string;
  negativePrompt: string;
  inputMode: CharacterPromptMode;
  position: CharacterPosition;
};
type AppendPromptTagRequest = {
  id: number;
  tag: string;
};

type CharacterPromptPreset = "female" | "male" | "other";
const CHARACTER_PROMPT_PRESETS: Array<{
  value: CharacterPromptPreset;
  label: string;
  promptPrefix: string;
}> = [
  { value: "female", label: "Female", promptPrefix: "girl, " },
  { value: "male", label: "Male", promptPrefix: "boy, " },
  { value: "other", label: "Other", promptPrefix: "" },
];

const createCharacterPromptInput = (prompt = ""): CharacterPromptInput => ({
  prompt,
  negativePrompt: "",
  inputMode: "prompt",
  position: "global",
});

const MODELS = [
  { value: "nai-diffusion-4-5-full", label: "NAI Diffusion V4.5 Full" },
  { value: "nai-diffusion-4-5-curated", label: "NAI Diffusion V4.5 Curated" },
  { value: "nai-diffusion-4-full-preview", label: "NAI Diffusion V4 Full" },
  {
    value: "nai-diffusion-4-curated-preview",
    label: "NAI Diffusion V4 Curated",
  },
  { value: "nai-diffusion-3", label: "NAI Diffusion V3 Anime" },
  { value: "nai-diffusion-furry-3", label: "NAI Diffusion V3 Furry" },
];

const SIZE_PRESETS = [
  { key: "portrait", width: 832, height: 1216 },
  { key: "landscape", width: 1216, height: 832 },
  { key: "square", width: 1024, height: 1024 },
] as const;

const CUSTOM_SIZES_KEY = "konomi-custom-sizes";

type CustomSize = { width: number; height: number };

function loadCustomSizes(): CustomSize[] {
  try {
    const stored = localStorage.getItem(CUSTOM_SIZES_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is CustomSize =>
        x !== null &&
        typeof x === "object" &&
        typeof (x as CustomSize).width === "number" &&
        typeof (x as CustomSize).height === "number",
    );
  } catch {
    return [];
  }
}

function saveCustomSizes(sizes: CustomSize[]): void {
  try {
    localStorage.setItem(CUSTOM_SIZES_KEY, JSON.stringify(sizes));
  } catch {
    // ignore
  }
}

const SAMPLERS = [
  "k_euler",
  "k_euler_ancestral",
  "k_dpmpp_2s_ancestral",
  "k_dpmpp_2m",
  "k_dpmpp_sde",
  "ddim",
];

const NOISE_SCHEDULES = ["karras", "exponential", "polyexponential", "native"];
const SAMPLER_OPTIONS = SAMPLERS.map((sampler) => ({
  value: sampler,
  label: sampler,
}));
const NOISE_SCHEDULE_OPTIONS = NOISE_SCHEDULES.map((noiseSchedule) => ({
  value: noiseSchedule,
  label: noiseSchedule,
}));
const INFINITY_SYMBOL = "\u221E";
const NAI_GEN_PERSIST_DELAY_MS = 200;

const INPUT_CLS =
  "w-full bg-secondary/60 border border-border/60 rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 focus:bg-secondary transition-colors";

interface ImportChecks {
  prompt: boolean;
  negativePrompt: boolean;
  characters: boolean;
  charactersAppend: boolean;
  settings: boolean;
  seed: boolean;
}

function SectionHeader({
  label,
  action,
}: {
  label: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 shrink-0">
        {label}
      </span>
      <div className="flex-1 h-px bg-border/40" />
      {action}
    </div>
  );
}

function FieldLabel({
  label,
  value,
}: {
  label: string;
  value?: string | number;
}) {
  return (
    <div className="flex items-center justify-between mb-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {value !== undefined && (
        <span className="text-xs font-mono text-foreground/80 bg-secondary px-1.5 py-0.5 rounded">
          {value}
        </span>
      )}
    </div>
  );
}

function SelectBase({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <RadixSelect value={value} onValueChange={onChange}>
      <SelectTrigger
        className={cn(
          "w-full justify-between rounded-lg border-border/60 bg-secondary/60 px-3 py-1.5 text-sm text-foreground shadow-none transition-colors focus-visible:border-primary/60 focus-visible:bg-secondary focus-visible:ring-0 [&_svg]:size-3 [&_svg]:text-muted-foreground/60",
          className,
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </RadixSelect>
  );
}
const Select = memo(SelectBase);

const INLINE_SELECT_TRIGGER_CLS =
  "h-auto data-[size=default]:h-auto p-0 border-none bg-transparent dark:bg-transparent hover:bg-transparent dark:hover:bg-transparent shadow-none text-sm font-semibold text-foreground gap-1 focus-visible:ring-0 [&_svg]:size-3.5 cursor-pointer";

function InlineSelectBase({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <RadixSelect value={value} onValueChange={onChange}>
      <SelectTrigger className={cn(INLINE_SELECT_TRIGGER_CLS, className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </RadixSelect>
  );
}
const InlineSelect = memo(InlineSelectBase);

function Slider({
  min,
  max,
  step = 1,
  value,
  onChange,
  onCommit,
  disabled,
}: {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  disabled?: boolean;
}) {
  const handleCommit = (event: React.SyntheticEvent<HTMLInputElement>) => {
    onCommit?.(Number(event.currentTarget.value));
  };

  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      onBlur={handleCommit}
      onKeyUp={handleCommit}
      onPointerUp={handleCommit}
      className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-primary bg-secondary disabled:opacity-30 disabled:cursor-not-allowed"
    />
  );
}

function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex items-center gap-2.5",
        disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer group",
      )}
    >
      <div
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          "h-4 w-4 rounded border transition-all flex items-center justify-center shrink-0",
          checked && !disabled
            ? "bg-primary border-primary"
            : "border-border/60 bg-secondary/60",
          !disabled && "group-hover:border-border",
        )}
      >
        {checked && (
          <svg
            viewBox="0 0 12 12"
            className="h-2.5 w-2.5 text-primary-foreground"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M2 6l3 3 5-5" />
          </svg>
        )}
      </div>
      <span
        className="text-sm text-foreground/80 select-none"
        onClick={() => !disabled && onChange(!checked)}
      >
        {label}
      </span>
    </label>
  );
}

function RefCard({
  previewUrl,
  onRemove,
  children,
}: {
  previewUrl: string;
  onRemove: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-secondary/20 p-3 space-y-2.5">
      <div className="flex items-center gap-2.5">
        <img
          src={previewUrl}
          alt=""
          className="h-10 w-10 rounded object-cover shrink-0 border border-border/30"
        />
        <div className="flex-1" />
        <button
          onClick={onRemove}
          className="shrink-0 h-6 w-6 rounded flex items-center justify-center text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {children}
    </div>
  );
}

interface GenerationViewProps {
  pendingImport?: ImageData | null;
  onClearPendingImport?: () => void;
  pendingSourceImport?: ImageData | null;
  onClearPendingSourceImport?: () => void;
  outputFolder: string;
  onOutputFolderChange: (folder: string) => void;
  appendPromptTagRequest?: AppendPromptTagRequest | null;
  tourActive?: boolean;
  tourAction?: string | null;
}

const LAST_GEN_PARAMS_KEY = "konomi-last-gen-params";
const AUTO_GEN_POLICY_AGREEMENT_KEY = "konomi-auto-gen-policy-agreed";
const NAI_SEED_MIN = 0;
const NAI_SEED_MAX = 4294967295;

function loadLastGenParams() {
  try {
    const stored = localStorage.getItem(LAST_GEN_PARAMS_KEY);
    if (!stored) return null;
    return JSON.parse(stored) as {
      prompt: string;
      negativePrompt: string;
      characterPrompts: CharacterPromptInput[];
      aiChoice: boolean;
      seedInput: string;
    };
  } catch {
    return null;
  }
}

function loadAutoGenPolicyAgreement() {
  try {
    return localStorage.getItem(AUTO_GEN_POLICY_AGREEMENT_KEY) === "true";
  } catch {
    return false;
  }
}

function createRandomSeed() {
  return Math.floor(Math.random() * (NAI_SEED_MAX + 1));
}

function parseSeedInputValue(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "empty" as const };
  if (!/^\d+$/.test(trimmed)) return { kind: "invalid" as const };
  const parsed = Number(trimmed);
  if (
    !Number.isInteger(parsed) ||
    parsed < NAI_SEED_MIN ||
    parsed > NAI_SEED_MAX
  ) {
    return { kind: "invalid" as const };
  }
  return { kind: "valid" as const, value: parsed };
}

function getStoredSeedInput(raw: string) {
  return parseSeedInputValue(raw).kind === "invalid" ? "" : raw;
}

const NAI_GEN_KEY = "konomi-nai-gen-settings";
const NAI_GEN_DEFAULTS = {
  model: "nai-diffusion-4-5-full",
  width: 832,
  height: 1216,
  steps: 28,
  scale: 5.0,
  cfgRescale: 0,
  varietyPlus: false,
  sampler: "k_euler_ancestral",
  noiseSchedule: "karras",
};

function loadNaiGenSettings() {
  try {
    const stored = localStorage.getItem(NAI_GEN_KEY);
    return stored
      ? { ...NAI_GEN_DEFAULTS, ...JSON.parse(stored) }
      : NAI_GEN_DEFAULTS;
  } catch {
    return NAI_GEN_DEFAULTS;
  }
}

function useLatestRef<T>(value: T) {
  const ref = useRef(value);

  useLayoutEffect(() => {
    ref.current = value;
  }, [value]);

  return ref;
}

function expandGroupRefsFromCategories(
  text: string,
  categories: PromptCategory[],
): string {
  return text.replace(
    /@\{([^:}]+)(?::([^}]*))?\}/g,
    (_, name: string, overrideStr?: string) => {
      if (overrideStr !== undefined) {
        const tags = overrideStr
          .split("|")
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0);
        return tags.join(", ");
      }
      const group = categories
        .flatMap((category) => category.groups)
        .find((groupItem) => groupItem.name === name);
      if (!group || group.tokens.length === 0) return "";
      return group.tokens.map((token) => token.label).join(", ");
    },
  );
}

function RecentThumb({
  src,
  isCurrent,
  onClick,
}: {
  src: string;
  isCurrent: boolean;
  onClick: () => void;
}) {
  const [loaded, setLoaded] = useState(false);

  const handleDragStart = (e: React.DragEvent) => {
    const path = decodeURIComponent(new URL(src).pathname.slice(1));
    e.dataTransfer.setData("text/x-konomi-path", path);
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <button
      draggable
      onDragStart={handleDragStart}
      className={cn(
        "relative w-full aspect-square rounded-md overflow-hidden ring-2 transition-all block",
        isCurrent
          ? "ring-primary cursor-default"
          : "ring-transparent hover:ring-primary/50 cursor-grab active:cursor-grabbing",
      )}
      onClick={onClick}
    >
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-secondary/40">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/40" />
        </div>
      )}
      <img
        src={src}
        alt=""
        className="w-full h-full object-cover"
        onLoad={() => setLoaded(true)}
      />
    </button>
  );
}

function DeferredNumberInput({
  value,
  onChange,
  className,
  min,
  max,
  step,
}: {
  value: number;
  onChange: (v: number) => void;
  className?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [local, setLocal] = useState(String(value));

  useEffect(() => {
    setLocal(String(value));
  }, [value]);

  const handleCommit = useCallback(() => {
    const parsed = Number(local);
    if (!Number.isFinite(parsed)) {
      setLocal(String(value));
      return;
    }

    const nextValue = Math.min(max ?? parsed, Math.max(min ?? parsed, parsed));
    setLocal(String(nextValue));
    onChange(nextValue);
  }, [local, max, min, onChange, value]);

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={handleCommit}
      className={className}
    />
  );
}

const INLINE_NUM_CLS =
  "w-10 text-sm font-semibold tabular-nums leading-none bg-transparent border-none outline-none text-foreground p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

const formatInteger = (value: number) => String(value);
const formatOneDecimal = (value: number) => value.toFixed(1);
const formatTwoDecimals = (value: number) => value.toFixed(2);

const AdvancedSamplerSummary = memo(function AdvancedSamplerSummary({
  sampler,
  setSampler,
}: {
  sampler: string;
  setSampler: (v: string) => void;
}) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wide">
        Sampler
      </span>
      <InlineSelect
        value={sampler}
        onChange={setSampler}
        options={SAMPLER_OPTIONS}
        className="max-w-37.5"
      />
    </span>
  );
});

const AdvancedSamplerNoiseControls = memo(
  function AdvancedSamplerNoiseControls({
    sampler,
    setSampler,
    noiseSchedule,
    setNoiseSchedule,
  }: {
    sampler: string;
    setSampler: (v: string) => void;
    noiseSchedule: string;
    setNoiseSchedule: (v: string) => void;
  }) {
    const { t } = useTranslation();

    return (
      <div className="grid grid-cols-2 gap-2">
        <div>
          <FieldLabel label={t("generation.advanced.sampler")} />
          <Select
            value={sampler}
            onChange={setSampler}
            options={SAMPLER_OPTIONS}
          />
        </div>
        <div>
          <FieldLabel label={t("generation.advanced.noise")} />
          <Select
            value={noiseSchedule}
            onChange={setNoiseSchedule}
            options={NOISE_SCHEDULE_OPTIONS}
          />
        </div>
      </div>
    );
  },
);

const AdvancedInlineNumberSummary = memo(function AdvancedInlineNumberSummary({
  label,
  value,
  setValue,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  setValue: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  const handleChange = useCallback(
    (nextValue: number) => {
      if (nextValue !== value) setValue(nextValue);
    },
    [setValue, value],
  );

  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wide">
        {label}
      </span>
      <DeferredNumberInput
        value={value}
        onChange={handleChange}
        min={min}
        max={max}
        step={step}
        className={INLINE_NUM_CLS}
      />
    </span>
  );
});

const AdvancedSeedSummary = memo(function AdvancedSeedSummary({
  seedInput,
  setSeedInput,
}: {
  seedInput: string;
  setSeedInput: (v: string) => void;
}) {
  const [localSeed, setLocalSeed] = useState(seedInput);
  const [seedFocused, setSeedFocused] = useState(false);

  useEffect(() => {
    if (!seedFocused) setLocalSeed(seedInput);
  }, [seedFocused, seedInput]);

  const commitSeedInput = useCallback(
    (nextValue = localSeed) => {
      setSeedFocused(false);
      if (nextValue !== seedInput) setSeedInput(nextValue);
    },
    [localSeed, seedInput, setSeedInput],
  );

  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wide">
        Seed
      </span>
      <input
        type="text"
        inputMode="numeric"
        value={localSeed}
        readOnly={!!localSeed.trim() && !seedFocused}
        onMouseDown={
          localSeed.trim() && !seedFocused
            ? (e) => {
                e.preventDefault();
                setLocalSeed("");
                setSeedInput("");
              }
            : undefined
        }
        onChange={(e) => setLocalSeed(e.target.value)}
        onFocus={() => setSeedFocused(true)}
        onBlur={() => commitSeedInput()}
        placeholder="-"
        className={cn(
          "w-16 max-w-16 text-sm font-semibold tabular-nums leading-none font-mono bg-transparent border-none outline-none text-foreground placeholder:text-foreground/30 p-0",
          localSeed.trim() && !seedFocused && "cursor-pointer truncate",
        )}
      />
    </span>
  );
});

const AdvancedSliderControl = memo(function AdvancedSliderControl({
  label,
  value,
  setValue,
  min,
  max,
  step,
  formatValue,
}: {
  label: string;
  value: number;
  setValue: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  formatValue: (value: number) => string;
}) {
  const [draftValue, setDraftValue] = useState(value);

  useEffect(() => {
    setDraftValue(value);
  }, [value]);

  const commitValue = useCallback(
    (nextValue: number) => {
      if (nextValue !== value) setValue(nextValue);
    },
    [setValue, value],
  );

  return (
    <div>
      <FieldLabel label={label} value={formatValue(draftValue)} />
      <Slider
        min={min}
        max={max}
        step={step}
        value={draftValue}
        onChange={setDraftValue}
        onCommit={commitValue}
      />
    </div>
  );
});

const AdvancedVarietyToggle = memo(function AdvancedVarietyToggle({
  varietyPlus,
  setVarietyPlus,
}: {
  varietyPlus: boolean;
  setVarietyPlus: (v: boolean | ((p: boolean) => boolean)) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => setVarietyPlus((v) => !v)}
      className={cn(
        "flex items-center gap-1 text-[11px] px-2 py-1 rounded border transition-colors",
        varietyPlus
          ? "bg-primary/15 border-primary/40 text-primary"
          : "border-border/50 text-muted-foreground hover:text-foreground hover:border-border",
      )}
    >
      <Check className={cn("h-3 w-3", !varietyPlus && "opacity-20")} />
      Variety+
    </button>
  );
});

const AdvancedSeedControl = memo(function AdvancedSeedControl({
  seedInput,
  setSeedInput,
}: {
  seedInput: string;
  setSeedInput: (v: string) => void;
}) {
  const { t } = useTranslation();
  const [localSeed, setLocalSeed] = useState(seedInput);
  const [seedFocused, setSeedFocused] = useState(false);

  useEffect(() => {
    if (!seedFocused) setLocalSeed(seedInput);
  }, [seedFocused, seedInput]);

  const commitSeedInput = useCallback(
    (nextValue = localSeed) => {
      setSeedFocused(false);
      if (nextValue !== seedInput) setSeedInput(nextValue);
    },
    [localSeed, seedInput, setSeedInput],
  );

  return (
    <div>
      <FieldLabel label={t("generation.advanced.seed")} />
      <div className="flex gap-1.5">
        <input
          type="number"
          value={localSeed}
          onChange={(e) => setLocalSeed(e.target.value)}
          onFocus={() => setSeedFocused(true)}
          onBlur={() => commitSeedInput()}
          placeholder={t("generation.advanced.random")}
          className={cn(INPUT_CLS, "flex-1 min-w-0 font-mono")}
        />
        <button
          type="button"
          onClick={() => {
            setLocalSeed("");
            setSeedFocused(false);
            setSeedInput("");
          }}
          title={t("generation.advanced.randomSeed")}
          className="shrink-0 px-2.5 rounded-lg border border-border/60 bg-secondary/60 text-muted-foreground hover:text-foreground hover:border-border transition-colors"
        >
          <Shuffle className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
});

const AdvancedParamsSection = memo(function AdvancedParamsSection({
  steps,
  setSteps,
  scale,
  setScale,
  cfgRescale,
  setCfgRescale,
  varietyPlus,
  setVarietyPlus,
  sampler,
  setSampler,
  noiseSchedule,
  setNoiseSchedule,
  seedInput,
  setSeedInput,
  onReset,
}: {
  steps: number;
  setSteps: (v: number) => void;
  scale: number;
  setScale: (v: number) => void;
  cfgRescale: number;
  setCfgRescale: (v: number) => void;
  varietyPlus: boolean;
  setVarietyPlus: (v: boolean | ((p: boolean) => boolean)) => void;
  sampler: string;
  setSampler: (v: string) => void;
  noiseSchedule: string;
  setNoiseSchedule: (v: string) => void;
  seedInput: string;
  setSeedInput: (v: string) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const handleToggleOpen = useCallback(() => setOpen((value) => !value), []);

  return (
    <div className="overflow-hidden">
      {/* 헤더 */}
      <div className="flex">
        <div className="flex items-start gap-3 flex-wrap px-4 py-3.5 min-w-0">
          {/* Steps */}
          <AdvancedInlineNumberSummary
            label="Steps"
            value={steps}
            setValue={setSteps}
            min={1}
            max={50}
            step={1}
          />
          <span className="w-px h-6 bg-border/50 shrink-0" />
          {/* CFG */}
          <AdvancedInlineNumberSummary
            label="CFG"
            value={scale}
            setValue={setScale}
            min={1}
            max={10}
            step={0.1}
          />
          <span className="w-px h-6 bg-border/50 shrink-0" />
          {/* Seed */}
          <AdvancedSeedSummary
            seedInput={seedInput}
            setSeedInput={setSeedInput}
          />
          <span className="w-px h-6 bg-border/50 shrink-0" />
          {/* Sampler */}
          <AdvancedSamplerSummary sampler={sampler} setSampler={setSampler} />
        </div>
        {/* 펼치기 버튼 */}
        <button
          type="button"
          onClick={handleToggleOpen}
          className="ml-auto self-stretch px-4 flex cursor-pointer items-center justify-center rounded transition-colors"
        >
          <ChevronUp
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </div>

      {/* 펼쳐진 본문 */}
      {open && (
        <div className="px-3 pb-3 pt-4 space-y-3.5 border-t border-border/30">
          <AdvancedSliderControl
            label="Steps"
            value={steps}
            setValue={setSteps}
            min={1}
            max={50}
            formatValue={formatInteger}
          />
          <AdvancedSliderControl
            label="CFG Scale"
            value={scale}
            setValue={setScale}
            min={1}
            max={10}
            step={0.1}
            formatValue={formatOneDecimal}
          />
          <AdvancedSliderControl
            label="Prompt Guidance Rescale"
            value={cfgRescale}
            setValue={setCfgRescale}
            min={0}
            max={1}
            step={0.02}
            formatValue={formatTwoDecimals}
          />
          <AdvancedVarietyToggle
            varietyPlus={varietyPlus}
            setVarietyPlus={setVarietyPlus}
          />
          <AdvancedSamplerNoiseControls
            sampler={sampler}
            setSampler={setSampler}
            noiseSchedule={noiseSchedule}
            setNoiseSchedule={setNoiseSchedule}
          />
          <AdvancedSeedControl
            seedInput={seedInput}
            setSeedInput={setSeedInput}
          />
          <button
            type="button"
            onClick={onReset}
            className="w-full text-[11px] text-muted-foreground hover:text-foreground border border-border/40 hover:border-border rounded-lg py-1.5 transition-colors"
          >
            {t("generation.advanced.resetParameters")}
          </button>
        </div>
      )}
    </div>
  );
});

const AutoGenSummaryHeader = memo(function AutoGenSummaryHeader({
  count,
  delay,
  infinite,
  seedMode,
  open,
  onToggleOpen,
}: {
  count: number;
  delay: number;
  infinite: boolean;
  seedMode: "random" | "fixed";
  open: boolean;
  onToggleOpen: () => void;
}) {
  return (
    <div className="flex">
      <div className="flex items-center gap-3 flex-wrap px-4 py-3.5 min-w-0">
        <span className="flex flex-col gap-0.5">
          <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wide">
            Count
          </span>
          <span className="text-sm font-semibold tabular-nums leading-none">
            {infinite ? INFINITY_SYMBOL : count}
          </span>
        </span>
        <span className="w-px h-6 bg-border/50 shrink-0" />
        <span className="flex flex-col gap-0.5">
          <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wide">
            Delay
          </span>
          <span className="text-sm font-semibold tabular-nums leading-none">
            {delay.toFixed(1)}s
          </span>
        </span>
        <span className="w-px h-6 bg-border/50 shrink-0" />
        <span className="flex flex-col gap-0.5">
          <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wide">
            Seed
          </span>
          <span className="text-sm font-semibold leading-none">
            {seedMode === "random" ? "Random" : "Fixed"}
          </span>
        </span>
      </div>
      <button
        type="button"
        onClick={onToggleOpen}
        className="ml-auto self-stretch px-4 flex cursor-pointer items-center justify-center rounded transition-colors"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
    </div>
  );
});

const AutoGenCountControl = memo(function AutoGenCountControl({
  count,
  setCount,
  infinite,
  setInfinite,
}: {
  count: number;
  setCount: (v: number) => void;
  infinite: boolean;
  setInfinite: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const [draftCount, setDraftCount] = useState(count);

  useEffect(() => {
    setDraftCount(count);
  }, [count]);

  const commitCount = useCallback(
    (nextValue: number) => {
      if (nextValue !== count) setCount(nextValue);
    },
    [count, setCount],
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-muted-foreground">
          {t("generation.advanced.count")}
        </span>
        <div className="flex items-center gap-2">
          {!infinite && (
            <span className="text-xs font-mono text-foreground/80 bg-secondary px-1.5 py-0.5 rounded">
              {t("generation.advanced.countUnit", { count: draftCount })}
            </span>
          )}
          <button
            type="button"
            onClick={() => setInfinite(!infinite)}
            className={cn(
              "flex items-center gap-1 text-xs px-2 py-0.5 rounded border transition-colors",
              infinite
                ? "bg-primary/15 border-primary/40 text-primary"
                : "border-border/50 text-muted-foreground hover:text-foreground hover:border-border",
            )}
          >
            {infinite && <Check className="h-2.5 w-2.5" />}
            {INFINITY_SYMBOL} {t("generation.advanced.infinite")}
          </button>
        </div>
      </div>
      <Slider
        min={1}
        max={50}
        value={draftCount}
        onChange={setDraftCount}
        onCommit={commitCount}
        disabled={infinite}
      />
    </div>
  );
});

const AutoGenDelayControl = memo(function AutoGenDelayControl({
  delay,
  setDelay,
}: {
  delay: number;
  setDelay: (v: number) => void;
}) {
  const { t } = useTranslation();
  const [draftDelay, setDraftDelay] = useState(delay);

  useEffect(() => {
    setDraftDelay(delay);
  }, [delay]);

  const commitDelay = useCallback(
    (nextValue: number) => {
      if (nextValue !== delay) setDelay(nextValue);
    },
    [delay, setDelay],
  );

  return (
    <div>
      <FieldLabel
        label={t("generation.advanced.delay")}
        value={`${draftDelay.toFixed(1)}s`}
      />
      <Slider
        min={3}
        max={60}
        step={0.5}
        value={draftDelay}
        onChange={setDraftDelay}
        onCommit={commitDelay}
      />
    </div>
  );
});

const AutoGenSeedModeControl = memo(function AutoGenSeedModeControl({
  seedMode,
  setSeedMode,
  policyAgreed,
  setPolicyAgreed,
}: {
  seedMode: "random" | "fixed";
  setSeedMode: (v: "random" | "fixed") => void;
  policyAgreed: boolean;
  setPolicyAgreed: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const [warningOpen, setWarningOpen] = useState(false);
  const warningButtonRef = useRef<HTMLButtonElement | null>(null);
  const warningPopoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!warningOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (warningButtonRef.current?.contains(target)) return;
      if (warningPopoverRef.current?.contains(target)) return;
      setWarningOpen(false);
    };
    window.addEventListener("mousedown", handleMouseDown);
    return () => window.removeEventListener("mousedown", handleMouseDown);
  }, [warningOpen]);

  return (
    <div>
      <span className="text-xs text-muted-foreground block mb-2">
        {t("generation.advanced.seedMode")}
      </span>
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-secondary/30 p-1">
          {(["random", "fixed"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setSeedMode(mode)}
              className={cn(
                "px-2.5 py-1 text-xs rounded-md transition-colors",
                seedMode === mode
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/70",
              )}
            >
              {mode === "random"
                ? t("generation.advanced.seedModeRandom")
                : t("generation.advanced.seedModeFixed")}
            </button>
          ))}
        </div>
        <div className="relative">
          <TooltipProvider delayDuration={0}>
            <Tooltip open={!policyAgreed && !warningOpen}>
              <TooltipTrigger asChild>
                <button
                  ref={warningButtonRef}
                  type="button"
                  onClick={() => setWarningOpen((prev) => !prev)}
                  title={t("generation.advanced.warningTitle")}
                  aria-label={t("generation.advanced.warningTooltip")}
                  className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-warning/30 bg-warning/12 text-warning transition-colors hover:border-warning/50 hover:bg-warning/16"
                >
                  <TriangleAlert className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                align="end"
                sideOffset={8}
                collisionPadding={12}
                className="max-w-56 select-none whitespace-normal text-left leading-relaxed text-foreground/85"
              >
                {t("generation.advanced.warningRequired")}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {warningOpen && (
            <div
              ref={warningPopoverRef}
              className="absolute bottom-full right-0 z-20 mb-2 w-80 rounded-xl border border-border/60 bg-popover p-3 shadow-xl"
            >
              <p className="text-sm font-semibold text-foreground">
                {t("generation.advanced.warningTitle")}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-foreground/85">
                {t("generation.advanced.warningDescription")}
              </p>
              <div className="mt-3 border-t border-border/40 pt-3">
                <Checkbox
                  checked={policyAgreed}
                  onChange={setPolicyAgreed}
                  label={t("generation.advanced.warningConfirmed")}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

const AutoGenSection = memo(function AutoGenSection({
  count,
  setCount,
  delay,
  setDelay,
  seedMode,
  setSeedMode,
  infinite,
  setInfinite,
  policyAgreed,
  setPolicyAgreed,
}: {
  count: number;
  setCount: (v: number) => void;
  delay: number;
  setDelay: (v: number) => void;
  seedMode: "random" | "fixed";
  setSeedMode: (v: "random" | "fixed") => void;
  infinite: boolean;
  setInfinite: (v: boolean) => void;
  policyAgreed: boolean;
  setPolicyAgreed: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="overflow-hidden">
      <AutoGenSummaryHeader
        count={count}
        delay={delay}
        infinite={infinite}
        seedMode={seedMode}
        open={open}
        onToggleOpen={() => setOpen((v) => !v)}
      />
      {open && (
        <div className="px-4 pb-4 space-y-4">
          <AutoGenCountControl
            count={count}
            setCount={setCount}
            infinite={infinite}
            setInfinite={setInfinite}
          />
          <AutoGenDelayControl delay={delay} setDelay={setDelay} />
          <AutoGenSeedModeControl
            seedMode={seedMode}
            setSeedMode={setSeedMode}
            policyAgreed={policyAgreed}
            setPolicyAgreed={setPolicyAgreed}
          />
        </div>
      )}
    </div>
  );
});

interface ModelSectionProps {
  model: string;
  setModel: Dispatch<SetStateAction<string>>;
}

const ModelSection = memo(function ModelSection({
  model,
  setModel,
}: ModelSectionProps) {
  const { t } = useTranslation();

  return (
    <div>
      <SectionHeader label={t("generation.sections.model")} />
      <Select value={model} onChange={setModel} options={MODELS} />
    </div>
  );
});

interface PromptSectionProps {
  promptInputMode: "prompt" | "negativePrompt";
  setPromptInputMode: Dispatch<SetStateAction<"prompt" | "negativePrompt">>;
  prompt: string;
  negativePrompt: string;
  setPrompt: Dispatch<SetStateAction<string>>;
  setNegativePrompt: Dispatch<SetStateAction<string>>;
  promptGroups: PromptGroup[];
}

const PromptSection = memo(function PromptSection({
  promptInputMode,
  setPromptInputMode,
  prompt,
  negativePrompt,
  setPrompt,
  setNegativePrompt,
  promptGroups,
}: PromptSectionProps) {
  const { t } = useTranslation();
  const handlePromptChange = useCallback(
    (nextValue: string) => {
      if (promptInputMode === "prompt") {
        setPrompt(nextValue);
      } else {
        setNegativePrompt(nextValue);
      }
    },
    [promptInputMode, setNegativePrompt, setPrompt],
  );

  return (
    <div data-tour="gen-prompt-input">
      <SectionHeader label={t("generation.sections.prompt")} />
      <div
        className="mb-2 inline-flex items-center gap-1 rounded-lg border border-border/60 bg-secondary/30 p-1"
        role="radiogroup"
        aria-label="Prompt input mode"
      >
        <button
          type="button"
          role="radio"
          aria-checked={promptInputMode === "prompt"}
          onClick={() => setPromptInputMode("prompt")}
          className={cn(
            "px-2.5 py-1 text-xs rounded-md transition-colors",
            promptInputMode === "prompt"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary/70",
          )}
        >
          Prompt
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={promptInputMode === "negativePrompt"}
          onClick={() => setPromptInputMode("negativePrompt")}
          className={cn(
            "px-2.5 py-1 text-xs rounded-md transition-colors",
            promptInputMode === "negativePrompt"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary/70",
          )}
        >
          Negative Prompt
        </button>
      </div>
      <PromptInput
        key={promptInputMode}
        value={promptInputMode === "prompt" ? prompt : negativePrompt}
        onChange={handlePromptChange}
        placeholder={
          promptInputMode === "prompt"
            ? "1girl, beautiful, masterpiece, ..."
            : "nsfw, lowres, bad anatomy, ..."
        }
        minHeight={180}
        maxHeight={460}
        groups={promptGroups}
        allowExternalDrop
      />
    </div>
  );
});

interface CharacterPromptCardProps {
  index: number;
  character: CharacterPromptInput;
  aiChoice: boolean;
  hasDuplicatePosition: boolean;
  promptGroups: PromptGroup[];
  onSetInputMode: (index: number, inputMode: CharacterPromptMode) => void;
  onRemove: (index: number) => void;
  onPositionChange: (index: number, position: CharacterPosition) => void;
  onValueChange: (index: number, nextValue: string) => void;
}

const CharacterPromptCard = memo(function CharacterPromptCard({
  index,
  character,
  aiChoice,
  hasDuplicatePosition,
  promptGroups,
  onSetInputMode,
  onRemove,
  onPositionChange,
  onValueChange,
}: CharacterPromptCardProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "rounded-lg border bg-secondary/20 p-2 space-y-2",
        !aiChoice && hasDuplicatePosition
          ? "border-warning/50"
          : "border-border/40",
      )}
    >
      <div className="flex items-center gap-1.5">
        <div
          className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-secondary/30 p-1"
          role="radiogroup"
          aria-label={`Character ${index + 1} input mode`}
        >
          <button
            type="button"
            role="radio"
            aria-checked={character.inputMode === "prompt"}
            onClick={() => onSetInputMode(index, "prompt")}
            className={cn(
              "px-2 py-1 text-[11px] rounded-md transition-colors",
              character.inputMode === "prompt"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/70",
            )}
          >
            Prompt
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={character.inputMode === "negativePrompt"}
            onClick={() => onSetInputMode(index, "negativePrompt")}
            className={cn(
              "px-2 py-1 text-[11px] rounded-md transition-colors",
              character.inputMode === "negativePrompt"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/70",
            )}
          >
            Negative Prompt
          </button>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => onRemove(index)}
          className="shrink-0 h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {!aiChoice && (
        <PositionAdjustButton
          value={character.position}
          onChange={(position) => onPositionChange(index, position)}
        />
      )}
      <PromptInput
        key={character.inputMode}
        value={
          character.inputMode === "prompt"
            ? character.prompt
            : character.negativePrompt
        }
        onChange={(nextValue) => onValueChange(index, nextValue)}
        placeholder={
          character.inputMode === "prompt"
            ? t("generation.character.promptLabel", { index: index + 1 })
            : t("generation.character.negativePromptLabel", {
                index: index + 1,
              })
        }
        minHeight={110}
        maxHeight={300}
        className="min-w-0"
        groups={promptGroups}
        allowExternalDrop
      />
    </div>
  );
});

interface CharacterPromptsSectionProps {
  characterPrompts: CharacterPromptInput[];
  setCharacterPrompts: Dispatch<SetStateAction<CharacterPromptInput[]>>;
  aiChoice: boolean;
  setAiChoice: Dispatch<SetStateAction<boolean>>;
  promptGroups: PromptGroup[];
}

const CharacterPromptsSection = memo(function CharacterPromptsSection({
  characterPrompts,
  setCharacterPrompts,
  aiChoice,
  setAiChoice,
  promptGroups,
}: CharacterPromptsSectionProps) {
  const { t } = useTranslation();
  const [characterAddOpen, setCharacterAddOpen] = useState(false);
  const duplicatePositions = useMemo(() => {
    if (aiChoice) return new Set<string>();

    return new Set(
      Object.entries(
        characterPrompts.reduce<Record<string, number>>((acc, character) => {
          acc[character.position] = (acc[character.position] ?? 0) + 1;
          return acc;
        }, {}),
      )
        .filter(([, count]) => count > 1)
        .map(([position]) => position),
    );
  }, [aiChoice, characterPrompts]);

  const handleAddCharacterPrompt = useCallback(
    (preset: CharacterPromptPreset) => {
      const promptPrefix =
        CHARACTER_PROMPT_PRESETS.find((item) => item.value === preset)
          ?.promptPrefix ?? "";
      setCharacterPrompts((prev) => [
        ...prev,
        createCharacterPromptInput(promptPrefix),
      ]);
      setCharacterAddOpen(false);
    },
    [setCharacterAddOpen, setCharacterPrompts],
  );

  const handleToggleAiChoice = useCallback(() => {
    const next = !aiChoice;
    setAiChoice(next);
    if (next) {
      setCharacterPrompts((prev) =>
        prev.map((character) => ({ ...character, position: "global" })),
      );
      return;
    }

    setCharacterPrompts((prev) =>
      prev.map((character) => ({
        ...character,
        position: character.position === "global" ? "C3" : character.position,
      })),
    );
  }, [aiChoice, setAiChoice, setCharacterPrompts]);

  const handleSetInputMode = useCallback(
    (index: number, inputMode: CharacterPromptMode) => {
      setCharacterPrompts((prev) =>
        prev.map((item, currentIndex) =>
          currentIndex === index ? { ...item, inputMode } : item,
        ),
      );
    },
    [setCharacterPrompts],
  );

  const handleRemoveCharacter = useCallback(
    (index: number) => {
      setCharacterPrompts((prev) =>
        prev.filter((_, currentIndex) => currentIndex !== index),
      );
    },
    [setCharacterPrompts],
  );

  const handlePositionChange = useCallback(
    (index: number, position: CharacterPosition) => {
      setCharacterPrompts((prev) =>
        prev.map((item, currentIndex) =>
          currentIndex === index ? { ...item, position } : item,
        ),
      );
    },
    [setCharacterPrompts],
  );

  const handleValueChange = useCallback(
    (index: number, nextValue: string) => {
      setCharacterPrompts((prev) =>
        prev.map((item, currentIndex) => {
          if (currentIndex !== index) return item;
          return item.inputMode === "prompt"
            ? { ...item, prompt: nextValue }
            : { ...item, negativePrompt: nextValue };
        }),
      );
    },
    [setCharacterPrompts],
  );

  return (
    <div>
      <SectionHeader
        label={t("generation.sections.characters")}
        action={
          <div className="relative">
            <button
              onClick={() => setCharacterAddOpen((prev) => !prev)}
              className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors"
            >
              <Plus className="h-3 w-3" />
            </button>
            {characterAddOpen && (
              <div className="absolute right-0 top-full mt-1 w-28 rounded-lg border border-border/60 bg-popover shadow-lg overflow-hidden z-10">
                {CHARACTER_PROMPT_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    onClick={() => handleAddCharacterPrompt(preset.value)}
                    className="w-full text-left px-2.5 py-1.5 text-xs text-foreground/80 hover:bg-secondary transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        }
      />
      {characterPrompts.length > 0 && (
        <div className="px-1 pb-1 space-y-1.5">
          <button
            type="button"
            onClick={handleToggleAiChoice}
            className={cn(
              "flex items-center gap-1 text-[11px] px-2 py-1 rounded border transition-colors",
              aiChoice
                ? "bg-primary/15 border-primary/40 text-primary"
                : "border-border/50 text-muted-foreground hover:text-foreground hover:border-border",
            )}
          >
            <Check className={cn("h-3 w-3", !aiChoice && "opacity-20")} />
            Automatic Position
          </button>
          {duplicatePositions.size > 0 && (
            <div className="flex items-center gap-1 text-[11px] text-warning">
              <TriangleAlert className="h-3 w-3 shrink-0" />
              <span>{t("generation.character.duplicatePosition")}</span>
            </div>
          )}
        </div>
      )}
      {characterPrompts.length === 0 ? (
        <p className="text-xs text-muted-foreground/40 text-center py-2">
          {t("generation.character.empty")}
        </p>
      ) : (
        <div className="space-y-2">
          {characterPrompts.map((character, index) => (
            <CharacterPromptCard
              key={index}
              index={index}
              character={character}
              aiChoice={aiChoice}
              hasDuplicatePosition={duplicatePositions.has(character.position)}
              promptGroups={promptGroups}
              onSetInputMode={handleSetInputMode}
              onRemove={handleRemoveCharacter}
              onPositionChange={handlePositionChange}
              onValueChange={handleValueChange}
            />
          ))}
        </div>
      )}
    </div>
  );
});

interface ReferenceSectionsProps {
  i2iRef: I2IRef | null;
  setI2iRef: Dispatch<SetStateAction<I2IRef | null>>;
  vibes: VibeRef[];
  setVibes: Dispatch<SetStateAction<VibeRef[]>>;
  preciseRef: PreciseRef | null;
  setPreciseRef: Dispatch<SetStateAction<PreciseRef | null>>;
}

const ReferenceSections = memo(function ReferenceSections({
  i2iRef,
  setI2iRef,
  vibes,
  setVibes,
  preciseRef,
  setPreciseRef,
}: ReferenceSectionsProps) {
  return (
    <>
      {i2iRef && (
        <div>
          <SectionHeader label="Image2Image" />
          <RefCard
            previewUrl={i2iRef.previewUrl}
            onRemove={() => {
              if (i2iRef.isObjectUrl) URL.revokeObjectURL(i2iRef.previewUrl);
              setI2iRef(null);
            }}
          >
            <div className="space-y-2">
              <div>
                <FieldLabel
                  label="Strength"
                  value={i2iRef.strength.toFixed(2)}
                />
                <Slider
                  min={0.01}
                  max={0.99}
                  step={0.01}
                  value={i2iRef.strength}
                  onChange={(value) =>
                    setI2iRef((prev) =>
                      prev ? { ...prev, strength: value } : prev,
                    )
                  }
                />
              </div>
              <div>
                <FieldLabel label="Noise" value={i2iRef.noise.toFixed(2)} />
                <Slider
                  min={0}
                  max={0.99}
                  step={0.01}
                  value={i2iRef.noise}
                  onChange={(value) =>
                    setI2iRef((prev) =>
                      prev ? { ...prev, noise: value } : prev,
                    )
                  }
                />
              </div>
            </div>
          </RefCard>
        </div>
      )}

      {vibes.length > 0 && (
        <div>
          <SectionHeader label="Vibe Transfer" />
          <div className="space-y-2">
            {vibes.map((vibe) => (
              <RefCard
                key={vibe.id}
                previewUrl={vibe.previewUrl}
                onRemove={() => {
                  if (vibe.isObjectUrl) URL.revokeObjectURL(vibe.previewUrl);
                  setVibes((prev) =>
                    prev.filter((item) => item.id !== vibe.id),
                  );
                }}
              >
                <div className="space-y-2">
                  <div>
                    <FieldLabel
                      label="Info Extracted"
                      value={vibe.infoExtracted.toFixed(2)}
                    />
                    <Slider
                      min={0.01}
                      max={1}
                      step={0.01}
                      value={vibe.infoExtracted}
                      onChange={(value) =>
                        setVibes((prev) =>
                          prev.map((item) =>
                            item.id === vibe.id
                              ? { ...item, infoExtracted: value }
                              : item,
                          ),
                        )
                      }
                    />
                  </div>
                  <div>
                    <FieldLabel
                      label="Reference Strength"
                      value={vibe.strength.toFixed(2)}
                    />
                    <Slider
                      min={0.01}
                      max={1}
                      step={0.01}
                      value={vibe.strength}
                      onChange={(value) =>
                        setVibes((prev) =>
                          prev.map((item) =>
                            item.id === vibe.id
                              ? { ...item, strength: value }
                              : item,
                          ),
                        )
                      }
                    />
                  </div>
                </div>
              </RefCard>
            ))}
          </div>
        </div>
      )}

      {preciseRef && (
        <div>
          <SectionHeader label="Precise Reference" />
          <RefCard
            previewUrl={preciseRef.previewUrl}
            onRemove={() => {
              if (preciseRef.isObjectUrl)
                URL.revokeObjectURL(preciseRef.previewUrl);
              setPreciseRef(null);
            }}
          >
            <div>
              <FieldLabel
                label="Fidelity"
                value={preciseRef.fidelity.toFixed(2)}
              />
              <Slider
                min={0}
                max={1}
                step={0.01}
                value={preciseRef.fidelity}
                onChange={(value) =>
                  setPreciseRef((prev) =>
                    prev ? { ...prev, fidelity: value } : prev,
                  )
                }
              />
            </div>
          </RefCard>
        </div>
      )}
    </>
  );
});

interface SizeSectionProps {
  width: number;
  setWidth: Dispatch<SetStateAction<number>>;
  height: number;
  setHeight: Dispatch<SetStateAction<number>>;
  customSizes: CustomSize[];
  setCustomSizes: Dispatch<SetStateAction<CustomSize[]>>;
}

const SizeSection = memo(function SizeSection({
  width,
  setWidth,
  height,
  setHeight,
  customSizes,
  setCustomSizes,
}: SizeSectionProps) {
  const { t } = useTranslation();
  const [customSizesOpen, setCustomSizesOpen] = useState(false);
  const [customSizeAddW, setCustomSizeAddW] = useState("");
  const [customSizeAddH, setCustomSizeAddH] = useState("");
  const selectedPreset = useMemo(
    () =>
      SIZE_PRESETS.find(
        (preset) => preset.width === width && preset.height === height,
      ),
    [height, width],
  );
  const handleSwapDimensions = useCallback(() => {
    setWidth(height);
    setHeight(width);
  }, [height, setHeight, setWidth, width]);

  return (
    <div>
      <SectionHeader label={t("generation.size.title")} />
      <div className="flex gap-1.5">
        {SIZE_PRESETS.map((preset) => (
          <button
            key={preset.key}
            onClick={() => {
              setWidth(preset.width);
              setHeight(preset.height);
            }}
            className={cn(
              "flex-1 py-1.5 text-xs rounded-lg border transition-colors",
              selectedPreset?.key === preset.key
                ? "bg-primary/20 text-primary border-primary/50 font-medium"
                : "bg-secondary/60 text-muted-foreground border-border/60 hover:text-foreground hover:border-border",
            )}
          >
            {t(`generation.size.${preset.key}`)}
          </button>
        ))}
        <div className="relative">
          <button
            onClick={() => setCustomSizesOpen((prev) => !prev)}
            className={cn(
              "px-2.5 py-1.5 text-xs rounded-lg border transition-colors whitespace-nowrap",
              customSizesOpen
                ? "bg-primary/20 text-primary border-primary/50 font-medium"
                : "bg-secondary/60 text-muted-foreground border-border/60 hover:text-foreground hover:border-border",
            )}
          >
            {t("generation.size.custom")}
          </button>
          {customSizesOpen && (
            <div className="absolute right-0 bottom-full mb-1 w-52 rounded-lg border border-border/60 bg-popover shadow-lg z-10 overflow-hidden">
              {customSizes.length === 0 ? (
                <p className="px-3 py-8 text-xs text-muted-foreground text-center">
                  {t("generation.size.noSavedSizes")}
                </p>
              ) : (
                customSizes.map((size, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-1 px-2 py-1.5 hover:bg-secondary transition-colors"
                  >
                    <button
                      onClick={() => {
                        setWidth(size.width);
                        setHeight(size.height);
                        setCustomSizesOpen(false);
                      }}
                      className="flex-1 text-left text-xs text-foreground/80 font-mono cursor-pointer"
                    >
                      {size.width} 횞 {size.height}
                    </button>
                    <button
                      onClick={() => {
                        const next = customSizes.filter(
                          (_, currentIndex) => currentIndex !== index,
                        );
                        setCustomSizes(next);
                        saveCustomSizes(next);
                      }}
                      className="text-muted-foreground/60 hover:text-destructive transition-colors"
                      aria-label={t("generation.size.deleteAria")}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))
              )}
              <div className="border-t border-border/40 px-2 py-2 flex items-center gap-1.5">
                <input
                  type="text"
                  inputMode="numeric"
                  value={customSizeAddW}
                  onChange={(e) => setCustomSizeAddW(e.target.value)}
                  placeholder="W"
                  className="w-0 flex-1 min-w-0 bg-secondary/60 border border-border/60 rounded px-1.5 py-1 text-xs font-mono text-center focus:outline-none focus:border-primary/50 cursor-text"
                />
                <span className="text-xs text-muted-foreground shrink-0">
                  횞
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={customSizeAddH}
                  onChange={(e) => setCustomSizeAddH(e.target.value)}
                  placeholder="H"
                  className="w-0 flex-1 min-w-0 bg-secondary/60 border border-border/60 rounded px-1.5 py-1 text-xs font-mono text-center focus:outline-none focus:border-primary/50 cursor-text"
                />
                <button
                  onClick={() => {
                    const nextWidth = parseInt(customSizeAddW, 10);
                    const nextHeight = parseInt(customSizeAddH, 10);
                    if (
                      !nextWidth ||
                      !nextHeight ||
                      nextWidth <= 0 ||
                      nextHeight <= 0
                    ) {
                      return;
                    }

                    const exists = customSizes.some(
                      (size) =>
                        size.width === nextWidth && size.height === nextHeight,
                    );
                    if (!exists) {
                      const next = [
                        ...customSizes,
                        { width: nextWidth, height: nextHeight },
                      ];
                      setCustomSizes(next);
                      saveCustomSizes(next);
                    }
                    setCustomSizeAddW("");
                    setCustomSizeAddH("");
                  }}
                  className="shrink-0 text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer"
                  aria-label={t("generation.size.addAria")}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <DeferredNumberInput
          value={width}
          onChange={setWidth}
          className={cn(INPUT_CLS, "flex-1 min-w-0 font-mono text-center")}
        />
        <button
          type="button"
          onClick={handleSwapDimensions}
          title={t("generation.size.swapTitle")}
          aria-label={t("generation.size.swapAria")}
          className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-secondary/60 text-muted-foreground transition-colors hover:border-border hover:bg-secondary hover:text-foreground"
        >
          <ArrowRightLeft className="h-3.5 w-3.5" />
        </button>
        <DeferredNumberInput
          value={height}
          onChange={setHeight}
          className={cn(INPUT_CLS, "flex-1 min-w-0 font-mono text-center")}
        />
      </div>
    </div>
  );
});

interface GenerateActionsSectionProps {
  hasApiKey: boolean;
  outputFolder: string;
  prompt: string;
  generating: boolean;
  autoGenProgress: { current: number; total: number | null } | null;
  autoCancelPending: boolean;
  autoGenPolicyAgreed: boolean;
  onGenerate: () => void;
  onAutoGenerate: () => void;
  onCancelAutoGenerate: () => void;
}

const GenerateActionsSection = memo(function GenerateActionsSection({
  hasApiKey,
  outputFolder,
  prompt,
  generating,
  autoGenProgress,
  autoCancelPending,
  autoGenPolicyAgreed,
  onGenerate,
  onAutoGenerate,
  onCancelAutoGenerate,
}: GenerateActionsSectionProps) {
  const { t } = useTranslation();
  const canGenerate =
    !generating &&
    !autoGenProgress &&
    hasApiKey &&
    !!outputFolder &&
    !!prompt.trim();
  const canAutoGenerate = canGenerate && autoGenPolicyAgreed;

  return (
    <div className="p-3 border-t border-border bg-sidebar">
      {autoGenProgress ? (
        <div className="space-y-2">
          {autoGenProgress.total !== null ? (
            <div className="w-full bg-secondary rounded-full h-1">
              <div
                className="bg-primary h-1 rounded-full transition-all duration-300"
                style={{
                  width: `${(autoGenProgress.current / autoGenProgress.total) * 100}%`,
                }}
              />
            </div>
          ) : (
            <div className="w-full bg-secondary rounded-full h-1 overflow-hidden">
              <div className="h-1 bg-primary/60 animate-pulse w-full" />
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground tabular-nums flex items-center gap-1.5">
              {generating && <Loader2 className="h-3 w-3 animate-spin" />}
              {autoGenProgress.current} / {autoGenProgress.total ?? "??"}
            </span>
            <button
              type="button"
              disabled={autoCancelPending}
              onClick={onCancelAutoGenerate}
              className={cn(
                "flex items-center gap-1 text-xs transition-colors",
                autoCancelPending
                  ? "text-muted-foreground/40 cursor-not-allowed"
                  : "text-muted-foreground hover:text-destructive",
              )}
            >
              <X className="h-3 w-3" />
              {autoCancelPending
                ? t("generation.actions.stopPending")
                : t("generation.actions.stop")}
            </button>
          </div>
        </div>
      ) : (
        <div className="relative flex gap-2" data-tour="gen-generate-button">
          <div className="group/gen relative flex-1">
            {!canGenerate &&
              !generating &&
              !autoGenProgress &&
              hasApiKey &&
              !!outputFolder &&
              !prompt.trim() && (
                <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden -translate-x-1/2 rounded-lg border border-border/60 bg-popover px-2.5 py-1.5 shadow-lg group-hover/gen:block">
                  <p className="whitespace-nowrap text-[11px] text-foreground/85">
                    {t("generation.actions.enterPrompt")}
                  </p>
                </div>
              )}
            <button
              onClick={onGenerate}
              disabled={!canGenerate}
              className={cn(
                "w-full h-10 flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-all",
                canGenerate
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20"
                  : "bg-secondary/60 text-muted-foreground cursor-not-allowed",
              )}
            >
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
              {generating
                ? t("generation.actions.generating")
                : t("generation.actions.generate")}
            </button>
          </div>
          <button
            type="button"
            onClick={onAutoGenerate}
            disabled={!canAutoGenerate}
            title={
              autoGenPolicyAgreed
                ? t("generation.actions.autoGenerate")
                : t("generation.actions.autoGenerateNeedsWarning")
            }
            className={cn(
              "h-10 px-3 rounded-lg border text-sm font-medium transition-all flex items-center justify-center",
              canAutoGenerate
                ? "border-primary/50 text-primary hover:bg-primary/10"
                : "border-border/40 text-muted-foreground cursor-not-allowed",
            )}
          >
            <Sparkles className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
});

interface ResultViewportProps {
  generating: boolean;
  previewSrc: string | null;
  error: string | null;
  resultSrc: string | null;
  recentSeeds: Map<string, number>;
  setSeedInput: Dispatch<SetStateAction<string>>;
}

const ResultViewport = memo(function ResultViewport({
  generating,
  previewSrc,
  error,
  resultSrc,
  recentSeeds,
  setSeedInput,
}: ResultViewportProps) {
  const { t } = useTranslation();
  const [seedDropdownOpen, setSeedDropdownOpen] = useState(false);
  const seedDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!seedDropdownOpen) return;
    const handler = (event: MouseEvent) => {
      if (
        seedDropdownRef.current &&
        !seedDropdownRef.current.contains(event.target as Node)
      ) {
        setSeedDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [seedDropdownOpen]);

  return (
    <div className="relative z-10 flex flex-col items-center justify-center w-full h-full">
      {generating ? (
        previewSrc ? (
          <div className="relative w-full h-full flex items-center justify-center">
            <img
              src={previewSrc}
              alt={t("generation.actions.generatingPreviewAlt")}
              className="w-full h-full object-contain rounded-sm"
            />
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full bg-background/70 backdrop-blur-sm border border-border/40">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span className="text-xs text-muted-foreground">
                {t("generation.actions.generating")}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Loader2 className="h-7 w-7 text-primary animate-spin" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">
                {t("generation.actions.generatingNow")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("generation.actions.generatingWait")}
              </p>
            </div>
          </div>
        )
      ) : error ? (
        <div className="max-w-sm w-full mx-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-center">
          <p className="text-sm font-medium text-destructive mb-1.5">
            {t("generation.actions.generationFailed")}
          </p>
          <p className="text-xs text-muted-foreground break-all leading-relaxed">
            {error}
          </p>
        </div>
      ) : resultSrc ? (
        <>
          <img
            src={resultSrc}
            alt={t("generation.actions.resultAlt")}
            className="max-w-full max-h-full object-contain rounded-sm"
          />
          {recentSeeds.get(resultSrc) != null && (
            <div
              ref={seedDropdownRef}
              className="absolute bottom-3 right-3 z-20"
            >
              <button
                onClick={() => setSeedDropdownOpen((open) => !open)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-background/80 backdrop-blur-sm border border-border/50 text-xs font-mono tabular-nums text-foreground/80 hover:text-foreground hover:bg-background/95 transition-colors shadow-sm"
              >
                <Hash className="h-3 w-3 shrink-0" />
                {recentSeeds.get(resultSrc)}
              </button>
              {seedDropdownOpen && (
                <div className="absolute bottom-full right-0 mb-1.5 w-36 rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(
                        String(recentSeeds.get(resultSrc)),
                      );
                      setSeedDropdownOpen(false);
                      toast.success(t("generation.actions.seedCopied"));
                    }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-xs text-foreground hover:bg-accent transition-colors"
                  >
                    <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {t("generation.actions.copyToClipboard")}
                  </button>
                  <button
                    onClick={() => {
                      setSeedInput(String(recentSeeds.get(resultSrc)));
                      setSeedDropdownOpen(false);
                    }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-xs text-foreground hover:bg-accent transition-colors"
                  >
                    <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {t("generation.actions.importSeed")}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 select-none">
          <div className="h-16 w-16 rounded-2xl bg-secondary/50 border border-border/30 flex items-center justify-center">
            <Wand2 className="h-7 w-7 text-muted-foreground/80" />
          </div>
          <p className="text-xs text-muted-foreground/80">
            {t("generation.actions.emptyState")}
          </p>
        </div>
      )}
    </div>
  );
});

interface RecentImagesPanelProps {
  recentImages: string[];
  resultSrc: string | null;
  setResultSrc: Dispatch<SetStateAction<string | null>>;
}

const RecentImagesPanel = memo(function RecentImagesPanel({
  recentImages,
  resultSrc,
  setResultSrc,
}: RecentImagesPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="w-24 shrink-0 border-l border-border/60 bg-card/70 flex flex-col">
      <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest text-center pt-3 pb-1 shrink-0">
        {t("generation.actions.recent")}
      </p>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {recentImages.length > 0 ? (
          <div className="p-2 space-y-1.5">
            {recentImages.map((src, index) => (
              <RecentThumb
                key={src + index}
                src={src}
                isCurrent={src === resultSrc}
                onClick={() => setResultSrc(src)}
              />
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground/40 text-center px-2 pt-4">
            {t("generation.actions.noRecent")}
          </p>
        )}
      </div>
    </div>
  );
});

interface ResultAreaProps {
  dragOver: boolean;
  onDragOver: (event: React.DragEvent) => void;
  onDragEnter: (event: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (event: React.DragEvent) => void;
  generating: boolean;
  previewSrc: string | null;
  error: string | null;
  resultSrc: string | null;
  recentSeeds: Map<string, number>;
  setSeedInput: Dispatch<SetStateAction<string>>;
  recentImages: string[];
  setResultSrc: Dispatch<SetStateAction<string | null>>;
}

const ResultArea = memo(function ResultArea({
  dragOver,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  generating,
  previewSrc,
  error,
  resultSrc,
  recentSeeds,
  setSeedInput,
  recentImages,
  setResultSrc,
}: ResultAreaProps) {
  const { t } = useTranslation();

  return (
    <>
      <div
        className="flex-1 flex flex-col items-center justify-center overflow-hidden relative"
        onDragOver={onDragOver}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(var(--color-border) 1px, transparent 1px), linear-gradient(90deg, var(--color-border) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />

        {dragOver && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-primary/5 border-2 border-dashed border-primary/40 rounded-none transition-all">
            <div className="h-14 w-14 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center mb-3">
              <ImagePlus className="h-7 w-7 text-primary/70" />
            </div>
            <p className="text-sm font-medium text-primary/70">
              {t("generation.actions.dropHere")}
            </p>
          </div>
        )}

        <ResultViewport
          generating={generating}
          previewSrc={previewSrc}
          error={error}
          resultSrc={resultSrc}
          recentSeeds={recentSeeds}
          setSeedInput={setSeedInput}
        />
      </div>

      <RecentImagesPanel
        recentImages={recentImages}
        resultSrc={resultSrc}
        setResultSrc={setResultSrc}
      />
    </>
  );
});

interface LeftPanelProps {
  panelWidth: number;
  selectedService: GenerationService;
  setSelectedService: Dispatch<SetStateAction<GenerationService>>;
  hasApiKey: boolean;
  outputFolder: string;
  tourActive: boolean;
  model: string;
  setModel: Dispatch<SetStateAction<string>>;
  promptInputMode: "prompt" | "negativePrompt";
  setPromptInputMode: Dispatch<SetStateAction<"prompt" | "negativePrompt">>;
  prompt: string;
  negativePrompt: string;
  setPrompt: Dispatch<SetStateAction<string>>;
  setNegativePrompt: Dispatch<SetStateAction<string>>;
  promptGroups: PromptGroup[];
  characterPrompts: CharacterPromptInput[];
  setCharacterPrompts: Dispatch<SetStateAction<CharacterPromptInput[]>>;
  aiChoice: boolean;
  setAiChoice: Dispatch<SetStateAction<boolean>>;
  i2iRef: I2IRef | null;
  setI2iRef: Dispatch<SetStateAction<I2IRef | null>>;
  vibes: VibeRef[];
  setVibes: Dispatch<SetStateAction<VibeRef[]>>;
  preciseRef: PreciseRef | null;
  setPreciseRef: Dispatch<SetStateAction<PreciseRef | null>>;
  width: number;
  setWidth: Dispatch<SetStateAction<number>>;
  height: number;
  setHeight: Dispatch<SetStateAction<number>>;
  customSizes: CustomSize[];
  setCustomSizes: Dispatch<SetStateAction<CustomSize[]>>;
  steps: number;
  setSteps: Dispatch<SetStateAction<number>>;
  scale: number;
  setScale: Dispatch<SetStateAction<number>>;
  cfgRescale: number;
  setCfgRescale: Dispatch<SetStateAction<number>>;
  varietyPlus: boolean;
  setVarietyPlus: Dispatch<SetStateAction<boolean>>;
  sampler: string;
  setSampler: Dispatch<SetStateAction<string>>;
  noiseSchedule: string;
  setNoiseSchedule: Dispatch<SetStateAction<string>>;
  seedInput: string;
  setSeedInput: Dispatch<SetStateAction<string>>;
  autoGenCount: number;
  setAutoGenCount: Dispatch<SetStateAction<number>>;
  autoGenDelay: number;
  setAutoGenDelay: Dispatch<SetStateAction<number>>;
  autoGenSeedMode: "random" | "fixed";
  setAutoGenSeedMode: Dispatch<SetStateAction<"random" | "fixed">>;
  autoGenInfinite: boolean;
  setAutoGenInfinite: Dispatch<SetStateAction<boolean>>;
  autoGenPolicyAgreed: boolean;
  setAutoGenPolicyAgreed: Dispatch<SetStateAction<boolean>>;
  generating: boolean;
  autoGenProgress: { current: number; total: number | null } | null;
  autoCancelPending: boolean;
  onGenerate: () => void;
  onAutoGenerate: () => void;
  onCancelAutoGenerate: () => void;
}

function GenerationServiceSelector({
  selectedService,
  setSelectedService,
}: {
  selectedService: GenerationService;
  setSelectedService: Dispatch<SetStateAction<GenerationService>>;
}) {
  const { t } = useTranslation();

  return (
    <div className="border-b border-border/40 px-4 py-3 shrink-0 bg-sidebar">
      <TooltipProvider delayDuration={0}>
        <div
          className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-secondary/30 p-1"
          role="radiogroup"
          aria-label="Generation service"
        >
          {GENERATION_SERVICES.map(({ id, label, disabled }) => {
            const button = (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selectedService === id}
                aria-disabled={disabled}
                disabled={disabled}
                onClick={() => setSelectedService(id)}
                className={cn(
                  "px-2.5 py-1 text-xs rounded-md transition-colors",
                  selectedService === id
                    ? "bg-primary text-primary-foreground"
                    : disabled
                      ? "text-muted-foreground/40 cursor-not-allowed"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/70",
                )}
              >
                {label}
              </button>
            );

            if (!disabled) return button;

            return (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <span className="inline-flex">{button}</span>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {t("generation.actions.webuiComingSoon")}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
    </div>
  );
}

const LeftPanel = memo(function LeftPanel({
  panelWidth,
  selectedService,
  setSelectedService,
  hasApiKey,
  outputFolder,
  tourActive,
  model,
  setModel,
  promptInputMode,
  setPromptInputMode,
  prompt,
  negativePrompt,
  setPrompt,
  setNegativePrompt,
  promptGroups,
  characterPrompts,
  setCharacterPrompts,
  aiChoice,
  setAiChoice,
  i2iRef,
  setI2iRef,
  vibes,
  setVibes,
  preciseRef,
  setPreciseRef,
  width,
  setWidth,
  height,
  setHeight,
  customSizes,
  setCustomSizes,
  steps,
  setSteps,
  scale,
  setScale,
  cfgRescale,
  setCfgRescale,
  varietyPlus,
  setVarietyPlus,
  sampler,
  setSampler,
  noiseSchedule,
  setNoiseSchedule,
  seedInput,
  setSeedInput,
  autoGenCount,
  setAutoGenCount,
  autoGenDelay,
  setAutoGenDelay,
  autoGenSeedMode,
  setAutoGenSeedMode,
  autoGenInfinite,
  setAutoGenInfinite,
  autoGenPolicyAgreed,
  setAutoGenPolicyAgreed,
  generating,
  autoGenProgress,
  autoCancelPending,
  onGenerate,
  onAutoGenerate,
  onCancelAutoGenerate,
}: LeftPanelProps) {
  const { t } = useTranslation();
  const isNovelAIService = selectedService === "novelai";
  const handleResetAdvancedParams = useCallback(() => {
    setSteps(NAI_GEN_DEFAULTS.steps);
    setScale(NAI_GEN_DEFAULTS.scale);
    setCfgRescale(NAI_GEN_DEFAULTS.cfgRescale);
    setVarietyPlus(NAI_GEN_DEFAULTS.varietyPlus);
    setSampler(NAI_GEN_DEFAULTS.sampler);
    setNoiseSchedule(NAI_GEN_DEFAULTS.noiseSchedule);
    setSeedInput("");
  }, [
    setCfgRescale,
    setNoiseSchedule,
    setSampler,
    setScale,
    setSeedInput,
    setSteps,
    setVarietyPlus,
  ]);

  return (
    <div
      className="relative flex flex-col border-r border-border shrink-0 bg-sidebar overflow-hidden"
      style={{
        width: panelWidth,
        minWidth: panelWidth,
        maxWidth: panelWidth,
      }}
    >
      <GenerationServiceSelector
        selectedService={selectedService}
        setSelectedService={setSelectedService}
      />

      <div className="relative flex flex-1 min-h-0 flex-col">
        {isNovelAIService && (!hasApiKey || !outputFolder) && !tourActive && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 backdrop-blur-sm bg-sidebar/60 select-none">
            <Settings className="h-8 w-8 text-muted-foreground/60" />
            <div className="flex flex-col items-center gap-1">
              <span className="text-sm font-medium text-foreground/80">
                {t("generation.state.configurationRequired")}
              </span>
              <span className="text-[11px] text-muted-foreground text-center leading-relaxed">
                {t("generation.state.configurationMessage", {
                  target:
                    !hasApiKey && !outputFolder
                      ? t("generation.state.configurationApiKeyAndOutput")
                      : !hasApiKey
                        ? t("generation.state.configurationApiKey")
                        : t("generation.state.configurationOutputFolder"),
                })}
              </span>
            </div>
          </div>
        )}

        {isNovelAIService ? (
          <>
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-4 space-y-5 w-full">
                <ModelSection model={model} setModel={setModel} />
                <PromptSection
                  promptInputMode={promptInputMode}
                  setPromptInputMode={setPromptInputMode}
                  prompt={prompt}
                  negativePrompt={negativePrompt}
                  setPrompt={setPrompt}
                  setNegativePrompt={setNegativePrompt}
                  promptGroups={promptGroups}
                />
                <CharacterPromptsSection
                  characterPrompts={characterPrompts}
                  setCharacterPrompts={setCharacterPrompts}
                  aiChoice={aiChoice}
                  setAiChoice={setAiChoice}
                  promptGroups={promptGroups}
                />
                <ReferenceSections
                  i2iRef={i2iRef}
                  setI2iRef={setI2iRef}
                  vibes={vibes}
                  setVibes={setVibes}
                  preciseRef={preciseRef}
                  setPreciseRef={setPreciseRef}
                />
                <SizeSection
                  width={width}
                  setWidth={setWidth}
                  height={height}
                  setHeight={setHeight}
                  customSizes={customSizes}
                  setCustomSizes={setCustomSizes}
                />
              </div>
            </ScrollArea>

            <div className="border-t border-border/40 bg-sidebar">
              <AdvancedParamsSection
                steps={steps}
                setSteps={setSteps}
                scale={scale}
                setScale={setScale}
                cfgRescale={cfgRescale}
                setCfgRescale={setCfgRescale}
                varietyPlus={varietyPlus}
                setVarietyPlus={setVarietyPlus}
                sampler={sampler}
                setSampler={setSampler}
                noiseSchedule={noiseSchedule}
                setNoiseSchedule={setNoiseSchedule}
                seedInput={seedInput}
                setSeedInput={setSeedInput}
                onReset={handleResetAdvancedParams}
              />
            </div>

            <div
              className="border-t border-border/40 bg-sidebar"
              data-tour="gen-auto-gen"
            >
              <AutoGenSection
                count={autoGenCount}
                setCount={setAutoGenCount}
                delay={autoGenDelay}
                setDelay={setAutoGenDelay}
                seedMode={autoGenSeedMode}
                setSeedMode={setAutoGenSeedMode}
                infinite={autoGenInfinite}
                setInfinite={setAutoGenInfinite}
                policyAgreed={autoGenPolicyAgreed}
                setPolicyAgreed={setAutoGenPolicyAgreed}
              />
            </div>

            <GenerateActionsSection
              hasApiKey={hasApiKey}
              outputFolder={outputFolder}
              prompt={prompt}
              generating={generating}
              autoGenProgress={autoGenProgress}
              autoCancelPending={autoCancelPending}
              autoGenPolicyAgreed={autoGenPolicyAgreed}
              onGenerate={onGenerate}
              onAutoGenerate={onAutoGenerate}
              onCancelAutoGenerate={onCancelAutoGenerate}
            />
          </>
        ) : (
          <div className="flex-1 bg-sidebar" />
        )}
      </div>
    </div>
  );
});

interface RightSidePanelProps {
  visible: boolean;
  width: number;
  tab: "settings" | "prompt-group" | "reference";
  setVisible: Dispatch<SetStateAction<boolean>>;
  setTab: Dispatch<SetStateAction<"settings" | "prompt-group" | "reference">>;
  sourceImage: ImageData | null;
  setSourceImage: Dispatch<SetStateAction<ImageData | null>>;
  categories: PromptCategory[];
  setCategories: Dispatch<SetStateAction<PromptCategory[]>>;
  apiKeyInput: string;
  setApiKeyInput: Dispatch<SetStateAction<string>>;
  apiKeyValidated: boolean;
  setApiKeyValidated: Dispatch<SetStateAction<boolean>>;
  validating: boolean;
  onValidateApiKey: () => void;
  outputFolder: string;
  onSelectOutputFolder: () => void;
  configSaving: boolean;
  onSaveConfig: () => void;
  onResizeStart: (event: React.MouseEvent) => void;
}

const RightSidePanel = memo(function RightSidePanel({
  visible,
  width,
  tab,
  setVisible,
  setTab,
  sourceImage,
  setSourceImage,
  categories,
  setCategories,
  apiKeyInput,
  setApiKeyInput,
  apiKeyValidated,
  setApiKeyValidated,
  validating,
  onValidateApiKey,
  outputFolder,
  onSelectOutputFolder,
  configSaving,
  onSaveConfig,
  onResizeStart,
}: RightSidePanelProps) {
  const { t } = useTranslation();

  return visible ? (
    <>
      <div
        className="shrink-0 flex flex-col h-full bg-sidebar border-r border-border/40 overflow-hidden"
        style={{ width }}
      >
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border/40 shrink-0">
          <button
            onClick={() => setVisible(false)}
            title={t("generation.actions.collapsePanel")}
            className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <div className="flex-1" />
          {(
            [
              { id: "settings", icon: Settings, title: t("settings.title") },
              {
                id: "prompt-group",
                icon: LayoutList,
                title: t("generation.actions.promptGroup"),
              },
              {
                id: "reference",
                icon: ImageIcon,
                title: t("generation.actions.referenceImage"),
              },
            ] as const
          ).map(({ id, icon: Icon, title }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              title={title}
              className={cn(
                "h-7 w-7 rounded flex items-center justify-center transition-colors",
                tab === id
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
          {tab === "reference" && sourceImage && (
            <button
              onClick={() => setSourceImage(null)}
              title={t("generation.actions.removeReferenceImage")}
              className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0 ml-0.5"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {tab === "prompt-group" && (
          <div data-tour="gen-prompt-group-panel" className="flex-1 min-h-0">
            <PromptGroupPanel
              categories={categories}
              onCategoriesChange={setCategories}
            />
          </div>
        )}

        {tab === "settings" && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="divide-y divide-border/40 flex-1 overflow-y-auto">
              <div className="px-4 py-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground select-none">
                    NovelAI API Key
                  </span>
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={t("generation.actions.apiKeyHelp")}
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
                        {t("generation.actions.apiKeyHelpDescription")}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                {apiKeyValidated ? (
                  <div className="flex gap-1.5">
                    <input
                      type="password"
                      value={apiKeyInput}
                      readOnly
                      className={cn(INPUT_CLS, "flex-1 min-w-0")}
                    />
                    <button
                      onClick={() => {
                        setApiKeyInput("");
                        setApiKeyValidated(false);
                      }}
                      className="shrink-0 h-8 px-2.5 rounded-lg border border-border/60 bg-secondary/60 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors"
                    >
                      {t("generation.actions.replace")}
                    </button>
                  </div>
                ) : (
                  <input
                    type="text"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="API Key"
                    className={cn(INPUT_CLS, "w-full")}
                  />
                )}
                <button
                  onClick={onValidateApiKey}
                  disabled={
                    validating || !apiKeyInput.trim() || apiKeyValidated
                  }
                  className={cn(
                    "mt-1.5 w-full h-8 flex items-center justify-center gap-1.5 rounded-lg border text-xs transition-colors disabled:opacity-40",
                    apiKeyValidated
                      ? "border-success/40 bg-success/10 text-success"
                      : "border-border/60 bg-secondary/60 text-muted-foreground hover:text-foreground hover:border-border",
                  )}
                >
                  {validating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : apiKeyValidated ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : null}
                  {apiKeyValidated
                    ? t("generation.actions.loginSuccess")
                    : t("generation.actions.login")}
                </button>
              </div>

              <div className="px-4 py-3 space-y-1.5">
                <span className="text-xs text-muted-foreground select-none">
                  {t("generation.actions.outputFolder")}
                </span>
                <div className="flex gap-1.5">
                  <input
                    value={outputFolder}
                    placeholder={t(
                      "generation.actions.outputFolderPlaceholder",
                    )}
                    className={cn(INPUT_CLS, "flex-1 min-w-0")}
                    readOnly
                  />
                  <button
                    onClick={onSelectOutputFolder}
                    className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg border border-border/60 bg-secondary/60 text-muted-foreground hover:text-foreground hover:border-border transition-colors"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>

            <div className="px-4 py-3 border-t border-border/40 shrink-0">
              <button
                onClick={onSaveConfig}
                disabled={configSaving}
                className="w-full h-9 flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
              >
                {configSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {t("generation.actions.save")}
              </button>
            </div>
          </div>
        )}

        {tab === "reference" &&
          (sourceImage ? (
            <PromptSourcePanel image={sourceImage} />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 select-none">
              <div className="h-12 w-12 rounded-xl bg-secondary/50 border border-border/30 flex items-center justify-center">
                <ImageIcon className="h-5 w-5 text-muted-foreground/30" />
              </div>
              <p className="text-xs text-muted-foreground/40 text-center px-4">
                {t("generation.actions.sendToReferenceHint")}
              </p>
            </div>
          ))}
      </div>

      <div
        onMouseDown={onResizeStart}
        className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors"
      />
    </>
  ) : (
    <button
      onClick={() => setVisible(true)}
      title={t("generation.actions.openPanel")}
      className="shrink-0 w-5 h-full flex items-center justify-center border-r border-border/40 bg-sidebar text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
    >
      <ChevronRight className="h-3.5 w-3.5" />
    </button>
  );
});

function DuplicateGenerationModal({
  open,
  onClose,
  onContinue,
}: {
  open: boolean;
  onClose: () => void;
  onContinue: () => void;
}) {
  const { t } = useTranslation();

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/60 backdrop-blur-sm">
      <div className="w-80 rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <p className="text-sm font-semibold text-foreground">
            {t("generation.dialogs.duplicateTitle")}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {t("generation.dialogs.duplicateDescription")}
          </p>
        </div>
        <div className="flex gap-2 p-3">
          <button
            onClick={onClose}
            className="flex-1 h-9 rounded-lg border border-border/60 bg-secondary/60 text-sm text-foreground hover:bg-secondary transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={onContinue}
            className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            {t("generation.dialogs.continueGenerate")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ValidateResultModal({
  result,
  onClose,
}: {
  result: { valid: boolean; tier?: string; error?: string } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  if (!result) return null;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/60 backdrop-blur-sm">
      <div className="w-80 rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center gap-3">
          <div
            className={cn(
              "h-8 w-8 rounded-full flex items-center justify-center shrink-0",
              result.valid
                ? "bg-success/15 text-success"
                : "bg-destructive/15 text-destructive",
            )}
          >
            {result.valid ? (
              <Save className="h-4 w-4" />
            ) : (
              <X className="h-4 w-4" />
            )}
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              {result.valid
                ? t("generation.dialogs.validApiKey")
                : t("generation.dialogs.invalidApiKey")}
            </p>
            {result.valid && result.tier && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("generation.dialogs.subscriptionTier", {
                  tier: result.tier,
                })}
              </p>
            )}
            {!result.valid && result.error && (
              <p className="text-xs text-muted-foreground mt-0.5 break-all">
                {result.error}
              </p>
            )}
          </div>
        </div>
        <div className="px-5 py-3 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 h-8 rounded-lg bg-secondary text-xs font-medium text-foreground hover:bg-secondary/80 transition-colors"
          >
            {t("generation.dialogs.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

function DropImportModal({
  dropItem,
  previewUrl,
  loadingAction,
  vibeDisabled,
  preciseDisabled,
  importChecks,
  importing,
  importError,
  onClose,
  onSetI2i,
  onAddVibe,
  onSetPreciseRef,
  onToggleCheck,
  onImportMetadata,
}: {
  dropItem: DropItem | null;
  previewUrl: string | null;
  loadingAction: string | null;
  vibeDisabled: boolean;
  preciseDisabled: boolean;
  importChecks: ImportChecks;
  importing: boolean;
  importError: string | null;
  onClose: () => void;
  onSetI2i: () => void;
  onAddVibe: () => void;
  onSetPreciseRef: () => void;
  onToggleCheck: (key: keyof ImportChecks) => void;
  onImportMetadata: () => void;
}) {
  const { t } = useTranslation();

  if (!dropItem) return null;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/60 backdrop-blur-sm">
      <div className="w-100 rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <p className="text-sm font-semibold text-foreground">
              {t("generation.dialogs.imageAction")}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-70">
              {dropItem.name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {previewUrl && (
          <div
            className="bg-secondary/20 flex items-center justify-center"
            style={{ maxHeight: 220 }}
          >
            <img
              src={previewUrl}
              alt={t("generation.dialogs.previewAlt")}
              className="max-w-full object-contain"
              style={{ maxHeight: 220 }}
            />
          </div>
        )}

        <div className="px-5 py-4 border-b border-border/50">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-3">
            {t("generation.dialogs.actionSelect")}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                {
                  icon: ImagePlus,
                  label: "Image2Image",
                  action: onSetI2i,
                  key: "i2i",
                  disabled: false,
                },
                {
                  icon: Sparkles,
                  label: "Vibe Transfer",
                  action: onAddVibe,
                  key: "vibe",
                  disabled: vibeDisabled,
                },
                {
                  icon: Crosshair,
                  label: "Precise Ref",
                  action: onSetPreciseRef,
                  key: "precise",
                  disabled: preciseDisabled,
                },
              ] as const
            ).map(({ icon: Icon, label, action, key, disabled }) => (
              <button
                key={label}
                onClick={action}
                disabled={disabled || !!loadingAction}
                className={cn(
                  "flex flex-col items-center gap-1.5 py-3 rounded-xl border transition-colors relative overflow-hidden",
                  disabled
                    ? "border-border/40 bg-secondary/30 text-muted-foreground/40 cursor-not-allowed"
                    : "border-border/60 bg-secondary/50 text-muted-foreground hover:text-foreground hover:border-border hover:bg-secondary cursor-pointer",
                )}
              >
                {loadingAction === key ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Icon className="h-5 w-5" />
                )}
                <span className="text-[10px] font-medium">{label}</span>
                {disabled && (
                  <span className="absolute top-1 right-1 text-[8px] bg-border/60 text-muted-foreground/60 px-1 py-0.5 rounded font-medium leading-none">
                    {t("generation.dialogs.disabled")}
                  </span>
                )}
              </button>
            ))}
          </div>
          {vibeDisabled && (
            <p className="text-[10px] text-muted-foreground/50 mt-2">
              {t("generation.dialogs.preciseDisablesVibe")}
            </p>
          )}
          {preciseDisabled && (
            <p className="text-[10px] text-muted-foreground/50 mt-2">
              {t("generation.dialogs.vibeDisablesPrecise")}
            </p>
          )}
        </div>

        <div className="px-5 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-3">
            {t("generation.dialogs.importMetadata")}
          </p>
          <div className="grid grid-cols-2 gap-y-2.5 gap-x-4 mb-4">
            <Checkbox
              checked={importChecks.prompt}
              onChange={() => onToggleCheck("prompt")}
              label="Prompt"
            />
            <Checkbox
              checked={importChecks.negativePrompt}
              onChange={() => onToggleCheck("negativePrompt")}
              label="Negative Prompt"
            />
            <Checkbox
              checked={importChecks.characters}
              onChange={() => onToggleCheck("characters")}
              label="Characters"
            />
            <Checkbox
              checked={importChecks.charactersAppend}
              onChange={() => onToggleCheck("charactersAppend")}
              label="Append"
              disabled={!importChecks.characters}
            />
            <Checkbox
              checked={importChecks.settings}
              onChange={() => onToggleCheck("settings")}
              label="Settings"
            />
            <Checkbox
              checked={importChecks.seed}
              onChange={() => onToggleCheck("seed")}
              label="Seed"
            />
          </div>
          {importError && (
            <p className="text-xs text-destructive mb-3 bg-destructive/5 border border-destructive/20 rounded-lg px-3 py-2">
              {importError}
            </p>
          )}
          <button
            onClick={onImportMetadata}
            disabled={importing || Object.values(importChecks).every((v) => !v)}
            className="w-full h-9 flex items-center justify-center gap-2 rounded-lg bg-primary/15 border border-primary/30 text-primary text-sm font-medium hover:bg-primary/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {importing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            {importing
              ? t("generation.dialogs.importingMetadata")
              : t("generation.dialogs.importMetadata")}
          </button>
        </div>
      </div>
    </div>
  );
}

export const GenerationView = memo(function GenerationView({
  pendingImport,
  onClearPendingImport,
  pendingSourceImport,
  onClearPendingSourceImport,
  outputFolder,
  onOutputFolderChange,
  appendPromptTagRequest,
  tourActive,
  tourAction,
}: GenerationViewProps) {
  const { t } = useTranslation();
  const [selectedService, setSelectedService] =
    useState<GenerationService>("novelai");
  const [config, setConfig] = useState<NaiConfig | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [configSaving, setConfigSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [apiKeyValidated, setApiKeyValidated] = useState(false);
  const [validateResult, setValidateResult] = useState<{
    valid: boolean;
    tier?: string;
    error?: string;
  } | null>(null);
  const [categories, setCategories] = useState<PromptCategory[]>([]);

  const [prompt, setPrompt] = useState(() => loadLastGenParams()?.prompt ?? "");
  const [negativePrompt, setNegativePrompt] = useState(
    () => loadLastGenParams()?.negativePrompt ?? "",
  );
  const [promptInputMode, setPromptInputMode] = useState<
    "prompt" | "negativePrompt"
  >("prompt");
  const [characterPrompts, setCharacterPrompts] = useState<
    CharacterPromptInput[]
  >(() => loadLastGenParams()?.characterPrompts ?? []);
  const [customSizes, setCustomSizes] = useState<CustomSize[]>(() =>
    loadCustomSizes(),
  );
  const [aiChoice, setAiChoice] = useState(
    () => loadLastGenParams()?.aiChoice ?? true,
  );
  const [model, setModel] = useState(() => loadNaiGenSettings().model);
  const [width, setWidth] = useState(() => loadNaiGenSettings().width);
  const [height, setHeight] = useState(() => loadNaiGenSettings().height);
  const [steps, setSteps] = useState(() => loadNaiGenSettings().steps);
  const [scale, setScale] = useState(() => loadNaiGenSettings().scale);
  const [cfgRescale, setCfgRescale] = useState(
    () => loadNaiGenSettings().cfgRescale,
  );
  const [varietyPlus, setVarietyPlus] = useState(
    () => loadNaiGenSettings().varietyPlus,
  );
  const [sampler, setSampler] = useState(() => loadNaiGenSettings().sampler);
  const [noiseSchedule, setNoiseSchedule] = useState(
    () => loadNaiGenSettings().noiseSchedule,
  );
  const [seedInput, setSeedInput] = useState(
    () => loadLastGenParams()?.seedInput ?? "",
  );

  // Reference states
  const [i2iRef, setI2iRef] = useState<
    (RefImage & { strength: number; noise: number }) | null
  >(null);
  const [vibes, setVibes] = useState<
    Array<RefImage & { id: string; infoExtracted: number; strength: number }>
  >([]);
  const [preciseRef, setPreciseRef] = useState<
    (RefImage & { fidelity: number }) | null
  >(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [resultSrc, setResultSrc] = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [recentImages, setRecentImages] = useState<string[]>([]);
  const [recentSeeds, setRecentSeeds] = useState<Map<string, number>>(
    new Map(),
  );
  const [error, setError] = useState<string | null>(null);

  // Right side panel
  const [sourceImage, setSourceImage] = useState<ImageData | null>(null);
  const [rightPanelVisible, setRightPanelVisible] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<
    "settings" | "prompt-group" | "reference"
  >("settings");
  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
    try {
      return Number(localStorage.getItem("konomi-right-panel-width")) || 290;
    } catch {
      return 290;
    }
  });
  const rightResizeRef = useRef<{ startX: number; startWidth: number } | null>(
    null,
  );
  const rightPanelWidthRef = useRef(rightPanelWidth);

  useEffect(() => {
    if (!pendingSourceImport) return;
    setSourceImage(pendingSourceImport);
    setRightPanelTab("reference");
    setRightPanelVisible(true);
    onClearPendingSourceImport?.();
  }, [pendingSourceImport, onClearPendingSourceImport]);

  // Fill demo params when tour is active
  const tourPrevParamsRef = useRef<{
    prompt: string;
    negativePrompt: string;
    width: number;
    height: number;
    steps: number;
    scale: number;
    sampler: string;
  } | null>(null);
  useEffect(() => {
    if (tourActive && !tourPrevParamsRef.current) {
      tourPrevParamsRef.current = {
        prompt,
        negativePrompt,
        width,
        height,
        steps,
        scale,
        sampler,
      };
      setPrompt(
        "1girl, yukata, peace sign, %{looking at viewer|looking to the side}, fireworks, night, sparkles, watercolor, painterly, smile, 1.2::masterpiece ::, -1::simple background ::, ",
      );
      setNegativePrompt(
        "lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, blurry",
      );
      setWidth(832);
      setHeight(1216);
      setSteps(28);
      setScale(5.5);
      setSampler("k_euler_ancestral");
    } else if (!tourActive && tourPrevParamsRef.current) {
      const prev = tourPrevParamsRef.current;
      setPrompt(prev.prompt);
      setNegativePrompt(prev.negativePrompt);
      setWidth(prev.width);
      setHeight(prev.height);
      setSteps(prev.steps);
      setScale(prev.scale);
      setSampler(prev.sampler);
      tourPrevParamsRef.current = null;
    }
  }, [tourActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle tour actions
  useEffect(() => {
    if (tourAction === "open-prompt-group-panel") {
      setRightPanelVisible(true);
      setRightPanelTab("prompt-group");
    } else if (tourAction === "open-settings-panel") {
      setRightPanelVisible(true);
      setRightPanelTab("settings");
    }
  }, [tourAction]);

  const handleRightResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      rightResizeRef.current = {
        startX: e.clientX,
        startWidth: rightPanelWidth,
      };
      const onMove = (ev: MouseEvent) => {
        if (!rightResizeRef.current) return;
        const delta = ev.clientX - rightResizeRef.current.startX;
        const next = Math.max(
          290,
          Math.min(480, rightResizeRef.current.startWidth + delta),
        );
        setRightPanelWidth(next);
        rightPanelWidthRef.current = next;
      };
      const onUp = () => {
        try {
          localStorage.setItem(
            "konomi-right-panel-width",
            String(rightPanelWidthRef.current),
          );
        } catch {
          /* ignore */
        }
        rightResizeRef.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [rightPanelWidth],
  );

  useEffect(() => {
    const onUnload = () => {
      try {
        localStorage.setItem(
          "konomi-right-panel-width",
          String(rightPanelWidthRef.current),
        );
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  useEffect(() => {
    return window.nai.onGeneratePreview((dataUrl) => setPreviewSrc(dataUrl));
  }, []);

  // Resizable panel
  const [panelWidth, setPanelWidth] = useState(() => {
    try {
      return Number(localStorage.getItem("konomi-gen-panel-width")) || 450;
    } catch {
      return 450;
    }
  });
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const panelWidthRef = useRef(panelWidth);

  // Drag & drop
  const [dragOver, setDragOver] = useState(false);
  const [dropItem, setDropItem] = useState<DropItem | null>(null);
  const [importChecks, setImportChecks] = useState<ImportChecks>(() => {
    try {
      const saved = localStorage.getItem("konomi-import-checks");
      if (saved)
        return {
          ...{
            prompt: true,
            negativePrompt: true,
            characters: false,
            charactersAppend: false,
            settings: true,
            seed: false,
          },
          ...JSON.parse(saved),
        };
    } catch {
      /* ignore */
    }
    return {
      prompt: true,
      negativePrompt: true,
      characters: false,
      charactersAppend: false,
      settings: true,
      seed: false,
    };
  });
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const dragCountRef = useRef(0);
  const lastParamsKeyRef = useRef<string | null>(null);
  const [dupAlert, setDupAlert] = useState(false);
  const lastAppendPromptTagRequestIdRef = useRef<number | null>(null);
  const [autoGenCount, setAutoGenCount] = useState(5);
  const [autoGenDelay, setAutoGenDelay] = useState(3);
  const [autoGenSeedMode, setAutoGenSeedMode] = useState<"random" | "fixed">(
    "random",
  );
  const [autoGenInfinite, setAutoGenInfinite] = useState(false);
  const [autoGenPolicyAgreed, setAutoGenPolicyAgreed] = useState(() =>
    loadAutoGenPolicyAgreement(),
  );
  const [autoGenProgress, setAutoGenProgress] = useState<{
    current: number;
    total: number | null;
  } | null>(null);
  const [autoCancelPending, setAutoCancelPending] = useState(false);
  const autoCancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const appendTagToPrompt = useCallback((tag: string) => {
    const normalizedTag = tag.trim();
    if (!normalizedTag) return;
    setPrompt((prev) => {
      const trimmed = prev.trim();
      if (!trimmed) return normalizedTag;
      if (/[,\n\uFF0C|]\s*$/.test(trimmed)) {
        return `${trimmed} ${normalizedTag}`;
      }
      return `${trimmed}, ${normalizedTag}`;
    });
  }, []);

  useEffect(() => {
    if (!dropItem) {
      setPreviewUrl(null);
      return;
    }
    if (dropItem.kind === "file") {
      const url = URL.createObjectURL(dropItem.file);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreviewUrl(
      dropItem.kind === "image" ? dropItem.image.src : dropItem.src,
    );
    return undefined;
  }, [dropItem]);

  useEffect(() => {
    if (!pendingImport) return;
    const name = pendingImport.path.split(/[\\/]/).pop() ?? "image";
    setDropItem({ kind: "image", image: pendingImport, name });
    setImportError(null);
    onClearPendingImport?.();
  }, [pendingImport]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!appendPromptTagRequest) return;
    if (appendPromptTagRequest.id === lastAppendPromptTagRequestIdRef.current)
      return;
    lastAppendPromptTagRequestIdRef.current = appendPromptTagRequest.id;
    appendTagToPrompt(appendPromptTagRequest.tag);
    setPromptInputMode("prompt");
  }, [appendPromptTagRequest, appendTagToPrompt]);

  const promptGroups = useMemo(
    () => categories.flatMap((c) => c.groups),
    [categories],
  );
  const latestViewStateRef = useLatestRef({
    prompt,
    negativePrompt,
    characterPrompts,
    aiChoice,
    seedInput,
    outputFolder,
    model,
    width,
    height,
    steps,
    scale,
    cfgRescale,
    varietyPlus,
    sampler,
    noiseSchedule,
    i2iRef,
    vibes,
    preciseRef,
    categories,
    apiKey: config?.apiKey,
    autoGenCount,
    autoGenDelay,
    autoGenInfinite,
    autoGenPolicyAgreed,
    autoGenSeedMode,
    t,
  });

  const reloadGroups = () => {
    window.promptBuilder
      .listCategories()
      .then((cs) => setCategories(cs))
      .catch(() => {});
  };

  useEffect(() => {
    window.nai
      .getConfig()
      .then((cfg) => {
        setConfig(cfg);
        setApiKeyInput(cfg.apiKey);
        if (cfg.apiKey) setApiKeyValidated(true);
        if (!cfg.apiKey || !outputFolder) {
          setRightPanelTab("settings");
          setRightPanelVisible(true);
        }
      })
      .catch((e: unknown) => {
        toast.error(
          t("generation.feedback.settingsLoadFailed", {
            message: e instanceof Error ? e.message : String(e),
          }),
        );
        setRightPanelTab("settings");
        setRightPanelVisible(true);
      });
    reloadGroups();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        localStorage.setItem(
          NAI_GEN_KEY,
          JSON.stringify({
            outputFolder,
            model,
            sampler,
            steps,
            scale,
            cfgRescale,
            varietyPlus,
            width,
            height,
            noiseSchedule,
          }),
        );
      } catch {
        /* ignore */
      }
    }, NAI_GEN_PERSIST_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [
    outputFolder,
    model,
    sampler,
    steps,
    scale,
    cfgRescale,
    varietyPlus,
    width,
    height,
    noiseSchedule,
  ]);

  useEffect(() => {
    localStorage.setItem(
      AUTO_GEN_POLICY_AGREEMENT_KEY,
      String(autoGenPolicyAgreed),
    );
  }, [autoGenPolicyAgreed]);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      if (i2iRef?.isObjectUrl) URL.revokeObjectURL(i2iRef.previewUrl);
      vibes.forEach((v) => {
        if (v.isObjectUrl) URL.revokeObjectURL(v.previewUrl);
      });
      if (preciseRef?.isObjectUrl) URL.revokeObjectURL(preciseRef.previewUrl);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizeRef.current = { startX: e.clientX, startWidth: panelWidth };
      const onMove = (e: MouseEvent) => {
        if (!resizeRef.current) return;
        const delta = e.clientX - resizeRef.current.startX;
        const next = Math.max(
          450,
          Math.min(560, resizeRef.current.startWidth + delta),
        );
        setPanelWidth(next);
        panelWidthRef.current = next;
      };
      const onUp = () => {
        try {
          localStorage.setItem(
            "konomi-gen-panel-width",
            String(panelWidthRef.current),
          );
        } catch {
          /* ignore */
        }
        resizeRef.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [panelWidth],
  );

  useEffect(() => {
    const onUnload = () => {
      try {
        localStorage.setItem(
          "konomi-gen-panel-width",
          String(panelWidthRef.current),
        );
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  const handleValidateApiKey = useCallback(async () => {
    const nextApiKey = apiKeyInput.trim();
    if (!nextApiKey) return;
    setValidating(true);
    try {
      const result = await window.nai.validateApiKey(nextApiKey);
      if (result.valid) {
        const updated = await window.nai.updateConfig({
          apiKey: nextApiKey,
        });
        setConfig(updated);
        setApiKeyValidated(true);
      } else {
        setValidateResult({ valid: false });
      }
    } catch (e: unknown) {
      setValidateResult({
        valid: false,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setValidating(false);
    }
  }, [apiKeyInput]);

  const handleSaveConfig = useCallback(async () => {
    setConfigSaving(true);
    try {
      const updated = await window.nai.updateConfig({ apiKey: apiKeyInput });
      setConfig(updated);
      toast.success(t("generation.feedback.settingsSaved"));
    } catch (e: unknown) {
      toast.error(
        t("generation.feedback.settingsSaveFailed", {
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setConfigSaving(false);
    }
  }, [apiKeyInput, t]);

  const handleSelectOutputFolder = useCallback(async () => {
    const dir = await window.dialog.selectDirectory();
    if (dir) onOutputFolderChange(dir);
  }, [onOutputFolderChange]);

  const saveLastGenParams = useCallback(
    (nextSeedInput?: string) => {
      const {
        prompt: nextPrompt,
        negativePrompt: nextNegativePrompt,
        characterPrompts: nextCharacterPrompts,
        aiChoice: nextAiChoice,
        seedInput: currentSeedInput,
      } = latestViewStateRef.current;
      try {
        localStorage.setItem(
          LAST_GEN_PARAMS_KEY,
          JSON.stringify({
            prompt: nextPrompt,
            negativePrompt: nextNegativePrompt,
            characterPrompts: nextCharacterPrompts,
            aiChoice: nextAiChoice,
            seedInput: nextSeedInput ?? currentSeedInput,
          }),
        );
      } catch {
        /* ignore */
      }
    },
    [latestViewStateRef],
  );

  const resolveSeedForGeneration = useCallback(
    (
      rawSeedInput: string,
      options?: { switchAutoSeedModeToRandom?: boolean },
    ) => {
      const { t: translate } = latestViewStateRef.current;
      const parsedSeed = parseSeedInputValue(rawSeedInput);
      if (parsedSeed.kind !== "invalid") {
        return parsedSeed.kind === "valid" ? parsedSeed.value : undefined;
      }

      toast.warning(
        translate("generation.feedback.invalidSeedRange", {
          min: NAI_SEED_MIN,
          max: NAI_SEED_MAX,
        }),
      );
      setSeedInput("");
      if (options?.switchAutoSeedModeToRandom) {
        setAutoGenSeedMode("random");
      }
      return createRandomSeed();
    },
    [latestViewStateRef],
  );

  const handleGenerate = useCallback(
    async (force = false) => {
      const current = latestViewStateRef.current;
      if (!current.prompt.trim()) return;

      const expandGroupRefs = (text: string) =>
        expandGroupRefsFromCategories(text, current.categories);
      const seed = resolveSeedForGeneration(current.seedInput);
      const validCharacterPrompts = current.characterPrompts.filter((c) =>
        c.prompt.trim(),
      );
      const paramsKey = JSON.stringify({
        prompt: expandGroupRefs(current.prompt),
        negativePrompt: expandGroupRefs(current.negativePrompt),
        characterPrompts: validCharacterPrompts.map((c) =>
          expandGroupRefs(c.prompt.trim()),
        ),
        characterNegativePrompts: validCharacterPrompts.map((c) =>
          expandGroupRefs(c.negativePrompt.trim()),
        ),
        characterPositions: validCharacterPrompts.map((c) => c.position),
        model: current.model,
        width: current.width,
        height: current.height,
        steps: current.steps,
        scale: current.scale,
        sampler: current.sampler,
        noiseSchedule: current.noiseSchedule,
        seed,
        i2iName: current.i2iRef?.name,
        i2iStrength: current.i2iRef?.strength,
        i2iNoise: current.i2iRef?.noise,
        vibes: current.vibes.map((v) => v.name + v.infoExtracted + v.strength),
        preciseRefName: current.preciseRef?.name,
        preciseRefFidelity: current.preciseRef?.fidelity,
      });
      if (!force && paramsKey === lastParamsKeyRef.current) {
        setDupAlert(true);
        return;
      }
      lastParamsKeyRef.current = paramsKey;
      setGenerating(true);
      setError(null);
      setResultSrc(null);
      setPreviewSrc(null);
      try {
        const params: GenerateParams = {
          prompt: expandGroupRefs(current.prompt),
          negativePrompt: expandGroupRefs(current.negativePrompt),
          ...(validCharacterPrompts.length > 0 && {
            characterPrompts: validCharacterPrompts.map((c) =>
              expandGroupRefs(c.prompt.trim()),
            ),
            characterNegativePrompts: validCharacterPrompts.map((c) =>
              expandGroupRefs(c.negativePrompt.trim()),
            ),
            characterPositions: validCharacterPrompts.map((c) => c.position),
          }),
          outputFolder: current.outputFolder,
          model: current.model,
          width: current.width,
          height: current.height,
          steps: current.steps,
          scale: current.scale,
          cfgRescale: current.cfgRescale,
          varietyPlus: current.varietyPlus,
          sampler: current.sampler,
          noiseSchedule: current.noiseSchedule,
          seed,
          ...(current.i2iRef && {
            i2i: {
              imageData: current.i2iRef.data,
              strength: current.i2iRef.strength,
              noise: current.i2iRef.noise,
            },
          }),
          ...(current.vibes.length > 0 && {
            vibes: current.vibes.map((v) => ({
              imageData: v.data,
              infoExtracted: v.infoExtracted,
              strength: v.strength,
            })),
          }),
          ...(current.preciseRef && {
            preciseRef: {
              imageData: current.preciseRef.data,
              fidelity: current.preciseRef.fidelity,
            },
          }),
        };
        const filePath = await window.nai.generate(params);
        const src = `konomi://local/${encodeURIComponent(filePath.replace(/\\/g, "/"))}`;
        setResultSrc(src);
        setRecentImages((prev) => [src, ...prev]);
        saveLastGenParams(getStoredSeedInput(current.seedInput));
        void window.image.readNaiMeta(filePath).then((meta) => {
          if (meta?.seed != null) {
            setRecentSeeds((prev) => new Map(prev).set(src, meta.seed!));
          }
        });
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setGenerating(false);
        setPreviewSrc(null);
      }
    },
    [latestViewStateRef, resolveSeedForGeneration, saveLastGenParams],
  );

  const handleAutoGenerate = useCallback(async () => {
    const current = latestViewStateRef.current;
    if (!current.autoGenPolicyAgreed) {
      toast.error(current.t("generation.feedback.autoGenerateWarning"));
      return;
    }
    if (!current.prompt.trim() || !current.apiKey || !current.outputFolder)
      return;

    const expandGroupRefs = (text: string) =>
      expandGroupRefsFromCategories(text, current.categories);
    const cancelToken = { cancelled: false };
    autoCancelRef.current = cancelToken;
    const fixedSeed =
      current.autoGenSeedMode === "fixed"
        ? resolveSeedForGeneration(current.seedInput, {
            switchAutoSeedModeToRandom: true,
          })
        : undefined;
    const useRandomSeed =
      current.autoGenSeedMode === "random" || fixedSeed === undefined;

    for (let i = 0; current.autoGenInfinite || i < current.autoGenCount; i++) {
      if (cancelToken.cancelled) break;

      const overrideSeed = useRandomSeed ? createRandomSeed() : fixedSeed;

      const validCharacterPrompts = current.characterPrompts.filter((c) =>
        c.prompt.trim(),
      );

      setAutoGenProgress({
        current: i + 1,
        total: current.autoGenInfinite ? null : current.autoGenCount,
      });
      setGenerating(true);
      setError(null);
      setResultSrc(null);
      setPreviewSrc(null);

      try {
        const params: GenerateParams = {
          prompt: expandGroupRefs(current.prompt),
          negativePrompt: expandGroupRefs(current.negativePrompt),
          ...(validCharacterPrompts.length > 0 && {
            characterPrompts: validCharacterPrompts.map((c) =>
              expandGroupRefs(c.prompt.trim()),
            ),
            characterNegativePrompts: validCharacterPrompts.map((c) =>
              expandGroupRefs(c.negativePrompt.trim()),
            ),
            characterPositions: validCharacterPrompts.map((c) => c.position),
          }),
          outputFolder: current.outputFolder,
          model: current.model,
          width: current.width,
          height: current.height,
          steps: current.steps,
          scale: current.scale,
          cfgRescale: current.cfgRescale,
          varietyPlus: current.varietyPlus,
          sampler: current.sampler,
          noiseSchedule: current.noiseSchedule,
          seed: overrideSeed,
          ...(current.i2iRef && {
            i2i: {
              imageData: current.i2iRef.data,
              strength: current.i2iRef.strength,
              noise: current.i2iRef.noise,
            },
          }),
          ...(current.vibes.length > 0 && {
            vibes: current.vibes.map((v) => ({
              imageData: v.data,
              infoExtracted: v.infoExtracted,
              strength: v.strength,
            })),
          }),
          ...(current.preciseRef && {
            preciseRef: {
              imageData: current.preciseRef.data,
              fidelity: current.preciseRef.fidelity,
            },
          }),
        };
        const filePath = await window.nai.generate(params);
        const src = `konomi://local/${encodeURIComponent(filePath.replace(/\\/g, "/"))}`;
        setResultSrc(src);
        setRecentImages((prev) => [src, ...prev]);
        saveLastGenParams(getStoredSeedInput(current.seedInput));
        void window.image.readNaiMeta(filePath).then((meta) => {
          if (meta?.seed != null) {
            setRecentSeeds((prev) => new Map(prev).set(src, meta.seed!));
          }
        });
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
        break;
      } finally {
        setGenerating(false);
        setPreviewSrc(null);
      }

      if (
        (current.autoGenInfinite || i < current.autoGenCount - 1) &&
        !cancelToken.cancelled
      ) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, current.autoGenDelay * 1000),
        );
      }
    }

    setAutoGenProgress(null);
    setAutoCancelPending(false);
  }, [latestViewStateRef, resolveSeedForGeneration, saveLastGenParams]);

  const handleCancelAutoGenerate = useCallback(() => {
    autoCancelRef.current.cancelled = true;
    setAutoCancelPending(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCountRef.current++;
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    dragCountRef.current--;
    if (dragCountRef.current <= 0) {
      dragCountRef.current = 0;
      setDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCountRef.current = 0;
    setDragOver(false);
    const konomiPath = e.dataTransfer.getData("text/x-konomi-path");
    if (konomiPath) {
      const name = konomiPath.split(/[/\\]/).pop() ?? "image";
      const src = `konomi://local/${encodeURIComponent(konomiPath.replace(/\\/g, "/"))}`;
      setDropItem({ kind: "path", path: konomiPath, src, name });
      setImportError(null);
      return;
    }
    const file = e.dataTransfer.files[0];
    if (file) {
      setDropItem({ kind: "file", file, name: file.name });
      setImportError(null);
    }
  }, []);

  const getDropItemData = useCallback(
    async (item: DropItem): Promise<RefImage> => {
      if (item.kind === "file") {
        const data = new Uint8Array(await item.file.arrayBuffer());
        const objUrl = URL.createObjectURL(item.file);
        return { data, previewUrl: objUrl, name: item.name, isObjectUrl: true };
      }

      const path = item.kind === "image" ? item.image.path : item.path;
      const src = item.kind === "image" ? item.image.src : item.src;
      const buf = await window.image.readFile(path);
      return {
        data: new Uint8Array(buf),
        previewUrl: src,
        name: item.name,
        isObjectUrl: false,
      };
    },
    [],
  );

  const handleSetI2i = useCallback(async () => {
    if (!dropItem || loadingAction) return;
    setLoadingAction("i2i");
    try {
      const ref = await getDropItemData(dropItem);
      if (i2iRef?.isObjectUrl) URL.revokeObjectURL(i2iRef.previewUrl);
      setI2iRef({ ...ref, strength: 0.7, noise: 0.0 });
      setDropItem(null);
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingAction(null);
    }
  }, [dropItem, getDropItemData, i2iRef, loadingAction]);

  const handleAddVibe = useCallback(async () => {
    if (!dropItem || loadingAction) return;
    setLoadingAction("vibe");
    try {
      const ref = await getDropItemData(dropItem);
      setVibes((prev) => [
        ...prev,
        { ...ref, id: crypto.randomUUID(), infoExtracted: 0.85, strength: 0.6 },
      ]);
      setDropItem(null);
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingAction(null);
    }
  }, [dropItem, getDropItemData, loadingAction]);

  const handleSetPreciseRef = useCallback(async () => {
    if (!dropItem || loadingAction) return;
    setLoadingAction("precise");
    try {
      const ref = await getDropItemData(dropItem);
      if (preciseRef?.isObjectUrl) URL.revokeObjectURL(preciseRef.previewUrl);
      setPreciseRef({ ...ref, fidelity: 0.75 });
      setDropItem(null);
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingAction(null);
    }
  }, [dropItem, getDropItemData, loadingAction, preciseRef]);

  const handleImportMetadata = useCallback(async () => {
    if (!dropItem) return;
    setImporting(true);
    setImportError(null);
    try {
      const meta: NovelAIMeta | null =
        dropItem.kind === "file"
          ? await window.image.readMetaFromBuffer(
              new Uint8Array(await dropItem.file.arrayBuffer()),
            )
          : await window.image.readNaiMeta(
              dropItem.kind === "image" ? dropItem.image.path : dropItem.path,
            );
      if (!meta) throw new Error(t("generation.feedback.metadataNotFound"));

      if (importChecks.prompt && meta.prompt) setPrompt(meta.prompt);
      if (importChecks.negativePrompt && meta.negativePrompt)
        setNegativePrompt(meta.negativePrompt);
      if (importChecks.characters && meta.characterPrompts.length > 0) {
        setCharacterPrompts(
          meta.characterPrompts.map((cp, i) => ({
            ...createCharacterPromptInput(cp),
            negativePrompt: meta.characterNegativePrompts?.[i] ?? "",
            position: (meta.characterPositions?.[i] ??
              "global") as CharacterPosition,
          })),
        );
      }
      if (importChecks.charactersAppend && meta.characterPrompts.length > 0) {
        setCharacterPrompts((prev) => [
          ...prev,
          ...meta.characterPrompts.map((cp, i) => ({
            ...createCharacterPromptInput(cp),
            negativePrompt: meta.characterNegativePrompts?.[i] ?? "",
            position: (meta.characterPositions?.[i] ??
              "global") as CharacterPosition,
          })),
        ]);
      }
      if (importChecks.settings) {
        if (meta.model && MODELS.some((m) => m.value === meta.model)) {
          setModel(meta.model);
        } else if (meta.source === "nai") {
          toast.info(t("generation.feedback.legacyModelAdjusted"));
          setModel("nai-diffusion-4-5-full");
        }
        if (meta.sampler && SAMPLERS.includes(meta.sampler))
          setSampler(meta.sampler);
        if (meta.steps) setSteps(meta.steps);
        if (meta.cfgScale) setScale(meta.cfgScale);
        if (meta.noiseSchedule && NOISE_SCHEDULES.includes(meta.noiseSchedule))
          setNoiseSchedule(meta.noiseSchedule);
        if (meta.width) setWidth(meta.width);
        if (meta.height) setHeight(meta.height);
      }
      if (importChecks.seed && meta.seed) setSeedInput(String(meta.seed));

      setDropItem(null);
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }, [
    dropItem,
    importChecks,
    setPrompt,
    setNegativePrompt,
    setCharacterPrompts,
    setModel,
    setSampler,
    setSteps,
    setScale,
    setNoiseSchedule,
    setWidth,
    setHeight,
    setSeedInput,
    t,
  ]);

  const toggleCheck = useCallback((key: keyof ImportChecks) => {
    setImportChecks((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (key === "characters" && !next.characters)
        next.charactersAppend = false;
      localStorage.setItem("konomi-import-checks", JSON.stringify(next));
      return next;
    });
  }, []);
  // Vibe Transfer와 Precise Reference는 동시 사용 불가
  const vibeDisabled = preciseRef !== null;
  const preciseDisabled = vibes.length > 0;
  const handleCloseDupAlert = useCallback(() => {
    setDupAlert(false);
  }, []);
  const handleContinueAfterDuplicate = useCallback(() => {
    setDupAlert(false);
    void handleGenerate(true);
  }, [handleGenerate]);
  const handleCloseValidateResult = useCallback(() => {
    setValidateResult(null);
  }, []);
  const handleCloseDropItem = useCallback(() => {
    setDropItem(null);
  }, []);
  const isNovelAIService = selectedService === "novelai";

  return (
    <div className="flex flex-1 overflow-hidden">
      <LeftPanel
        panelWidth={panelWidth}
        selectedService={selectedService}
        setSelectedService={setSelectedService}
        hasApiKey={!!config?.apiKey}
        outputFolder={outputFolder}
        tourActive={!!tourActive}
        model={model}
        setModel={setModel}
        promptInputMode={promptInputMode}
        setPromptInputMode={setPromptInputMode}
        prompt={prompt}
        negativePrompt={negativePrompt}
        setPrompt={setPrompt}
        setNegativePrompt={setNegativePrompt}
        promptGroups={promptGroups}
        characterPrompts={characterPrompts}
        setCharacterPrompts={setCharacterPrompts}
        aiChoice={aiChoice}
        setAiChoice={setAiChoice}
        i2iRef={i2iRef}
        setI2iRef={setI2iRef}
        vibes={vibes}
        setVibes={setVibes}
        preciseRef={preciseRef}
        setPreciseRef={setPreciseRef}
        width={width}
        setWidth={setWidth}
        height={height}
        setHeight={setHeight}
        customSizes={customSizes}
        setCustomSizes={setCustomSizes}
        steps={steps}
        setSteps={setSteps}
        scale={scale}
        setScale={setScale}
        cfgRescale={cfgRescale}
        setCfgRescale={setCfgRescale}
        varietyPlus={varietyPlus}
        setVarietyPlus={setVarietyPlus}
        sampler={sampler}
        setSampler={setSampler}
        noiseSchedule={noiseSchedule}
        setNoiseSchedule={setNoiseSchedule}
        seedInput={seedInput}
        setSeedInput={setSeedInput}
        autoGenCount={autoGenCount}
        setAutoGenCount={setAutoGenCount}
        autoGenDelay={autoGenDelay}
        setAutoGenDelay={setAutoGenDelay}
        autoGenSeedMode={autoGenSeedMode}
        setAutoGenSeedMode={setAutoGenSeedMode}
        autoGenInfinite={autoGenInfinite}
        setAutoGenInfinite={setAutoGenInfinite}
        autoGenPolicyAgreed={autoGenPolicyAgreed}
        setAutoGenPolicyAgreed={setAutoGenPolicyAgreed}
        generating={generating}
        autoGenProgress={autoGenProgress}
        autoCancelPending={autoCancelPending}
        onGenerate={handleGenerate}
        onAutoGenerate={handleAutoGenerate}
        onCancelAutoGenerate={handleCancelAutoGenerate}
      />
      {/* Left panel resize handle */}
      <div
        onMouseDown={handleResizeStart}
        className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors"
      />

      {isNovelAIService ? (
        <>
          <RightSidePanel
            visible={rightPanelVisible}
            width={rightPanelWidth}
            tab={rightPanelTab}
            setVisible={setRightPanelVisible}
            setTab={setRightPanelTab}
            sourceImage={sourceImage}
            setSourceImage={setSourceImage}
            categories={categories}
            setCategories={setCategories}
            apiKeyInput={apiKeyInput}
            setApiKeyInput={setApiKeyInput}
            apiKeyValidated={apiKeyValidated}
            setApiKeyValidated={setApiKeyValidated}
            validating={validating}
            onValidateApiKey={handleValidateApiKey}
            outputFolder={outputFolder}
            onSelectOutputFolder={handleSelectOutputFolder}
            configSaving={configSaving}
            onSaveConfig={handleSaveConfig}
            onResizeStart={handleRightResizeStart}
          />

          <ResultArea
            dragOver={dragOver}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            generating={generating}
            previewSrc={previewSrc}
            error={error}
            resultSrc={resultSrc}
            recentSeeds={recentSeeds}
            setSeedInput={setSeedInput}
            recentImages={recentImages}
            setResultSrc={setResultSrc}
          />

          <DuplicateGenerationModal
            open={dupAlert}
            onClose={handleCloseDupAlert}
            onContinue={handleContinueAfterDuplicate}
          />

          <ValidateResultModal
            result={validateResult}
            onClose={handleCloseValidateResult}
          />

          <DropImportModal
            dropItem={dropItem}
            previewUrl={previewUrl}
            loadingAction={loadingAction}
            vibeDisabled={vibeDisabled}
            preciseDisabled={preciseDisabled}
            importChecks={importChecks}
            importing={importing}
            importError={importError}
            onClose={handleCloseDropItem}
            onSetI2i={handleSetI2i}
            onAddVibe={handleAddVibe}
            onSetPreciseRef={handleSetPreciseRef}
            onToggleCheck={toggleCheck}
            onImportMetadata={handleImportMetadata}
          />
        </>
      ) : (
        <div className="flex-1 bg-background" />
      )}
    </div>
  );
});

GenerationView.displayName = "GenerationView";
