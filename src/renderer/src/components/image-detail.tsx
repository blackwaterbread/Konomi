import {
  useState,
  useCallback,
  useEffect,
  useRef,
  memo,
  useDeferredValue,
} from "react";
import {
  X,
  Heart,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Loader2,
  ChevronDown,
  Pin,
  Search,
  Workflow,
  MonitorPlay,
  Play,
  Pause,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { parsePromptTokens, isGroupRef, type PromptToken } from "@/lib/token";
import { useLocaleFormatters } from "@/lib/formatters";
import { rowToImageData } from "@/lib/image-utils";
import type { ImageData } from "./image-card";
import type { ImageListQuery } from "@preload/index.d";
import { TokenContainer } from "./token-container";
import { ComfyWorkflowViewer } from "./comfy-workflow-viewer";
import { useTranslation } from "react-i18next";

type SimilarityReason = "visual" | "prompt" | "both";

const SimilarThumb = memo(function SimilarThumb({
  img,
  isCurrent,
  isAnchor,
  reason,
  score,
  disableTooltip,
  onSimilarImageClick,
}: {
  img: ImageData;
  isCurrent: boolean;
  isAnchor?: boolean;
  reason?: SimilarityReason;
  score?: number;
  disableTooltip?: boolean;
  onSimilarImageClick?: (img: ImageData) => void;
}) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Release decoded bitmap on unmount
  useEffect(
    () => () => {
      if (imgRef.current) imgRef.current.src = "";
    },
    [],
  );

  const thumb = (
    <button
      className={cn(
        "relative w-full aspect-square rounded-md overflow-hidden ring-2 transition-all block",
        isCurrent
          ? "ring-primary cursor-default"
          : "ring-transparent hover:ring-primary/50 cursor-pointer",
      )}
      onClick={() => !isCurrent && onSimilarImageClick?.(img)}
    >
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/70">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/70" />
        </div>
      )}
      <img
        ref={imgRef}
        src={img.src}
        alt=""
        className={cn(
          "w-full h-full object-cover transition-opacity duration-200",
          loaded ? "opacity-100" : "opacity-0",
        )}
        onLoad={() => setLoaded(true)}
      />
      {isAnchor && (
        <span className="absolute left-1 top-1 rounded border border-muted-foreground/30 bg-background/85 px-1 py-0.5 text-muted-foreground backdrop-blur-sm">
          <Pin className="h-2.5 w-2.5" />
        </span>
      )}
      {!isAnchor && reason && (
        <span
          className={cn(
            "absolute left-1 top-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide backdrop-blur-sm",
            reason === "both"
              ? "border-warning/45 bg-background/85 text-warning"
              : reason === "visual"
                ? "border-info/45 bg-background/85 text-info"
                : "border-success/45 bg-background/85 text-success",
          )}
        >
          {reason === "both" ? "B" : reason === "visual" ? "V" : "P"}
        </span>
      )}
    </button>
  );

  if (score === undefined || reason === undefined) return thumb;

  const pct = Math.round(score * 100);
  const ss = "imageDetail.similarityScore";
  const scoreLabel =
    pct >= 90
      ? t(`${ss}.veryHigh`)
      : pct >= 75
        ? t(`${ss}.high`)
        : pct >= 60
          ? t(`${ss}.medium`)
          : t(`${ss}.low`);
  const reasonLabel = t(`${ss}.${reason}`);

  return (
    <Tooltip open={(isCurrent && !disableTooltip) || undefined}>
      <TooltipTrigger asChild>{thumb}</TooltipTrigger>
      <TooltipContent
        side="right"
        className="flex flex-col gap-0.5 data-[state=closed]:!animate-none"
      >
        <span className="font-semibold">
          {scoreLabel} ({pct}%)
        </span>
        <span className="text-muted-foreground">{reasonLabel}</span>
      </TooltipContent>
    </Tooltip>
  );
});

const HeaderBar = memo(function HeaderBar({
  image,
  copiedKey,
  fitMode,
  onToggleFavorite,
  onCopy,
  onClose,
  onFitModeToggle,
  onTheaterMode,
}: {
  image: ImageData;
  copiedKey: string | null;
  fitMode: "fit" | "actual";
  onToggleFavorite: (id: string) => void;
  onCopy: (key: string, text: string) => void;
  onClose: () => void;
  onFitModeToggle: () => void;
  onTheaterMode: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="relative flex items-center justify-between border-b border-border/60 bg-background/80 px-5 py-2.5 backdrop-blur-sm shrink-0">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 text-muted-foreground hover:text-foreground",
            image.isFavorite && "text-favorite hover:text-favorite",
          )}
          onClick={() => onToggleFavorite(image.id)}
        >
          <Heart
            className={cn(
              "h-4 w-4 mr-1.5",
              image.isFavorite && "fill-favorite",
            )}
          />
          {image.isFavorite
            ? t("imageDetail.actions.removeFavorite")
            : t("imageDetail.actions.addFavorite")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-muted-foreground hover:text-foreground"
          onClick={() => onCopy("prompt", image.prompt)}
        >
          {copiedKey === "prompt" ? (
            <Check className="h-4 w-4 mr-1.5 text-success" />
          ) : (
            <Copy className="h-4 w-4 mr-1.5" />
          )}
          {copiedKey === "prompt"
            ? t("imageDetail.actions.copied")
            : t("imageDetail.actions.copyPrompt")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-muted-foreground hover:text-foreground"
          onClick={onFitModeToggle}
        >
          {fitMode === "fit" ? (
            <>
              <Maximize2 className="h-4 w-4 mr-1.5" />
              {t("imageDetail.actions.actualSize")}
            </>
          ) : (
            <>
              <Minimize2 className="h-4 w-4 mr-1.5" />
              {t("imageDetail.actions.fitToScreen")}
            </>
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-muted-foreground hover:text-foreground"
          onClick={onTheaterMode}
        >
          <MonitorPlay className="h-4 w-4 mr-1.5" />
          {t("imageDetail.actions.theaterMode")}
        </Button>
      </div>

      <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-2 text-xs text-muted-foreground/70">
        {image.model && <span>{image.model}</span>}
        {image.model && <span>·</span>}
        <span>
          {image.width} × {image.height}
        </span>
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        onClick={onClose}
      >
        <X className="h-5 w-5" />
      </Button>
    </div>
  );
});

const InfoPanel = memo(function InfoPanel({
  image,
  copiedKey,
  onCopy,
  onAddTagToSearch,
  onAddTagToGenerator,
  onViewWorkflow,
}: {
  image: ImageData;
  copiedKey: string | null;
  onCopy: (key: string, text: string) => void;
  onAddTagToSearch: (tag: string) => void;
  onAddTagToGenerator: (tag: string) => void;
  onViewWorkflow?: () => void;
}) {
  const { t } = useTranslation();
  const { formatDate } = useLocaleFormatters();
  const hasSeed = Number.isFinite(image.seed);
  const [tagFilterInput, setTagFilterInput] = useState("");
  const [tagFilter, setTagFilter] = useState("");

  type SectionKey = "prompt" | "negative" | "char" | "info";
  const STORAGE_KEY = "konomi-info-panel-collapsed";
  const [collapsed, setCollapsed] = useState<Record<SectionKey, boolean>>(
    () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
      } catch {
        /* ignore */
      }
      return { prompt: false, negative: false, char: false, info: false };
    },
  );
  const toggleSection = useCallback((key: SectionKey) => {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // Reset filter when viewing a different image
  useEffect(() => {
    setTagFilterInput("");
    setTagFilter("");
  }, [image.id]);

  // Debounce highlight filter
  useEffect(() => {
    const timer = window.setTimeout(() => setTagFilter(tagFilterInput), 150);
    return () => window.clearTimeout(timer);
  }, [tagFilterInput]);

  return (
    <div className="flex h-full flex-col">
      {/* Tag Search — pinned */}
      <div className="shrink-0 border-b border-border/40 px-4 py-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
          <input
            value={tagFilterInput}
            onChange={(e) => setTagFilterInput(e.target.value)}
            placeholder={t("imageDetail.tagSearch.placeholder")}
            className="h-7 w-full rounded border border-border/40 bg-muted/50 pl-7 pr-7 text-xs text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-primary/50"
          />
          {tagFilterInput && (
            <button
              onClick={() => setTagFilterInput("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
      <div className="p-4 space-y-3">
        {/* Prompt */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => toggleSection("prompt")}
              className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 select-none hover:text-muted-foreground transition-colors"
            >
              <ChevronDown className={cn("h-3 w-3 transition-transform", collapsed.prompt && "-rotate-90")} />
              Prompt
            </button>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 py-0 text-muted-foreground hover:text-foreground"
              onClick={() => onCopy("prompt", image.prompt)}
            >
              {copiedKey === "prompt" ? (
                <Check className="h-3 w-3 text-success" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
          </div>
          {!collapsed.prompt && (
            <TokenContainer
              tokens={image.tokens}
              isEditable={false}
              onAddTagToSearch={onAddTagToSearch}
              onAddTagToGeneration={onAddTagToGenerator}
              highlightFilter={tagFilter}
            />
          )}
        </div>

        {/* Negative Prompt */}
        {image.negativePrompt && (
          <div className="space-y-1 border-t border-border/60 pt-3">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => toggleSection("negative")}
                className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 select-none hover:text-muted-foreground transition-colors"
              >
                <ChevronDown className={cn("h-3 w-3 transition-transform", collapsed.negative && "-rotate-90")} />
                Negative
              </button>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 py-0 text-muted-foreground hover:text-foreground"
                onClick={() => onCopy("negative", image.negativePrompt!)}
              >
                {copiedKey === "negative" ? (
                  <Check className="h-3 w-3 text-success" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </div>
            {!collapsed.negative && (
              <TokenContainer
                tokens={image.negativeTokens}
                isEditable={false}
                onAddTagToSearch={onAddTagToSearch}
                onAddTagToGeneration={onAddTagToGenerator}
                highlightFilter={tagFilter}
              />
            )}
          </div>
        )}

        {/* Character Prompts */}
        {image.characterPrompts &&
          image.characterPrompts.map((cp, i) => (
            <div key={i} className="space-y-1 border-t border-border/60 pt-3">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => toggleSection("char")}
                  className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 select-none hover:text-muted-foreground transition-colors"
                >
                  <ChevronDown className={cn("h-3 w-3 transition-transform", collapsed.char && "-rotate-90")} />
                  Char {i + 1}
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 py-0 text-muted-foreground hover:text-foreground"
                  onClick={() => onCopy(`char-${i}`, cp)}
                >
                  {copiedKey === `char-${i}` ? (
                    <Check className="h-3 w-3 text-success" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
              {!collapsed.char && (
                <TokenContainer
                  tokens={parsePromptTokens(cp).filter(
                    (t): t is PromptToken => !isGroupRef(t),
                  )}
                  isEditable={false}
                  onAddTagToSearch={onAddTagToSearch}
                  onAddTagToGeneration={onAddTagToGenerator}
                  highlightFilter={tagFilter}
                />
              )}
            </div>
          ))}

        {/* Metadata */}
        <div className="border-t border-border/60 pt-3 space-y-1">
          <button
            type="button"
            onClick={() => toggleSection("info")}
            className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 select-none hover:text-muted-foreground transition-colors"
          >
            <ChevronDown className={cn("h-3 w-3 transition-transform", collapsed.info && "-rotate-90")} />
            Info
          </button>
          {!collapsed.info && (<>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <span className="text-muted-foreground/70">
              {t("imageDetail.info.model")}
            </span>
            <span className="text-foreground/80 truncate">
              {image.model || t("imageDetail.info.unavailable")}
            </span>
            <span className="text-muted-foreground/70">
              {t("imageDetail.info.seed")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="font-mono text-foreground/80">
                {hasSeed ? image.seed : t("imageDetail.info.unavailable")}
              </span>
              {hasSeed ? (
                <button
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => onCopy("seed", String(image.seed))}
                >
                  {copiedKey === "seed" ? (
                    <Check className="h-3 w-3 text-success" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
              ) : null}
            </span>
            <span className="text-muted-foreground/70">
              {t("imageDetail.info.size")}
            </span>
            <span className="font-mono text-foreground/80">
              {image.width}×{image.height}
            </span>
            <span className="text-muted-foreground/70">
              {t("imageDetail.info.sampler")}
            </span>
            <span className="text-foreground/80 truncate">
              {image.sampler || t("imageDetail.info.unavailable")}
            </span>
            <span className="text-muted-foreground/70">
              {t("imageDetail.info.steps")}
            </span>
            <span className="font-mono text-foreground/80">
              {image.steps || t("imageDetail.info.unavailable")}
            </span>
            <span className="text-muted-foreground/70">
              {t("imageDetail.info.cfg")}
            </span>
            <span className="font-mono text-foreground/80">
              {image.cfgScale || t("imageDetail.info.unavailable")}
            </span>
            {image.cfgRescale ? (
              <>
                <span className="text-muted-foreground/70">
                  {t("imageDetail.info.cfgRescale")}
                </span>
                <span className="font-mono text-foreground/80">
                  {image.cfgRescale}
                </span>
              </>
            ) : null}
            {image.noiseSchedule ? (
              <>
                <span className="text-muted-foreground/70">
                  {t("imageDetail.info.noiseSchedule")}
                </span>
                <span className="text-foreground/80 truncate">
                  {image.noiseSchedule}
                </span>
              </>
            ) : null}
            {image.varietyPlus ? (
              <>
                <span className="text-muted-foreground/70">
                  {t("imageDetail.info.varietyPlus")}
                </span>
                <span className="text-foreground/80">ON</span>
              </>
            ) : null}
            <span className="text-muted-foreground/70">
              {t("imageDetail.info.date")}
            </span>
            <span className="text-foreground/80">
              {formatDate(image.fileModifiedAt)}
            </span>
            {image.pHash ? (
              <>
                <span className="text-muted-foreground/70">
                  {t("imageDetail.info.phash")}
                </span>
                <span className="font-mono text-muted-foreground/80 truncate">
                  {image.pHash}
                </span>
              </>
            ) : null}
          </div>
          {image.source === "comfyui" && onViewWorkflow && (
            <Button
              variant="secondary"
              size="sm"
              className="mt-2 w-full gap-1.5 text-xs"
              onClick={onViewWorkflow}
            >
              <Workflow className="h-3.5 w-3.5" />
              {t("imageDetail.info.viewWorkflow")}
            </Button>
          )}
          </>)}
        </div>
      </div>
    </ScrollArea>
    </div>
  );
});

/* ── Theater Mode ────────────────────────────────────────────── */

const SLIDESHOW_INTERVALS = [3, 5, 10] as const;
const ZOOM_STEP = 0.2;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;

type TheaterFitMode = "contain" | "width" | "actual";

const TheaterView = memo(function TheaterView({
  image,
  displaySrc,
  imgLoaded,
  onImgLoad,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onExit,
}: {
  image: ImageData;
  displaySrc: string | null;
  imgLoaded: boolean;
  onImgLoad: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const imgRef = useRef<HTMLImageElement>(null);

  // Header / overlay visibility
  const [headerVisible, setHeaderVisible] = useState(false);
  const [pinBars, setPinBars] = useState(false);

  // Slideshow
  const [slideshowActive, setSlideshowActive] = useState(false);
  const [slideshowInterval, setSlideshowInterval] = useState(5);
  const [slideshowProgress, setSlideshowProgress] = useState(0);
  const slideshowTimerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Fit mode & Zoom/Pan
  const [fitMode, setFitMode] = useState<TheaterFitMode>("contain");
  const [manualZoom, setManualZoom] = useState<number | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });
  const containerRef2 = useRef<HTMLDivElement>(null);

  // Reset on image change
  useEffect(() => {
    setManualZoom(null);
    setPan({ x: 0, y: 0 });
  }, [image.id]);

  const handleHeaderEnter = useCallback(() => {
    setHeaderVisible(true);
  }, []);

  const handleHeaderLeave = useCallback(() => {
    setHeaderVisible(false);
  }, []);

  // Slideshow logic
  useEffect(() => {
    if (!slideshowActive) {
      clearInterval(slideshowTimerRef.current);
      setSlideshowProgress(0);
      return;
    }

    const tickMs = 50;
    const totalMs = slideshowInterval * 1000;
    let elapsed = 0;

    slideshowTimerRef.current = setInterval(() => {
      elapsed += tickMs;
      setSlideshowProgress(elapsed / totalMs);
      if (elapsed >= totalMs) {
        elapsed = 0;
        setSlideshowProgress(0);
        if (hasNext) {
          onNext();
        } else {
          setSlideshowActive(false);
        }
      }
    }, tickMs);

    return () => clearInterval(slideshowTimerRef.current);
  }, [slideshowActive, slideshowInterval, hasNext, onNext]);

  // Reset slideshow progress on manual navigation
  useEffect(() => {
    setSlideshowProgress(0);
  }, [image.id]);

  // Keyboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onExit();
      } else if (e.key === " ") {
        e.preventDefault();
        setSlideshowActive((v) => !v);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (hasPrev) onPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (hasNext) onNext();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onExit, onPrev, onNext, hasPrev, hasNext]);

  const isScrollable = fitMode !== "contain" || manualZoom !== null;

  // Wheel zoom
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      setManualZoom((prev) => {
        const base = prev ?? 1;
        const next = base + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
        const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
        return clamped;
      });
    },
    [],
  );

  // Double-click cycles: contain → actual → width → contain
  const handleDoubleClick = useCallback(() => {
    setManualZoom(null);
    setPan({ x: 0, y: 0 });
    setFitMode((m) =>
      m === "contain" ? "actual" : m === "actual" ? "width" : "contain",
    );
  }, []);

  const handleFitModeChange = useCallback((mode: TheaterFitMode) => {
    setFitMode(mode);
    setManualZoom(null);
    setPan({ x: 0, y: 0 });
  }, []);

  // Drag to pan
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!isScrollable) return;
      isDraggingRef.current = true;
      setIsDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY };
      panStart.current = { ...pan };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [isScrollable, pan],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingRef.current) return;
      setPan({
        x: panStart.current.x + (e.clientX - dragStart.current.x),
        y: panStart.current.y + (e.clientY - dragStart.current.y),
      });
    },
    [],
  );

  const handlePointerUp = useCallback(() => {
    isDraggingRef.current = false;
    setIsDragging(false);
  }, []);

  // Bottom overlay
  const [overlayVisible, setOverlayVisible] = useState(false);
  const overlayTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleOverlayEnter = useCallback(() => {
    clearTimeout(overlayTimerRef.current);
    setOverlayVisible(true);
  }, []);

  const handleOverlayLeave = useCallback(() => {
    overlayTimerRef.current = setTimeout(() => setOverlayVisible(false), 300);
  }, []);

  useEffect(() => () => clearTimeout(overlayTimerRef.current), []);

  const fileName = image.path.split(/[\\/]/).pop() ?? "";
  const promptPreview =
    image.prompt.length > 120
      ? image.prompt.slice(0, 120) + "…"
      : image.prompt;

  return (
    <div
      className="fixed inset-0 z-60 flex flex-col bg-black select-none"
    >
      {/* Header hover trigger zone + header bar */}
      <div
        className="absolute top-0 left-0 right-0 z-10"
        onMouseEnter={pinBars ? undefined : handleHeaderEnter}
        onMouseLeave={pinBars ? undefined : handleHeaderLeave}
      >
        <div
          className={cn(
            "flex items-center justify-between px-5 py-2.5 bg-black/60 backdrop-blur-sm transition-all duration-300",
            headerVisible || pinBars
              ? "opacity-100 translate-y-0"
              : "opacity-0 -translate-y-full pointer-events-none",
          )}
        >
        <div className="flex items-center gap-3">
          {/* Slideshow toggle */}
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 text-white/70 hover:text-white hover:bg-white/10",
              slideshowActive && "text-white bg-white/15",
            )}
            onClick={() => setSlideshowActive((v) => !v)}
          >
            {slideshowActive ? (
              <Pause className="h-4 w-4 mr-1.5" />
            ) : (
              <Play className="h-4 w-4 mr-1.5" />
            )}
            {t("imageDetail.theater.slideshow")}
          </Button>

          {/* Interval selector */}
          <div className="flex items-center gap-1">
            {SLIDESHOW_INTERVALS.map((n) => (
              <button
                key={n}
                className={cn(
                  "rounded px-2 py-0.5 text-xs transition-colors",
                  slideshowInterval === n
                    ? "bg-white/20 text-white"
                    : "text-white/50 hover:text-white/80 hover:bg-white/10",
                )}
                onClick={() => setSlideshowInterval(n)}
              >
                {t("imageDetail.theater.seconds", { n })}
              </button>
            ))}
          </div>

          <div className="mx-2 h-4 w-px bg-white/20" />

          {/* Fit mode selector */}
          <div className="flex items-center gap-1">
            {(["contain", "width", "actual"] as const).map((mode) => (
              <button
                key={mode}
                className={cn(
                  "rounded px-2 py-0.5 text-xs transition-colors",
                  fitMode === mode && manualZoom === null
                    ? "bg-white/20 text-white"
                    : "text-white/50 hover:text-white/80 hover:bg-white/10",
                )}
                onClick={() => handleFitModeChange(mode)}
              >
                {t(`imageDetail.theater.fit.${mode}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-2 text-xs text-white/50">
          {image.model && <span>{image.model}</span>}
          {image.model && <span>·</span>}
          <span>
            {image.width} × {image.height}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            className={cn(
              "flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors",
              pinBars
                ? "bg-white/20 text-white"
                : "text-white/50 hover:text-white/80 hover:bg-white/10",
            )}
            onClick={() => setPinBars((v) => !v)}
          >
            <Pin className="h-3 w-3" />
            {t("imageDetail.theater.pinBars")}
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10"
            onClick={onExit}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
        </div>
      </div>

      {/* Image area */}
      <div
        ref={containerRef2}
        className={cn(
          "flex-1 min-h-0 flex items-center justify-center",
          isScrollable ? "overflow-auto" : "overflow-hidden",
        )}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{ cursor: isScrollable ? (isDragging ? "grabbing" : "grab") : "default" }}
      >
        {!imgLoaded && displaySrc && (
          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <Loader2 className="h-8 w-8 animate-spin text-white/50" />
          </div>
        )}
        {displaySrc && (
          <img
            ref={imgRef}
            src={displaySrc}
            alt=""
            className={cn(
              "transition-opacity duration-200",
              imgLoaded ? "opacity-100" : "opacity-0",
              fitMode === "contain" && manualZoom === null && "max-w-full max-h-full object-contain",
              fitMode === "width" && manualZoom === null && "w-full h-auto",
            )}
            style={{
              ...(manualZoom !== null
                ? {
                    width: image.width * manualZoom,
                    height: image.height * manualZoom,
                    maxWidth: "none",
                    maxHeight: "none",
                    flexShrink: 0,
                  }
                : fitMode === "actual"
                  ? {
                      width: image.width,
                      height: image.height,
                      maxWidth: "none",
                      maxHeight: "none",
                      flexShrink: 0,
                    }
                  : {}),
              transform: `translate(${pan.x}px, ${pan.y}px)`,
              transition: isDragging ? "none" : "transform 150ms ease-out",
            }}
            draggable={false}
            onLoad={onImgLoad}
          />
        )}
      </div>

      {/* Prev / Next arrows */}
      <button
        className={cn(
          "absolute left-3 top-1/2 flex h-full w-8 -translate-y-1/2 items-center justify-center text-white/40 hover:text-white/80 transition-colors",
          !hasPrev && "opacity-0 pointer-events-none",
        )}
        onClick={onPrev}
      >
        <ChevronLeft className="h-6 w-6" />
      </button>
      <button
        className={cn(
          "absolute right-3 top-1/2 flex h-full w-8 -translate-y-1/2 items-center justify-center text-white/40 hover:text-white/80 transition-colors",
          !hasNext && "opacity-0 pointer-events-none",
        )}
        onClick={onNext}
      >
        <ChevronRight className="h-6 w-6" />
      </button>

      {/* Slideshow progress bar */}
      {slideshowActive && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/10">
          <div
            className="h-full bg-white/50 transition-none"
            style={{ width: `${slideshowProgress * 100}%` }}
          />
        </div>
      )}

      {/* Bottom overlay — hover trigger zone */}
      <div
        className="absolute bottom-0 left-0 right-0 h-16"
        onMouseEnter={pinBars ? undefined : handleOverlayEnter}
        onMouseLeave={pinBars ? undefined : handleOverlayLeave}
      >
        <div
          className={cn(
            "absolute bottom-0 left-0 right-0 px-6 py-3 bg-linear-to-t from-black/80 to-transparent transition-all duration-300",
            overlayVisible || pinBars
              ? "opacity-100 translate-y-0"
              : "opacity-0 translate-y-2 pointer-events-none",
          )}
        >
          <p className="text-sm font-medium text-white/90 truncate">
            {fileName}
          </p>
          {promptPreview && (
            <p className="mt-0.5 text-xs text-white/50 truncate">
              {promptPreview}
            </p>
          )}
        </div>
      </div>
    </div>
  );
});

/* ── Filmstrip (bottom hover strip) ──────────────────────────── */

const FILMSTRIP_THUMB = 64;
const FILMSTRIP_GAP = 4;
const FILMSTRIP_HEIGHT = FILMSTRIP_THUMB + 16; // thumb + padding

const FilmstripThumb = memo(function FilmstripThumb({
  img,
  isCurrent,
  onClick,
}: {
  img: ImageData;
  isCurrent: boolean;
  onClick: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(
    () => () => {
      if (imgRef.current) imgRef.current.src = "";
    },
    [],
  );

  return (
    <button
      className={cn(
        "relative shrink-0 rounded-md overflow-hidden ring-2 transition-all",
        isCurrent
          ? "ring-primary"
          : "ring-transparent hover:ring-primary/50",
      )}
      style={{ width: FILMSTRIP_THUMB, height: FILMSTRIP_THUMB }}
      onClick={onClick}
    >
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/50" />
        </div>
      )}
      <img
        ref={imgRef}
        src={img.src}
        alt=""
        className={cn(
          "w-full h-full object-cover transition-opacity duration-150",
          loaded ? "opacity-100" : "opacity-0",
        )}
        onLoad={() => setLoaded(true)}
      />
    </button>
  );
});

const Filmstrip = memo(function Filmstrip({
  baseQuery,
  page,
  totalPages,
  currentId,
  onSelect,
}: {
  baseQuery: Omit<ImageListQuery, "page">;
  page: number;
  totalPages: number;
  currentId: string | null;
  onSelect: (img: ImageData) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [images, setImages] = useState<ImageData[]>([]);
  const fetchKeyRef = useRef("");
  const fetchIdRef = useRef(0);

  // Stable query key for deduplication
  const queryKey = JSON.stringify(baseQuery) + `:${page}:${totalPages}`;

  // Fetch prev + current + next pages
  useEffect(() => {
    if (queryKey === fetchKeyRef.current) return;
    fetchKeyRef.current = queryKey;
    const id = ++fetchIdRef.current;

    const pagesToFetch: number[] = [];
    if (page > 1) pagesToFetch.push(page - 1);
    pagesToFetch.push(page);
    if (page < totalPages) pagesToFetch.push(page + 1);

    Promise.all(
      pagesToFetch.map((p) =>
        window.image.listPage({ ...baseQuery, page: p }),
      ),
    ).then((results) => {
      if (id !== fetchIdRef.current) return;
      setImages(results.flatMap((r) => r.rows.map(rowToImageData)));
    });
  }, [queryKey, baseQuery, page, totalPages]);

  // Scroll current image into center
  useEffect(() => {
    if (!currentId) return;
    const el = scrollRef.current;
    if (!el) return;
    const idx = images.findIndex((img) => img.id === currentId);
    if (idx < 0) return;
    const itemLeft = idx * (FILMSTRIP_THUMB + FILMSTRIP_GAP);
    const center = itemLeft + FILMSTRIP_THUMB / 2;
    el.scrollLeft = center - el.clientWidth / 2;
  }, [currentId, images]);

  // Wheel → horizontal scroll
  const handleWheel = useCallback((e: React.WheelEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    e.stopPropagation();
    el.scrollLeft += e.deltaY !== 0 ? e.deltaY : e.deltaX;
  }, []);

  const hasImages = images.length > 0;

  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-20"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Hint line — always visible */}
      <div
        className={cn(
          "mx-auto transition-all duration-300",
          hovered || !hasImages
            ? "w-0 h-0 opacity-0"
            : "w-24 h-0.5 mb-2 rounded-full bg-foreground/20 opacity-100",
        )}
      />

      {/* Filmstrip panel */}
      <div
        className={cn(
          "transition-all duration-200 ease-out",
          hovered && hasImages
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-full pointer-events-none",
        )}
        style={{ height: FILMSTRIP_HEIGHT }}
      >
        <div className="relative h-full bg-background/80 backdrop-blur-md border-t border-border/40">
          {/* Left/right fade gradients */}
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-20 bg-gradient-to-r from-background/80 to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-20 bg-gradient-to-l from-background/80 to-transparent" />

          <div
            ref={scrollRef}
            className="h-full overflow-x-auto overflow-y-hidden flex items-center gap-1"
            style={{ scrollbarWidth: "none" }}
            onWheel={handleWheel}
          >
            {images.map((img) => (
              <FilmstripThumb
                key={img.id}
                img={img}
                isCurrent={img.id === currentId}
                onClick={() => onSelect(img)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

interface ImageDetailProps {
  image: ImageData | null;
  isOpen: boolean;
  onClose: () => void;
  onToggleFavorite: (id: string) => void;
  onCopyPrompt: (prompt: string) => void;
  onAddTagToSearch: (tag: string) => void;
  onAddTagToGenerator: (tag: string) => void;
  prevImage: ImageData | null;
  nextImage: ImageData | null;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  filmstripBaseQuery?: Omit<ImageListQuery, "page">;
  filmstripPage?: number;
  filmstripTotalPages?: number;
  onGalleryImageSelect?: (image: ImageData) => void;
  similarImages?: ImageData[];
  similarReasons?: Record<string, SimilarityReason>;
  similarScores?: Record<string, number>;
  similarImagesLoading?: boolean;
  detailContentReady?: boolean;
  onSimilarImageClick?: (image: ImageData) => void;
  similarPage?: number;
  similarTotalPages?: number;
  onSimilarPageChange?: (page: number) => void;
  onAnchorChange?: (anchorId: string | null) => void;
}

export function ImageDetail({
  image,
  isOpen,
  onClose,
  onToggleFavorite,
  onCopyPrompt,
  onAddTagToSearch,
  onAddTagToGenerator,
  prevImage,
  nextImage,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  similarImages,
  similarReasons,
  similarScores,
  similarImagesLoading = false,
  detailContentReady = true,
  onSimilarImageClick,
  similarPage = 0,
  similarTotalPages = 0,
  onSimilarPageChange,
  filmstripBaseQuery,
  filmstripPage = 1,
  filmstripTotalPages = 1,
  onGalleryImageSelect,
  onAnchorChange,
}: ImageDetailProps) {
  const { t } = useTranslation();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [fitMode, setFitMode] = useState<"fit" | "actual">("fit");
  const [imgLoaded, setImgLoaded] = useState(false);
  const [theaterMode, setTheaterMode] = useState(false);
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);
  // similarPage state is now managed by useSimilarImages hook via onSimilarPageChange
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const panelOpenedRef = useRef(false);
  const detailImgRef = useRef<HTMLImageElement>(null);

  // Release decoded bitmap on unmount
  useEffect(
    () => () => {
      if (detailImgRef.current) detailImgRef.current.src = "";
    },
    [],
  );
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [workflowRaw, setWorkflowRaw] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [workflowLoading, setWorkflowLoading] = useState(false);

  // Reset workflow dialog state when image changes
  useEffect(() => {
    setWorkflowOpen(false);
    setWorkflowRaw(null);
  }, [image?.id]);

  // Defer image for InfoPanel so heavy token rendering doesn't block panel open.
  // Show a spinner while deferred value catches up (never stale data).
  const deferredImage = useDeferredValue(image);
  const infoPanelPending = isOpen && image?.id !== deferredImage?.id;

  // Defer similar images so heavy SimilarThumb mount/unmount doesn't block
  // panel open/close transitions.
  const deferredSimilarImages = useDeferredValue(similarImages);

  // Lock the anchor image when the panel opens; clear when it closes
  useEffect(() => {
    if (isOpen && image?.id) {
      setAnchorId((prev) => prev ?? image.id);
      // Notify parent outside updater to avoid setState-during-render warning
      if (anchorId == null) onAnchorChange?.(image.id);
    } else if (!isOpen) {
      setAnchorId(null);
      onAnchorChange?.(null);
    }
  }, [isOpen, image?.id, anchorId, onAnchorChange]);

  const effectiveAnchorId = anchorId ?? image?.id ?? null;
  // similarImages already contains only the current page's data (fetched by useSimilarImages)
  const hasSimilar = deferredSimilarImages && deferredSimilarImages.length > 1;
  const currentThumb = hasSimilar
    ? (deferredSimilarImages.find((img) => img.id === effectiveAnchorId) ?? null)
    : null;
  const otherSimilar = hasSimilar
    ? deferredSimilarImages.filter((img) => img.id !== effectiveAnchorId)
    : [];
  const totalPages = similarTotalPages;

  // On first open: defer src via double RAF so the panel shell paints first.
  // On subsequent navigation (panel already open): swap src directly to avoid flickering.
  // Detail view always loads full-resolution image (not gallery thumbnail).
  const fullSrc = image?.fullSrc ?? image?.src ?? null;
  useEffect(() => {
    if (!isOpen) {
      panelOpenedRef.current = false;
      setDisplaySrc(null);
      setImgLoaded(false);
      return;
    }
    setImgLoaded(false);
    if (!panelOpenedRef.current) {
      panelOpenedRef.current = true;
      setDisplaySrc(null);
      let cancelled = false;
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!cancelled) setDisplaySrc(fullSrc);
        });
      });
      return () => {
        cancelled = true;
        cancelAnimationFrame(id);
      };
    } else {
      setDisplaySrc(fullSrc);
      return;
    }
  }, [fullSrc, isOpen]);

  // Page reset on image change and page clamping are handled by useSimilarImages hook

  const handleCopy = useCallback(
    (key: string, text: string) => {
      onCopyPrompt(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    },
    [onCopyPrompt],
  );

  // Gallery Prev/Next: update anchorId so nav buttons stay visible
  // and similar images refetch for the new image.
  // When crossing page boundaries, prevImage/nextImage are null but
  // hasPrev/hasNext are true — call onPrev/onNext to trigger page change.
  const handlePrev = useCallback(() => {
    if (!hasPrev) return;
    if (prevImage) {
      setAnchorId(prevImage.id);
      onAnchorChange?.(prevImage.id);
    }
    onPrev();
  }, [onPrev, prevImage, hasPrev, onAnchorChange]);

  const handleNext = useCallback(() => {
    if (!hasNext) return;
    if (nextImage) {
      setAnchorId(nextImage.id);
      onAnchorChange?.(nextImage.id);
    }
    onNext();
  }, [onNext, nextImage, hasNext, onAnchorChange]);

  const handleFitModeToggle = useCallback(() => {
    setFitMode((m) => (m === "fit" ? "actual" : "fit"));
  }, []);

  const handleEnterTheater = useCallback(() => {
    setTheaterMode(true);
  }, []);

  const handleExitTheater = useCallback(() => {
    setTheaterMode(false);
  }, []);

  const handleImageDoubleClick = useCallback(() => {
    setTheaterMode(true);
  }, []);

  const handleFilmstripSelect = useCallback(
    (img: ImageData) => {
      setAnchorId(img.id);
      onAnchorChange?.(img.id);
      onGalleryImageSelect?.(img);
    },
    [onAnchorChange, onGalleryImageSelect],
  );

  const handleTheaterImgLoad = useCallback(() => {
    setImgLoaded(true);
  }, []);

  const handleViewWorkflow = useCallback(async () => {
    if (!image) return;
    setWorkflowOpen(true);
    setWorkflowLoading(true);
    try {
      const meta = await window.image.readNaiMeta(image.path);
      setWorkflowRaw(meta?.raw ?? null);
    } catch {
      setWorkflowRaw(null);
    } finally {
      setWorkflowLoading(false);
    }
  }, [image]);

  // Prefetch adjacent images
  useEffect(() => {
    if (!isOpen) return;
    if (prevImage?.src) {
      const img = new Image();
      img.src = prevImage.src;
    }
    if (nextImage?.src) {
      const img = new Image();
      img.src = nextImage.src;
    }
  }, [isOpen, prevImage?.src, nextImage?.src]);

  // Never fully unmount — just hide with CSS so DOM isn't recreated on every open
  if (!image) return null;

  // otherSimilar already contains only the current page's candidates (pre-sliced by hook)
  const pagedOther = otherSimilar;
  const isPanelLoading = !detailContentReady;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 bg-background/95 flex flex-col",
        isOpen
          ? "animate-in fade-in-0 duration-150"
          : "hidden",
      )}
    >
      {/* Top Bar */}
      <HeaderBar
        image={image}
        copiedKey={copiedKey}
        fitMode={fitMode}
        onToggleFavorite={onToggleFavorite}
        onCopy={handleCopy}
        onClose={onClose}
        onFitModeToggle={handleFitModeToggle}
        onTheaterMode={handleEnterTheater}
      />

      {/* Body: similar | image | info */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Similar Images Panel */}
        <div className="flex w-24 shrink-0 flex-col border-r border-border/60 bg-card/70">
          <p className="shrink-0 pt-3 pb-1 text-center text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            {t("imageDetail.similarImages")}
          </p>
          <div className="relative flex-1 min-h-0 overflow-y-auto">
            {isPanelLoading || similarImagesLoading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground/70">
                <Loader2 className="h-4 w-4 animate-spin" />
                <p className="text-[10px]">{t("common.loading")}</p>
              </div>
            ) : hasSimilar ? (
              <TooltipProvider delayDuration={300}>
                <div className="p-2 space-y-1.5">
                  {currentThumb && similarPage === 0 && (
                    <SimilarThumb
                      key={currentThumb.id}
                      img={currentThumb}
                      isCurrent={image?.id === currentThumb.id}
                      isAnchor={true}
                      disableTooltip={theaterMode}
                      onSimilarImageClick={onSimilarImageClick}
                    />
                  )}
                  {pagedOther.map((img) => (
                    <SimilarThumb
                      key={img.id}
                      img={img}
                      isCurrent={img.id === image?.id}
                      reason={similarReasons?.[img.id]}
                      score={similarScores?.[img.id]}
                      disableTooltip={theaterMode}
                      onSimilarImageClick={onSimilarImageClick}
                    />
                  ))}
                </div>
              </TooltipProvider>
            ) : (
              <p className="px-2 pt-4 text-center text-[10px] text-muted-foreground/70">
                {t("common.none")}
              </p>
            )}
          </div>
          {totalPages > 1 && (
            <div className="flex shrink-0 items-center justify-between border-t border-border/60 px-1.5 py-1.5">
              <button
                onClick={() => onSimilarPageChange?.(Math.max(0, similarPage - 1))}
                disabled={similarPage === 0}
                className="text-muted-foreground/70 hover:text-foreground disabled:opacity-20 transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="text-[10px] text-muted-foreground/70 tabular-nums">
                {similarPage + 1}/{totalPages}
              </span>
              <button
                onClick={() =>
                  onSimilarPageChange?.(Math.min(totalPages - 1, similarPage + 1))
                }
                disabled={similarPage === totalPages - 1}
                className="text-muted-foreground/70 hover:text-foreground disabled:opacity-20 transition-colors"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Image Area */}
        <div className="relative flex-1 min-w-0 min-h-0 overflow-hidden">
          {!imgLoaded && (
            <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/70" />
            </div>
          )}
          {fitMode === "fit" ? (
            <div
              className="absolute inset-0 flex items-center justify-center p-3 cursor-pointer"
              onClick={onClose}
            >
              {displaySrc && (
                <img
                  ref={detailImgRef}
                  key={image.id}
                  src={displaySrc}
                  alt=""
                  className={cn(
                    "max-w-full max-h-full object-contain rounded-lg shadow-2xl cursor-default transition-opacity duration-200",
                    imgLoaded ? "opacity-100" : "opacity-0",
                  )}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={handleImageDoubleClick}
                  onLoad={() => setImgLoaded(true)}
                />
              )}
            </div>
          ) : (
            <ScrollArea className="h-full w-full">
              <div
                className="flex items-center justify-center p-3"
                style={{
                  minWidth: image.width + 24,
                  minHeight: image.height + 24,
                }}
              >
                {displaySrc && (
                  <img
                    ref={detailImgRef}
                    key={image.id}
                    src={displaySrc}
                    alt=""
                    className={cn(
                      "rounded-lg shadow-2xl transition-opacity duration-200",
                      imgLoaded ? "opacity-100" : "opacity-0",
                    )}
                    style={{
                      width: image.width,
                      height: image.height,
                      maxWidth: "none",
                    }}
                    onDoubleClick={handleImageDoubleClick}
                    onLoad={() => setImgLoaded(true)}
                  />
                )}
              </div>
            </ScrollArea>
          )}

          {/* Prev button */}
          <button
            className={cn(
              "absolute left-3 top-1/2 flex h-full w-8 -translate-y-1/2 items-center justify-center rounded-full bg-background/75 text-muted-foreground/80 hover:bg-background/90 hover:text-foreground transition-colors",
              (!hasPrev || image.id !== effectiveAnchorId) &&
                "opacity-0 pointer-events-none",
            )}
            onClick={handlePrev}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          {/* Next button */}
          <button
            className={cn(
              "absolute right-3 top-1/2 flex h-full w-8 -translate-y-1/2 items-center justify-center rounded-full bg-background/75 text-muted-foreground/80 hover:bg-background/90 hover:text-foreground transition-colors",
              (!hasNext || image.id !== effectiveAnchorId) &&
                "opacity-0 pointer-events-none",
            )}
            onClick={handleNext}
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          {/* Filmstrip */}
          {filmstripBaseQuery && (
            <Filmstrip
              baseQuery={filmstripBaseQuery}
              page={filmstripPage}
              totalPages={filmstripTotalPages}
              currentId={image.id}
              onSelect={handleFilmstripSelect}
            />
          )}
        </div>

        {/* Info Panel */}
        <div className="w-80 shrink-0 border-l border-border/60 bg-card/70">
          {infoPanelPending ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/70" />
            </div>
          ) : (
            <InfoPanel
              image={image}
              copiedKey={copiedKey}
              onCopy={handleCopy}
              onAddTagToSearch={onAddTagToSearch}
              onAddTagToGenerator={onAddTagToGenerator}
              onViewWorkflow={
                image.source === "comfyui" ? handleViewWorkflow : undefined
              }
            />
          )}
        </div>
      </div>

      {/* ComfyUI Workflow Dialog */}
      <Dialog open={workflowOpen} onOpenChange={setWorkflowOpen}>
        <DialogContent className="max-w-[90vw] h-[85vh] p-0 gap-0 bg-[#1e1e2e] border-[#3a3a5c] [&>button]:text-[#a0a0b8] [&>button]:hover:text-white [&>button]:top-2.5 [&>button]:right-3">
          <DialogHeader className="px-4 py-2 mb-0 border-b border-[#3a3a5c] shrink-0">
            <DialogTitle className="text-sm text-[#e0e0e0]">
              {t("imageDetail.info.viewWorkflow")}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            <ComfyWorkflowViewer
              raw={workflowRaw}
              loading={workflowLoading}
              meta={
                image
                  ? {
                      fileName: image.path.split(/[\\/]/).pop() ?? "",
                      model: image.model,
                      width: image.width,
                      height: image.height,
                      seed: image.seed,
                      sampler: image.sampler,
                      steps: image.steps,
                      cfgScale: image.cfgScale,
                    }
                  : null
              }
            />
          </div>
        </DialogContent>
      </Dialog>

      {theaterMode && image && (
        <TheaterView
          image={image}
          displaySrc={displaySrc}
          imgLoaded={imgLoaded}
          onImgLoad={handleTheaterImgLoad}
          hasPrev={hasPrev}
          hasNext={hasNext}
          onPrev={handlePrev}
          onNext={handleNext}
          onExit={handleExitTheater}
        />
      )}
    </div>
  );
}
