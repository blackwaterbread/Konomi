import { useState, useCallback, useEffect } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { parsePromptTokens, isGroupRef, type PromptToken } from "@/lib/token";
import type { ImageData } from "./image-card";
import { TokenContainer } from "./token-container";

type SimilarityReason = "visual" | "prompt" | "both";

function SimilarThumb({
  img,
  isCurrent,
  reason,
  onClick,
}: {
  img: ImageData;
  isCurrent: boolean;
  reason?: SimilarityReason;
  onClick: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <button
      className={cn(
        "relative w-full aspect-square rounded-md overflow-hidden ring-2 transition-all block",
        isCurrent
          ? "ring-primary cursor-default"
          : "ring-transparent hover:ring-primary/50 dark:hover:ring-white/40 cursor-pointer",
      )}
      onClick={onClick}
    >
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60 dark:bg-white/5">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/60 dark:text-white/30" />
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
      {!isCurrent && reason && (
        <span
          className={cn(
            "absolute left-1 top-1 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
            reason === "both"
              ? "bg-amber-500/90 text-black"
              : reason === "visual"
                ? "bg-sky-500/90 text-white"
                : "bg-emerald-500/90 text-white",
          )}
        >
          {reason === "both" ? "B" : reason === "visual" ? "V" : "P"}
        </span>
      )}
    </button>
  );
}

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
  onSimilarImageClick,
  similarPageSize = 10,
}: ImageDetailProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [fitMode, setFitMode] = useState<"fit" | "actual">("fit");
  const [imgLoaded, setImgLoaded] = useState(false);
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);
  const [similarPage, setSimilarPage] = useState(0);

  // Reset displaySrc so the panel paints before fetching starts
  useEffect(() => {
    setDisplaySrc(null);
    setImgLoaded(false);
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
  }, [image?.src]);

  // Reset similar images page when image changes
  useEffect(() => {
    setSimilarPage(0);
  }, [image?.id]);

  const handleCopy = useCallback(
    (key: string, text: string) => {
      onCopyPrompt(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    },
    [onCopyPrompt],
  );

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

  const hasSimilar = similarImages && similarImages.length > 1;
  const totalPages = hasSimilar
    ? Math.ceil(similarImages.length / similarPageSize)
    : 0;
  const pagedSimilar = hasSimilar
    ? similarImages.slice(
        similarPage * similarPageSize,
        (similarPage + 1) * similarPageSize,
      )
    : [];
  const hasSeed = Number.isFinite(image.seed);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 bg-background/95 dark:bg-black/95 flex flex-col",
        !isOpen && "hidden",
      )}
    >
      {/* Top Bar */}
      <div className="relative flex items-center justify-between px-5 py-2.5 shrink-0 border-b border-border/60 dark:border-white/10 bg-background/70 dark:bg-transparent">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 text-muted-foreground hover:text-foreground dark:text-white/60 dark:hover:text-white",
              image.isFavorite &&
                "text-red-500 hover:text-red-400 dark:text-red-400 dark:hover:text-red-300",
            )}
            onClick={() => onToggleFavorite(image.id)}
          >
            <Heart
              className={cn(
                "h-4 w-4 mr-1.5",
                image.isFavorite && "fill-red-400",
              )}
            />
            {image.isFavorite ? "즐겨찾기 해제" : "즐겨찾기"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-muted-foreground hover:text-foreground dark:text-white/60 dark:hover:text-white"
            onClick={() => handleCopy("prompt", image.prompt)}
          >
            {copiedKey === "prompt" ? (
              <Check className="h-4 w-4 mr-1.5 text-green-400" />
            ) : (
              <Copy className="h-4 w-4 mr-1.5" />
            )}
            {copiedKey === "prompt" ? "복사됨" : "프롬프트 복사"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-muted-foreground hover:text-foreground dark:text-white/60 dark:hover:text-white"
            onClick={() => setFitMode((m) => (m === "fit" ? "actual" : "fit"))}
          >
            {fitMode === "fit" ? (
              <>
                <Maximize2 className="h-4 w-4 mr-1.5" />
                원본 크기
              </>
            ) : (
              <>
                <Minimize2 className="h-4 w-4 mr-1.5" />
                화면 맞춤
              </>
            )}
          </Button>
        </div>

        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 text-xs text-muted-foreground dark:text-white/30 pointer-events-none">
          {image.model && <span>{image.model}</span>}
          {image.model && <span>·</span>}
          <span>
            {image.width} × {image.height}
          </span>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground dark:text-white/60 dark:hover:text-white"
          onClick={onClose}
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Body: similar | image | info */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Similar Images Panel */}
        <div className="w-24 shrink-0 border-r border-border/60 dark:border-white/10 bg-card/70 dark:bg-black/40 flex flex-col">
          <p className="text-[10px] font-semibold text-muted-foreground dark:text-white/30 uppercase tracking-widest text-center pt-3 pb-1 shrink-0">
            유사 이미지
          </p>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {hasSimilar ? (
              <div className="p-2 space-y-1.5">
                {pagedSimilar.map((img) => (
                  <SimilarThumb
                    key={img.id}
                    img={img}
                    isCurrent={img.id === image.id}
                    reason={similarReasons?.[img.id]}
                    onClick={() =>
                      img.id !== image.id && onSimilarImageClick?.(img)
                    }
                  />
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground/70 dark:text-white/50 text-center px-2 pt-4">
                없음
              </p>
            )}
          </div>
          {totalPages > 1 && (
            <div className="shrink-0 flex items-center justify-between px-1.5 py-1.5 border-t border-border/60 dark:border-white/10">
              <button
                onClick={() => setSimilarPage((p) => Math.max(0, p - 1))}
                disabled={similarPage === 0}
                className="text-muted-foreground/70 hover:text-foreground dark:text-white/40 dark:hover:text-white disabled:opacity-20 transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="text-[10px] text-muted-foreground dark:text-white/30 tabular-nums">
                {similarPage + 1}/{totalPages}
              </span>
              <button
                onClick={() =>
                  setSimilarPage((p) => Math.min(totalPages - 1, p + 1))
                }
                disabled={similarPage === totalPages - 1}
                className="text-muted-foreground/70 hover:text-foreground dark:text-white/40 dark:hover:text-white disabled:opacity-20 transition-colors"
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
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/70 dark:text-white/30" />
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
              "absolute left-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-8 h-full rounded-full bg-background/75 text-muted-foreground/80 hover:bg-background hover:text-foreground dark:bg-black/40 dark:text-white/50 dark:hover:bg-black/70 dark:hover:text-white transition-colors",
              !prevImage && "opacity-0 pointer-events-none",
            )}
            onClick={onPrev}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          {/* Next button */}
          <button
            className={cn(
              "absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-8 h-full rounded-full bg-background/75 text-muted-foreground/80 hover:bg-background hover:text-foreground dark:bg-black/40 dark:text-white/50 dark:hover:bg-black/70 dark:hover:text-white transition-colors",
              !nextImage && "opacity-0 pointer-events-none",
            )}
            onClick={onNext}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        {/* Info Panel */}
        <div className="w-80 shrink-0 border-l border-border/60 dark:border-white/10 bg-card/70 dark:bg-black/40">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-3">
              {/* Prompt */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold text-muted-foreground dark:text-white/40 uppercase tracking-widest select-none">
                    Prompt
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 py-0 text-muted-foreground dark:text-white/30 hover:text-foreground dark:hover:text-white"
                    onClick={() => handleCopy("prompt", image.prompt)}
                  >
                    {copiedKey === "prompt" ? (
                      <Check className="h-3 w-3 text-green-400" />
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
                <div className="space-y-1 border-t border-border/60 dark:border-white/10 pt-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold text-muted-foreground dark:text-white/40 uppercase tracking-widest select-none">
                      Negative
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 py-0 text-muted-foreground dark:text-white/30 hover:text-foreground dark:hover:text-white"
                      onClick={() =>
                        handleCopy("negative", image.negativePrompt!)
                      }
                    >
                      {copiedKey === "negative" ? (
                        <Check className="h-3 w-3 text-green-400" />
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
                  <div
                    key={i}
                    className="space-y-1 border-t border-border/60 dark:border-white/10 pt-3"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-semibold text-muted-foreground dark:text-white/40 uppercase tracking-widest select-none">
                        Char {i + 1}
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1.5 py-0 text-muted-foreground dark:text-white/30 hover:text-foreground dark:hover:text-white"
                        onClick={() => handleCopy(`char-${i}`, cp)}
                      >
                        {copiedKey === `char-${i}` ? (
                          <Check className="h-3 w-3 text-green-400" />
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
              <div className="border-t border-border/60 dark:border-white/10 pt-3 space-y-1">
                <p className="text-[10px] font-semibold text-muted-foreground dark:text-white/40 uppercase tracking-widest">
                  Info
                </p>
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                  <span className="text-muted-foreground dark:text-white/30">
                    Model
                  </span>
                  <span className="text-foreground/80 dark:text-white/70 truncate">
                    {image.model || "—"}
                  </span>
                  <span className="text-muted-foreground dark:text-white/30">
                    Seed
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-foreground/80 dark:text-white/70 font-mono">
                      {hasSeed ? image.seed : "—"}
                    </span>
                    {hasSeed ? (
                      <button
                        className="text-muted-foreground dark:text-white/50 hover:text-foreground dark:hover:text-white transition-colors"
                        onClick={() => handleCopy("seed", String(image.seed))}
                      >
                        {copiedKey === "seed" ? (
                          <Check className="h-3 w-3 text-green-400" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground dark:text-white/30">
                    Size
                  </span>
                  <span className="text-foreground/80 dark:text-white/70 font-mono">
                    {image.width}×{image.height}
                  </span>
                  <span className="text-muted-foreground dark:text-white/30">
                    Sampler
                  </span>
                  <span className="text-foreground/80 dark:text-white/70 truncate">
                    {image.sampler || "—"}
                  </span>
                  <span className="text-muted-foreground dark:text-white/30">
                    Steps
                  </span>
                  <span className="text-foreground/80 dark:text-white/70 font-mono">
                    {image.steps || "—"}
                  </span>
                  <span className="text-muted-foreground dark:text-white/30">
                    CFG
                  </span>
                  <span className="text-foreground/80 dark:text-white/70 font-mono">
                    {image.cfgScale || "—"}
                  </span>
                  {image.cfgRescale ? (
                    <>
                      <span className="text-muted-foreground dark:text-white/30">
                        CFG Rescale
                      </span>
                      <span className="text-foreground/80 dark:text-white/70 font-mono">
                        {image.cfgRescale}
                      </span>
                    </>
                  ) : null}
                  {image.noiseSchedule ? (
                    <>
                      <span className="text-muted-foreground dark:text-white/30">
                        Noise Schedule
                      </span>
                      <span className="text-foreground/80 dark:text-white/70 truncate">
                        {image.noiseSchedule}
                      </span>
                    </>
                  ) : null}
                  {image.varietyPlus ? (
                    <>
                      <span className="text-muted-foreground dark:text-white/30">
                        Variety+
                      </span>
                      <span className="text-foreground/80 dark:text-white/70">
                        ON
                      </span>
                    </>
                  ) : null}
                  <span className="text-muted-foreground dark:text-white/30">
                    Date
                  </span>
                  <span className="text-foreground/80 dark:text-white/70">
                    {new Date(image.fileModifiedAt).toLocaleDateString("ko-KR")}
                  </span>
                  {image.pHash ? (
                    <>
                      <span className="text-muted-foreground dark:text-white/30">
                        P-Hash
                      </span>
                      <span className="text-muted-foreground/80 dark:text-white/50 font-mono truncate">
                        {image.pHash}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
