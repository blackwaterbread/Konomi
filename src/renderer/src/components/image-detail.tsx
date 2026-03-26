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
  Pin,
  Workflow,
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
import type { ImageData } from "./image-card";
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
  onSimilarImageClick,
}: {
  img: ImageData;
  isCurrent: boolean;
  isAnchor?: boolean;
  reason?: SimilarityReason;
  score?: number;
  onSimilarImageClick?: (img: ImageData) => void;
}) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(false);

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
    <Tooltip open={isCurrent || undefined}>
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
}: {
  image: ImageData;
  copiedKey: string | null;
  fitMode: "fit" | "actual";
  onToggleFavorite: (id: string) => void;
  onCopy: (key: string, text: string) => void;
  onClose: () => void;
  onFitModeToggle: () => void;
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

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-3">
        {/* Prompt */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 select-none">
              Prompt
            </p>
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
          <TokenContainer
            tokens={image.tokens}
            isEditable={false}
            onAddTagToSearch={onAddTagToSearch}
            onAddTagToGeneration={onAddTagToGenerator}
          />
        </div>

        {/* Negative Prompt */}
        {image.negativePrompt && (
          <div className="space-y-1 border-t border-border/60 pt-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 select-none">
                Negative
              </p>
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
            <TokenContainer
              tokens={image.negativeTokens}
              isEditable={false}
              onAddTagToSearch={onAddTagToSearch}
              onAddTagToGeneration={onAddTagToGenerator}
            />
          </div>
        )}

        {/* Character Prompts */}
        {image.characterPrompts &&
          image.characterPrompts.map((cp, i) => (
            <div key={i} className="space-y-1 border-t border-border/60 pt-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 select-none">
                  Char {i + 1}
                </p>
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
              <TokenContainer
                tokens={parsePromptTokens(cp).filter(
                  (t): t is PromptToken => !isGroupRef(t),
                )}
                isEditable={false}
                onAddTagToSearch={onAddTagToSearch}
                onAddTagToGeneration={onAddTagToGenerator}
              />
            </div>
          ))}

        {/* Metadata */}
        <div className="border-t border-border/60 pt-3 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            Info
          </p>
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
        </div>
      </div>
    </ScrollArea>
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
  onPrev: () => void;
  onNext: () => void;
  similarImages?: ImageData[];
  similarReasons?: Record<string, SimilarityReason>;
  similarScores?: Record<string, number>;
  similarImagesLoading?: boolean;
  detailContentReady?: boolean;
  onSimilarImageClick?: (image: ImageData) => void;
  similarPageSize?: number;
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
  onPrev,
  onNext,
  similarImages,
  similarReasons,
  similarScores,
  similarImagesLoading = false,
  detailContentReady = true,
  onSimilarImageClick,
  similarPageSize = 10,
}: ImageDetailProps) {
  const { t } = useTranslation();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [fitMode, setFitMode] = useState<"fit" | "actual">("fit");
  const [imgLoaded, setImgLoaded] = useState(false);
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);
  const [similarPage, setSimilarPage] = useState(0);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const panelOpenedRef = useRef(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [workflowRaw, setWorkflowRaw] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [workflowLoading, setWorkflowLoading] = useState(false);

  // Defer image for InfoPanel so heavy token rendering doesn't block panel open.
  // Show a spinner while deferred value catches up (never stale data).
  const deferredImage = useDeferredValue(image);
  const infoPanelPending = isOpen && image?.id !== deferredImage?.id;

  // Lock the anchor image when the panel opens; clear when it closes
  useEffect(() => {
    if (isOpen && image?.id) {
      setAnchorId((prev) => prev ?? image.id);
    } else if (!isOpen) {
      setAnchorId(null);
    }
  }, [isOpen, image?.id]);

  const effectiveAnchorId = anchorId ?? image?.id ?? null;
  const hasSimilar = similarImages && similarImages.length > 1;
  const currentThumb = hasSimilar
    ? (similarImages.find((img) => img.id === effectiveAnchorId) ?? null)
    : null;
  const otherSimilar = hasSimilar
    ? similarImages.filter((img) => img.id !== effectiveAnchorId)
    : [];
  // Page 0: anchor takes 1 slot, so (pageSize - 1) non-anchor items.
  // Pages 1+: pageSize non-anchor items each (no anchor shown).
  const totalPages =
    otherSimilar.length > 0
      ? Math.ceil((otherSimilar.length + 1) / similarPageSize)
      : 0;

  // On first open: defer src via double RAF so the panel shell paints first.
  // On subsequent navigation (panel already open): swap src directly to avoid flickering.
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
          if (!cancelled) setDisplaySrc(image?.src ?? null);
        });
      });
      return () => {
        cancelled = true;
        cancelAnimationFrame(id);
      };
    } else {
      setDisplaySrc(image?.src ?? null);
      return;
    }
  }, [image?.src, isOpen]);

  // Reset similar images page when image changes
  useEffect(() => {
    setSimilarPage(0);
  }, [image?.id]);

  // Keep the current page valid when a refreshed similar list has fewer pages.
  useEffect(() => {
    setSimilarPage((page) => {
      if (totalPages <= 1) return 0;
      return Math.min(page, totalPages - 1);
    });
  }, [totalPages]);

  const handleCopy = useCallback(
    (key: string, text: string) => {
      onCopyPrompt(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    },
    [onCopyPrompt],
  );

  const handleFitModeToggle = useCallback(() => {
    setFitMode((m) => (m === "fit" ? "actual" : "fit"));
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

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && prevImage) onPrev();
      else if (e.key === "ArrowRight" && nextImage) onNext();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose, onPrev, onNext, prevImage, nextImage]);

  // Never fully unmount — just hide with CSS so DOM isn't recreated on every open
  if (!image) return null;

  const pagedOther =
    similarPage === 0
      ? otherSimilar.slice(0, similarPageSize - 1)
      : otherSimilar.slice(
          similarPage * similarPageSize - 1,
          (similarPage + 1) * similarPageSize - 1,
        );
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
      />

      {/* Body: similar | image | info */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Similar Images Panel */}
        <div className="flex w-24 shrink-0 flex-col border-r border-border/60 bg-card/70">
          <p className="shrink-0 pt-3 pb-1 text-center text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            {t("imageDetail.similarImages")}
          </p>
          <div className="relative flex-1 min-h-0 overflow-y-auto">
            {hasSimilar ? (
              <TooltipProvider delayDuration={300}>
                <div className="p-2 space-y-1.5">
                  {currentThumb && similarPage === 0 && (
                    <SimilarThumb
                      key={currentThumb.id}
                      img={currentThumb}
                      isCurrent={image?.id === currentThumb.id}
                      isAnchor={true}
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
                      onSimilarImageClick={onSimilarImageClick}
                    />
                  ))}
                </div>
              </TooltipProvider>
            ) : (
              !isPanelLoading &&
              !similarImagesLoading && (
                <p className="px-2 pt-4 text-center text-[10px] text-muted-foreground/70">
                  {t("common.none")}
                </p>
              )
            )}
            {(isPanelLoading || similarImagesLoading) && !hasSimilar && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground/70">
                <Loader2 className="h-4 w-4 animate-spin" />
                <p className="text-[10px]">{t("common.loading")}</p>
              </div>
            )}
          </div>
          {totalPages > 1 && (
            <div className="flex shrink-0 items-center justify-between border-t border-border/60 px-1.5 py-1.5">
              <button
                onClick={() => setSimilarPage((p) => Math.max(0, p - 1))}
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
                  setSimilarPage((p) => Math.min(totalPages - 1, p + 1))
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
                  key={image.id}
                  src={displaySrc}
                  alt=""
                  className={cn(
                    "max-w-full max-h-full object-contain rounded-lg shadow-2xl cursor-default transition-opacity duration-200",
                    imgLoaded ? "opacity-100" : "opacity-0",
                  )}
                  onClick={(e) => e.stopPropagation()}
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
              (!prevImage || image.id !== effectiveAnchorId) &&
                "opacity-0 pointer-events-none",
            )}
            onClick={onPrev}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          {/* Next button */}
          <button
            className={cn(
              "absolute right-3 top-1/2 flex h-full w-8 -translate-y-1/2 items-center justify-center rounded-full bg-background/75 text-muted-foreground/80 hover:bg-background/90 hover:text-foreground transition-colors",
              (!nextImage || image.id !== effectiveAnchorId) &&
                "opacity-0 pointer-events-none",
            )}
            onClick={onNext}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
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
    </div>
  );
}
