import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Save,
  Wand2,
  ChevronDown,
  ChevronUp,
  Shuffle,
  Settings2,
  X,
  ImagePlus,
  Sparkles,
  Crosshair,
  Plus,
  Trash2,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { NaiConfig, GenerateParams } from "@preload/index.d";
import type { NovelAIMeta } from "@/types/nai";
import type { ImageData } from "@/components/image-card";

type DropItem =
  | { kind: "file"; file: File; name: string }
  | { kind: "image"; image: ImageData; name: string };

type RefImage = {
  data: Uint8Array;
  previewUrl: string;
  name: string;
  isObjectUrl: boolean;
};

type CharacterPromptMode = "prompt" | "negativePrompt";
type CharacterPromptInput = {
  prompt: string;
  negativePrompt: string;
  inputMode: CharacterPromptMode;
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
  { label: "세로", width: 832, height: 1216 },
  { label: "가로", width: 1216, height: 832 },
  { label: "정방", width: 1024, height: 1024 },
  { label: "소형", width: 768, height: 768 },
];

const SAMPLERS = [
  "k_euler",
  "k_euler_ancestral",
  "k_dpmpp_2s_ancestral",
  "k_dpmpp_2m",
  "k_dpmpp_sde",
  "ddim",
];

const NOISE_SCHEDULES = ["karras", "exponential", "polyexponential", "native"];

const TEXTAREA_CLS =
  "w-full bg-secondary/60 border border-border/60 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 focus:bg-secondary transition-colors resize-y";
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

function Select({
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
    <div className={cn("relative", className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none bg-secondary/60 border border-border/60 rounded-lg px-3 py-1.5 pr-7 text-sm text-foreground focus:outline-none focus:border-primary/60 focus:bg-secondary transition-colors cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/60 pointer-events-none" />
    </div>
  );
}

function Slider({
  min,
  max,
  step = 1,
  value,
  onChange,
}: {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-primary bg-secondary"
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
  outputFolder: string;
}

const NAI_GEN_KEY = "konomi-nai-gen-settings";
const NAI_GEN_DEFAULTS = {
  model: "nai-diffusion-4-5-full",
  width: 832,
  height: 1216,
  steps: 28,
  scale: 5.0,
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

export function GenerationView({
  pendingImport,
  onClearPendingImport,
  outputFolder,
}: GenerationViewProps) {
  const [config, setConfig] = useState<NaiConfig | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [configOpen, setConfigOpen] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);

  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [promptInputMode, setPromptInputMode] = useState<
    "prompt" | "negativePrompt"
  >("prompt");
  const [characterPrompts, setCharacterPrompts] = useState<
    CharacterPromptInput[]
  >([]);
  const [characterAddOpen, setCharacterAddOpen] = useState(false);
  const [model, setModel] = useState(() => loadNaiGenSettings().model);
  const [width, setWidth] = useState(() => loadNaiGenSettings().width);
  const [height, setHeight] = useState(() => loadNaiGenSettings().height);
  const [steps, setSteps] = useState(() => loadNaiGenSettings().steps);
  const [scale, setScale] = useState(() => loadNaiGenSettings().scale);
  const [sampler, setSampler] = useState(() => loadNaiGenSettings().sampler);
  const [noiseSchedule, setNoiseSchedule] = useState(
    () => loadNaiGenSettings().noiseSchedule,
  );
  const [seedInput, setSeedInput] = useState("");

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
  const [error, setError] = useState<string | null>(null);

  // Resizable panel
  const [panelWidth, setPanelWidth] = useState(() => {
    try {
      return Number(localStorage.getItem("konomi-gen-panel-width")) || 340;
    } catch {
      return 340;
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
    setPreviewUrl(dropItem.image.src);
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
    window.nai
      .getConfig()
      .then((cfg) => {
        setConfig(cfg);
        setApiKeyInput(cfg.apiKey);
        if (!cfg.apiKey || !outputFolder) setConfigOpen(true);
      })
      .catch((e: unknown) => {
        toast.error(
          `설정 로드 실패: ${e instanceof Error ? e.message : String(e)}`,
        );
        setConfigOpen(true);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    localStorage.setItem(
      NAI_GEN_KEY,
      JSON.stringify({
        outputFolder,
        model,
        sampler,
        steps,
        scale,
        width,
        height,
        noiseSchedule,
      }),
    );
  }, [
    outputFolder,
    model,
    sampler,
    steps,
    scale,
    width,
    height,
    noiseSchedule,
  ]);

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
          260,
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

  const handleSaveConfig = async () => {
    setConfigSaving(true);
    try {
      const updated = await window.nai.updateConfig({ apiKey: apiKeyInput });
      setConfig(updated);
      toast.success("저장되었습니다");
      if (updated.apiKey && outputFolder) setConfigOpen(false);
    } catch (e: unknown) {
      toast.error(
        `설정 저장 실패: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setConfigSaving(false);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setError(null);
    setResultSrc(null);
    try {
      const seed = seedInput.trim() ? parseInt(seedInput, 10) : undefined;
      const validCharacterPrompts = characterPrompts.filter((c) =>
        c.prompt.trim(),
      );
      const params: GenerateParams = {
        prompt,
        negativePrompt,
        ...(validCharacterPrompts.length > 0 && {
          characterPrompts: validCharacterPrompts.map((c) => c.prompt.trim()),
          characterNegativePrompts: validCharacterPrompts.map((c) =>
            c.negativePrompt.trim(),
          ),
        }),
        outputFolder,
        model,
        width,
        height,
        steps,
        scale,
        sampler,
        noiseSchedule,
        seed,
        ...(i2iRef && {
          i2i: {
            imageData: i2iRef.data,
            strength: i2iRef.strength,
            noise: i2iRef.noise,
          },
        }),
        ...(vibes.length > 0 && {
          vibes: vibes.map((v) => ({
            imageData: v.data,
            infoExtracted: v.infoExtracted,
            strength: v.strength,
          })),
        }),
        ...(preciseRef && {
          preciseRef: {
            imageData: preciseRef.data,
            fidelity: preciseRef.fidelity,
          },
        }),
      };
      const filePath = await window.nai.generate(params);
      setResultSrc(
        `konomi://local/${encodeURIComponent(filePath.replace(/\\/g, "/"))}`,
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCountRef.current++;
    setDragOver(true);
  };
  const handleDragLeave = () => {
    dragCountRef.current--;
    if (dragCountRef.current <= 0) {
      dragCountRef.current = 0;
      setDragOver(false);
    }
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCountRef.current = 0;
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      setDropItem({ kind: "file", file, name: file.name });
      setImportError(null);
    }
  };

  const getDropItemData = async (item: DropItem): Promise<RefImage> => {
    if (item.kind === "file") {
      const data = new Uint8Array(await item.file.arrayBuffer());
      const objUrl = URL.createObjectURL(item.file);
      return { data, previewUrl: objUrl, name: item.name, isObjectUrl: true };
    } else {
      const buf = await window.image.readFile(item.image.path);
      return {
        data: new Uint8Array(buf),
        previewUrl: item.image.src,
        name: item.name,
        isObjectUrl: false,
      };
    }
  };

  const handleSetI2i = async () => {
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
  };

  const handleAddVibe = async () => {
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
  };

  const handleSetPreciseRef = async () => {
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
  };

  const handleImportMetadata = async () => {
    if (!dropItem) return;
    setImporting(true);
    setImportError(null);
    try {
      const meta: NovelAIMeta | null =
        dropItem.kind === "file"
          ? await window.image.readMetaFromBuffer(
              new Uint8Array(await dropItem.file.arrayBuffer()),
            )
          : await window.image.readNaiMeta(dropItem.image.path);
      if (!meta) throw new Error("메타데이터를 찾을 수 없습니다");

      if (importChecks.prompt && meta.prompt) setPrompt(meta.prompt);
      if (importChecks.negativePrompt && meta.negativePrompt)
        setNegativePrompt(meta.negativePrompt);
      if (importChecks.characters && meta.characterPrompts.length > 0) {
        setCharacterPrompts(
          meta.characterPrompts.map((cp) => createCharacterPromptInput(cp)),
        );
      }
      if (importChecks.charactersAppend && meta.characterPrompts.length > 0) {
        setCharacterPrompts((prev) => [
          ...prev,
          ...meta.characterPrompts.map((cp) => createCharacterPromptInput(cp)),
        ]);
      }
      if (importChecks.settings) {
        if (meta.model && MODELS.some((m) => m.value === meta.model)) {
          setModel(meta.model);
        } else if (meta.source === "nai") {
          toast.info("레거시 모델 이미지입니다. V4.5 Full로 설정합니다.");
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
  };

  const toggleCheck = (key: keyof ImportChecks) =>
    setImportChecks((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (key === "characters" && !next.characters)
        next.charactersAppend = false;
      localStorage.setItem("konomi-import-checks", JSON.stringify(next));
      return next;
    });

  const handleAddCharacterPrompt = (preset: CharacterPromptPreset) => {
    const promptPrefix =
      CHARACTER_PROMPT_PRESETS.find((x) => x.value === preset)?.promptPrefix ??
      "";
    setCharacterPrompts((prev) => [
      ...prev,
      createCharacterPromptInput(promptPrefix),
    ]);
    setCharacterAddOpen(false);
  };

  const selectedPreset = SIZE_PRESETS.find(
    (p) => p.width === width && p.height === height,
  );
  const canGenerate =
    !generating && !!config?.apiKey && !!outputFolder && !!prompt.trim();
  // Vibe Transfer와 Precise Reference는 동시 사용 불가
  const vibeDisabled = preciseRef !== null;
  const preciseDisabled = vibes.length > 0;

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left panel */}
      <div
        className="flex flex-col border-r border-border shrink-0 bg-sidebar overflow-hidden"
        style={{ width: panelWidth }}
      >
        {/* API 설정 토글 */}
        <button
          onClick={() => setConfigOpen((v) => !v)}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground transition-colors border-b",
            configOpen
              ? "border-border bg-secondary/30 text-foreground"
              : "border-transparent",
          )}
        >
          <Settings2 className="h-3.5 w-3.5" />
          <span>API 설정</span>
          <div className="flex-1" />
          {(!config?.apiKey || !outputFolder) && (
            <span className="text-[10px] text-destructive font-medium">
              미설정
            </span>
          )}
          {configOpen ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>

        {configOpen && (
          <div className="px-4 py-3 space-y-3 border-b border-border bg-secondary/20">
            <div>
              <FieldLabel label="API 키" />
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="API Key"
                className={INPUT_CLS}
              />
            </div>
            {/* <div>
              <FieldLabel label="출력 폴더" />
              <div className="flex gap-1.5">
                <input value={outputFolder} onChange={e => setOutputFolder(e.target.value)} placeholder="저장 경로 선택..." className={cn(INPUT_CLS, "flex-1 min-w-0")} readOnly />
                <button
                  onClick={async () => {
                    const dir = await window.dialog.selectDirectory()
                    if (dir) setOutputFolder(dir)
                  }}
                  className="shrink-0 px-2.5 rounded-lg border border-border/60 bg-secondary/60 text-muted-foreground hover:text-foreground hover:border-border transition-colors text-xs"
                >
                  찾기
                </button>
              </div>
            </div> */}
            <button
              onClick={handleSaveConfig}
              disabled={configSaving}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-primary/15 border border-primary/30 text-primary text-xs font-medium hover:bg-primary/25 transition-colors disabled:opacity-50"
            >
              <Save className="h-3 w-3" />
              {configSaving ? "저장 중..." : "저장"}
            </button>
          </div>
        )}

        {/* 파라미터 영역 */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4 space-y-5 w-full">
            {/* 모델 */}
            <div>
              <SectionHeader label="모델" />
              <Select value={model} onChange={setModel} options={MODELS} />
            </div>

            {/* 프롬프트 */}
            <div>
              <SectionHeader label="프롬프트" />
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
              <textarea
                value={promptInputMode === "prompt" ? prompt : negativePrompt}
                onChange={(e) =>
                  promptInputMode === "prompt"
                    ? setPrompt(e.target.value)
                    : setNegativePrompt(e.target.value)
                }
                placeholder={
                  promptInputMode === "prompt"
                    ? "1girl, beautiful, masterpiece, ..."
                    : "nsfw, lowres, bad anatomy, ..."
                }
                rows={8}
                className={TEXTAREA_CLS}
              />
            </div>

            {/* 캐릭터 프롬프트 */}
            <div>
              <SectionHeader
                label="캐릭터"
                action={
                  <div className="relative">
                    <button
                      onClick={() => setCharacterAddOpen((v) => !v)}
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
              {characterPrompts.length === 0 ? (
                <p className="text-xs text-muted-foreground/40 text-center py-2">
                  캐릭터 없음 — + 버튼으로 추가
                </p>
              ) : (
                <div className="space-y-2">
                  {characterPrompts.map((character, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-border/40 bg-secondary/20 p-2 space-y-2"
                    >
                      <div className="flex items-center gap-1.5">
                        <div
                          className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-secondary/30 p-1"
                          role="radiogroup"
                          aria-label={`Character ${i + 1} input mode`}
                        >
                          <button
                            type="button"
                            role="radio"
                            aria-checked={character.inputMode === "prompt"}
                            onClick={() =>
                              setCharacterPrompts((prev) =>
                                prev.map((item, idx) =>
                                  idx === i
                                    ? { ...item, inputMode: "prompt" }
                                    : item,
                                ),
                              )
                            }
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
                            aria-checked={
                              character.inputMode === "negativePrompt"
                            }
                            onClick={() =>
                              setCharacterPrompts((prev) =>
                                prev.map((item, idx) =>
                                  idx === i
                                    ? { ...item, inputMode: "negativePrompt" }
                                    : item,
                                ),
                              )
                            }
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
                          onClick={() =>
                            setCharacterPrompts((prev) =>
                              prev.filter((_, idx) => idx !== i),
                            )
                          }
                          className="shrink-0 h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <textarea
                        value={
                          character.inputMode === "prompt"
                            ? character.prompt
                            : character.negativePrompt
                        }
                        onChange={(e) =>
                          setCharacterPrompts((prev) =>
                            prev.map((item, idx) => {
                              if (idx !== i) return item;
                              return item.inputMode === "prompt"
                                ? { ...item, prompt: e.target.value }
                                : { ...item, negativePrompt: e.target.value };
                            }),
                          )
                        }
                        placeholder={
                          character.inputMode === "prompt"
                            ? `캐릭터 ${i + 1} 프롬프트`
                            : `캐릭터 ${i + 1} 네거티브 프롬프트`
                        }
                        rows={4}
                        className={cn(TEXTAREA_CLS, "min-w-0")}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Image2Image */}
            {i2iRef && (
              <div>
                <SectionHeader label="Image2Image" />
                <RefCard
                  previewUrl={i2iRef.previewUrl}
                  onRemove={() => {
                    if (i2iRef.isObjectUrl)
                      URL.revokeObjectURL(i2iRef.previewUrl);
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
                        onChange={(v) =>
                          setI2iRef((p) => (p ? { ...p, strength: v } : p))
                        }
                      />
                    </div>
                    <div>
                      <FieldLabel
                        label="Noise"
                        value={i2iRef.noise.toFixed(2)}
                      />
                      <Slider
                        min={0}
                        max={0.99}
                        step={0.01}
                        value={i2iRef.noise}
                        onChange={(v) =>
                          setI2iRef((p) => (p ? { ...p, noise: v } : p))
                        }
                      />
                    </div>
                  </div>
                </RefCard>
              </div>
            )}

            {/* Vibe Transfer */}
            {vibes.length > 0 && (
              <div>
                <SectionHeader label="Vibe Transfer" />
                <div className="space-y-2">
                  {vibes.map((vibe) => (
                    <RefCard
                      key={vibe.id}
                      previewUrl={vibe.previewUrl}
                      onRemove={() => {
                        if (vibe.isObjectUrl)
                          URL.revokeObjectURL(vibe.previewUrl);
                        setVibes((prev) =>
                          prev.filter((v) => v.id !== vibe.id),
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
                            onChange={(v) =>
                              setVibes((prev) =>
                                prev.map((x) =>
                                  x.id === vibe.id
                                    ? { ...x, infoExtracted: v }
                                    : x,
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
                            onChange={(v) =>
                              setVibes((prev) =>
                                prev.map((x) =>
                                  x.id === vibe.id ? { ...x, strength: v } : x,
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

            {/* Precise Reference */}
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
                      onChange={(v) =>
                        setPreciseRef((p) => (p ? { ...p, fidelity: v } : p))
                      }
                    />
                  </div>
                </RefCard>
              </div>
            )}

            {/* 크기 */}
            <div>
              <SectionHeader label="크기" />
              <div className="flex gap-1.5">
                {SIZE_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => {
                      setWidth(p.width);
                      setHeight(p.height);
                    }}
                    className={cn(
                      "flex-1 py-1.5 text-xs rounded-lg border transition-colors",
                      selectedPreset?.label === p.label
                        ? "bg-primary/20 text-primary border-primary/50 font-medium"
                        : "bg-secondary/60 text-muted-foreground border-border/60 hover:text-foreground hover:border-border",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="number"
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                  className={cn(
                    INPUT_CLS,
                    "flex-1 min-w-0 font-mono text-center",
                  )}
                />
                <span className="text-muted-foreground/50 text-xs shrink-0">
                  ×
                </span>
                <input
                  type="number"
                  value={height}
                  onChange={(e) => setHeight(Number(e.target.value))}
                  className={cn(
                    INPUT_CLS,
                    "flex-1 min-w-0 font-mono text-center",
                  )}
                />
              </div>
            </div>

            {/* 파라미터 */}
            <div>
              <SectionHeader label="파라미터" />
              <div className="space-y-3.5">
                <div>
                  <FieldLabel label="Steps" value={steps} />
                  <Slider min={1} max={50} value={steps} onChange={setSteps} />
                </div>
                <div>
                  <FieldLabel label="CFG Scale" value={scale.toFixed(1)} />
                  <Slider
                    min={1}
                    max={10}
                    step={0.1}
                    value={scale}
                    onChange={setScale}
                  />
                </div>
              </div>
            </div>

            {/* 샘플링 */}
            <div>
              <SectionHeader label="샘플링" />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <FieldLabel label="샘플러" />
                  <Select
                    value={sampler}
                    onChange={setSampler}
                    options={SAMPLERS.map((s) => ({ value: s, label: s }))}
                  />
                </div>
                <div>
                  <FieldLabel label="노이즈" />
                  <Select
                    value={noiseSchedule}
                    onChange={setNoiseSchedule}
                    options={NOISE_SCHEDULES.map((n) => ({
                      value: n,
                      label: n,
                    }))}
                  />
                </div>
              </div>
            </div>

            {/* 시드 */}
            <div>
              <SectionHeader label="시드" />
              <div className="flex gap-1.5">
                <input
                  type="number"
                  value={seedInput}
                  onChange={(e) => setSeedInput(e.target.value)}
                  placeholder="랜덤"
                  className={cn(INPUT_CLS, "flex-1 min-w-0 font-mono")}
                />
                <button
                  onClick={() => setSeedInput("")}
                  title="랜덤 시드"
                  className="shrink-0 px-2.5 rounded-lg border border-border/60 bg-secondary/60 text-muted-foreground hover:text-foreground hover:border-border transition-colors"
                >
                  <Shuffle className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </ScrollArea>

        {/* 생성 버튼 */}
        <div className="p-3 border-t border-border bg-sidebar">
          <button
            onClick={handleGenerate}
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
            {generating ? "생성 중..." : "생성하기"}
          </button>
          {(!config?.apiKey || !outputFolder) && !configOpen && (
            <p className="text-[10px] text-muted-foreground/50 text-center mt-1.5">
              API 설정을 먼저 완료해 주세요
            </p>
          )}
        </div>
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleResizeStart}
        className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors"
      />

      {/* Right panel */}
      <div
        className="flex-1 flex flex-col items-center justify-center overflow-hidden relative"
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Grid bg */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(var(--color-border) 1px, transparent 1px), linear-gradient(90deg, var(--color-border) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />

        {/* Drag overlay */}
        {dragOver && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-primary/5 border-2 border-dashed border-primary/40 rounded-none transition-all">
            <div className="h-14 w-14 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center mb-3">
              <ImagePlus className="h-7 w-7 text-primary/70" />
            </div>
            <p className="text-sm font-medium text-primary/70">
              이미지를 놓아주세요
            </p>
          </div>
        )}

        {/* Main content */}
        <div className="relative z-10 flex flex-col items-center justify-center w-full h-full">
          {generating ? (
            <div className="flex flex-col items-center gap-4">
              <div className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Loader2 className="h-7 w-7 text-primary animate-spin" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">생성 중</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  잠시 기다려 주세요...
                </p>
              </div>
            </div>
          ) : error ? (
            <div className="max-w-sm w-full mx-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-center">
              <p className="text-sm font-medium text-destructive mb-1.5">
                생성 실패
              </p>
              <p className="text-xs text-muted-foreground break-all leading-relaxed">
                {error}
              </p>
            </div>
          ) : resultSrc ? (
            <img
              src={resultSrc}
              alt="생성 결과"
              className="max-w-full max-h-full object-contain rounded-sm"
            />
          ) : (
            <div className="flex flex-col items-center gap-3 select-none">
              <div className="h-16 w-16 rounded-2xl bg-secondary/50 border border-border/30 flex items-center justify-center">
                <Wand2 className="h-7 w-7 text-muted-foreground/30" />
              </div>
              <p className="text-xs text-muted-foreground/40">
                프롬프트를 입력하거나 이미지를 드롭하세요
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Drop modal */}
      {dropItem && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/60 backdrop-blur-sm">
          <div className="w-100 rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  이미지 작업
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-70">
                  {dropItem.name}
                </p>
              </div>
              <button
                onClick={() => setDropItem(null)}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Image preview */}
            {previewUrl && (
              <div
                className="bg-secondary/20 flex items-center justify-center"
                style={{ maxHeight: 220 }}
              >
                <img
                  src={previewUrl}
                  alt="미리보기"
                  className="max-w-full object-contain"
                  style={{ maxHeight: 220 }}
                />
              </div>
            )}

            {/* Action buttons */}
            <div className="px-5 py-4 border-b border-border/50">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-3">
                작업 선택
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    {
                      icon: ImagePlus,
                      label: "Image2Image",
                      action: handleSetI2i,
                      key: "i2i",
                      disabled: false,
                    },
                    {
                      icon: Sparkles,
                      label: "Vibe Transfer",
                      action: handleAddVibe,
                      key: "vibe",
                      disabled: vibeDisabled,
                    },
                    {
                      icon: Crosshair,
                      label: "Precise Ref",
                      action: handleSetPreciseRef,
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
                        비활성
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {vibeDisabled && (
                <p className="text-[10px] text-muted-foreground/50 mt-2">
                  Precise Reference 사용 중 — Vibe Transfer 비활성
                </p>
              )}
              {preciseDisabled && (
                <p className="text-[10px] text-muted-foreground/50 mt-2">
                  Vibe Transfer 사용 중 — Precise Reference 비활성
                </p>
              )}
            </div>

            {/* Import metadata */}
            <div className="px-5 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-3">
                메타데이터 가져오기
              </p>
              <div className="grid grid-cols-2 gap-y-2.5 gap-x-4 mb-4">
                <Checkbox
                  checked={importChecks.prompt}
                  onChange={() => toggleCheck("prompt")}
                  label="Prompt"
                />
                <Checkbox
                  checked={importChecks.negativePrompt}
                  onChange={() => toggleCheck("negativePrompt")}
                  label="Negative Prompt"
                />
                <Checkbox
                  checked={importChecks.characters}
                  onChange={() => toggleCheck("characters")}
                  label="Characters"
                />
                <Checkbox
                  checked={importChecks.charactersAppend}
                  onChange={() => toggleCheck("charactersAppend")}
                  label="Append"
                  disabled={!importChecks.characters}
                />
                <Checkbox
                  checked={importChecks.settings}
                  onChange={() => toggleCheck("settings")}
                  label="Settings"
                />
                <Checkbox
                  checked={importChecks.seed}
                  onChange={() => toggleCheck("seed")}
                  label="Seed"
                />
              </div>
              {importError && (
                <p className="text-xs text-destructive mb-3 bg-destructive/5 border border-destructive/20 rounded-lg px-3 py-2">
                  {importError}
                </p>
              )}
              <button
                onClick={handleImportMetadata}
                disabled={
                  importing || Object.values(importChecks).every((v) => !v)
                }
                className="w-full h-9 flex items-center justify-center gap-2 rounded-lg bg-primary/15 border border-primary/30 text-primary text-sm font-medium hover:bg-primary/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {importing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                {importing ? "가져오는 중..." : "메타데이터 가져오기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
