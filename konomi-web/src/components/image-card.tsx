import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Heart,
  Copy,
  ExternalLink,
  Trash2,
  Tag,
  ImagePlus,
  ImageOff,
  Loader2,
  RotateCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { PromptToken } from "@/lib/token";
import { useLocaleFormatters } from "@/lib/formatters";
import { TokenContainer } from "./token-container";
import { useTranslation } from "react-i18next";
import type { GalleryDensity } from "./image-gallery";

export interface ImageData {
  id: string;
  path: string;
  src: string;
  /** Full-resolution URL (no resize). Used by detail view. */
  fullSrc: string;
  prompt: string;
  negativePrompt?: string;
  characterPrompts: string[];
  tokens: PromptToken[];
  negativeTokens: PromptToken[];
  characterTokens: PromptToken[];
  category: string;
  tags: string[];
  fileModifiedAt: string;
  isFavorite: boolean;
  pHash: string;
  source: string;
  folderId: number;
  model: string;
  seed: number;
  width: number;
  height: number;
  cfgScale: number;
  cfgRescale: number;
  noiseSchedule: string;
  varietyPlus: boolean;
  sampler: string;
  steps: number;
  deleted?: boolean;
}

interface ImageCardProps {
  image: ImageData;
  viewMode?: "grid" | "list";
  density?: GalleryDensity;
  onToggleFavorite: (id: string) => void;
  onCopyPrompt: (prompt: string) => void;
  onClick: (image: ImageData) => void;
  onReveal: (path: string) => void;
  onDelete: (id: string) => void;
  onChangeCategory: (image: ImageData) => void;
  onSendToGenerator?: (image: ImageData) => void;
  onSendToSource?: (image: ImageData) => void;
  onAddTagToSearch?: (tag: string) => void;
  onAddTagToGenerator?: (tag: string) => void;
  selectionMode?: boolean;
  selected?: boolean;
  onSelectChange?: (id: string, selected: boolean) => void;
  selectedCount?: number;
  onBulkDelete?: () => void;
  onBulkCategory?: () => void;
  onRescanMetadata?: (path: string) => void;
  onBulkRescanMetadata?: () => void;
}

export const ImageCard = memo(function ImageCard({
  image,
  viewMode = "grid",
  density = "normal",
  onToggleFavorite,
  onCopyPrompt,
  onClick,
  onReveal,
  onDelete,
  onChangeCategory,
  onSendToGenerator,
  onSendToSource,
  selectionMode = false,
  selected = false,
  onSelectChange,
  selectedCount = 0,
  onBulkDelete,
  onBulkCategory,
  onRescanMetadata,
  onBulkRescanMetadata,
}: ImageCardProps) {
  const { t } = useTranslation();
  const { formatDate, formatDateTime } = useLocaleFormatters();
  const TOKEN_PREVIEW_LIMIT = density === "compact" ? 5 : density === "dense" ? 3 : 10;
  const showFooter = density === "normal" || density === "compact";
  const showHoverOverlay = density !== "micro";
  const showHoverTokens = density === "normal" || density === "compact" || density === "dense";
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageBroken, setImageBroken] = useState(false);
  const [hoverPreviewReady, setHoverPreviewReady] = useState(false);
  const [contextMenuReady, setContextMenuReady] = useState(false);
  const [favoritePopping, setFavoritePopping] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const previewTokens = useMemo(
    () => image.tokens.slice(0, TOKEN_PREVIEW_LIMIT),
    [image.tokens, TOKEN_PREVIEW_LIMIT],
  );
  const hiddenTokenCount = Math.max(
    0,
    image.tokens.length - TOKEN_PREVIEW_LIMIT,
  );

  useEffect(() => {
    if (!image.src) {
      setImageLoaded(true);
      setImageBroken(false);
      return;
    }
    setImageLoaded(false);
    setImageBroken(false);
  }, [image.src]);

  // Release decoded bitmap on unmount so Chromium doesn't retain it in memory
  useEffect(
    () => () => {
      if (imgRef.current) imgRef.current.src = "";
    },
    [],
  );

  const handleCardClick = useCallback(() => {
    if (selectionMode && onSelectChange) {
      onSelectChange(image.id, !selected);
      return;
    }
    onClick(image);
  }, [image, onClick, onSelectChange, selected, selectionMode]);

  const handleCheckboxChange = useCallback(
    (checked: boolean) => {
      if (!onSelectChange) return;
      onSelectChange(image.id, checked);
    },
    [image.id, onSelectChange],
  );

  const handleContextMenuOpenChange = useCallback((open: boolean) => {
    if (open) {
      setContextMenuReady(true);
    }
  }, []);

  const handleHoverPreviewActivate = useCallback(() => {
    setHoverPreviewReady((prev) => prev || viewMode !== "list");
  }, [viewMode]);

  const contextMenuContent = contextMenuReady ? (
    <ContextMenuContent>
      <ContextMenuItem onSelect={() => onToggleFavorite(image.id)}>
        <Heart
          className={cn(
            "h-4 w-4",
            image.isFavorite ? "fill-favorite text-favorite" : "",
          )}
        />
        {image.isFavorite
          ? t("imageCard.menu.removeFavorite")
          : t("imageCard.menu.addFavorite")}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => onCopyPrompt(image.prompt)}>
        <Copy className="h-4 w-4" />
        {t("imageCard.menu.copyPrompt")}
      </ContextMenuItem>
      {onSendToGenerator && (
        <ContextMenuItem onSelect={() => onSendToGenerator(image)}>
          <ImagePlus className="h-4 w-4" />
          {t("imageCard.menu.sendToGenerator")}
        </ContextMenuItem>
      )}
      {onSendToSource && (
        <ContextMenuItem onSelect={() => onSendToSource(image)}>
          <ImagePlus className="h-4 w-4" />
          {t("imageCard.menu.sendToSource")}
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => onReveal(image.path)}>
        <ExternalLink className="h-4 w-4" />
        {t("imageCard.menu.revealOriginal")}
      </ContextMenuItem>
      {selectionMode && selected && selectedCount > 1 && onBulkCategory ? (
        <ContextMenuItem onSelect={onBulkCategory}>
          <Tag className="h-4 w-4" />
          {t("imageCard.menu.changeCategorySelected", { count: selectedCount })}
        </ContextMenuItem>
      ) : (
        <ContextMenuItem onSelect={() => onChangeCategory(image)}>
          <Tag className="h-4 w-4" />
          {t("imageCard.menu.changeCategory")}
        </ContextMenuItem>
      )}
      {onRescanMetadata && (
        <>
          <ContextMenuSeparator />
          {selectionMode &&
          selected &&
          selectedCount > 1 &&
          onBulkRescanMetadata ? (
            <ContextMenuItem onSelect={onBulkRescanMetadata}>
              <RotateCw className="h-4 w-4" />
              {t("imageCard.menu.rescanMetadataSelected", {
                count: selectedCount,
              })}
            </ContextMenuItem>
          ) : (
            <ContextMenuItem
              onSelect={() => onRescanMetadata(image.path)}
            >
              <RotateCw className="h-4 w-4" />
              {t("imageCard.menu.rescanMetadata")}
            </ContextMenuItem>
          )}
        </>
      )}
      <ContextMenuSeparator />
      {selectionMode && selected && selectedCount > 1 && onBulkDelete ? (
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={onBulkDelete}
        >
          <Trash2 className="h-4 w-4" />
          {t("imageCard.menu.deleteSelected", { count: selectedCount })}
        </ContextMenuItem>
      ) : (
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => onDelete(image.id)}
        >
          <Trash2 className="h-4 w-4" />
          {t("imageCard.menu.delete")}
        </ContextMenuItem>
      )}
    </ContextMenuContent>
  ) : null;

  if (viewMode === "list") {
    if (image.deleted) {
      return (
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/50 border border-border opacity-60">
          <div className="relative h-12 w-12 shrink-0 rounded-md overflow-hidden bg-muted flex items-center justify-center">
            <Trash2 className="h-5 w-5 text-muted-foreground/60" />
          </div>
          <span className="text-xs text-muted-foreground italic">
            {t("imageCard.deleted")}
          </span>
        </div>
      );
    }
    return (
      <ContextMenu onOpenChange={handleContextMenuOpenChange}>
        <ContextMenuTrigger asChild>
          <div
            className="group flex items-center gap-3 px-3 py-2 rounded-lg bg-card border border-border hover:border-primary/50 transition-colors cursor-pointer"
            onClick={handleCardClick}
          >
            {selectionMode && (
              <Checkbox
                checked={selected}
                onClick={(e) => e.stopPropagation()}
                onCheckedChange={(checked) => handleCheckboxChange(!!checked)}
              />
            )}
            <div className="relative h-12 w-12 shrink-0 rounded-md overflow-hidden bg-gradient-to-br from-primary/20 to-accent/20">
              {image.src && !imageBroken && (
                <img
                  ref={imgRef}
                  src={image.src}
                  alt={image.prompt || t("imageCard.previewAlt")}
                  className={cn(
                    "h-full w-full object-cover transition-opacity duration-200",
                    imageLoaded ? "opacity-100" : "opacity-0",
                  )}
                  loading="lazy"
                  onLoad={() => setImageLoaded(true)}
                  onError={() => {
                    setImageLoaded(true);
                    setImageBroken(true);
                  }}
                />
              )}
              {image.src && !imageLoaded && !imageBroken && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/40">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
              {imageBroken && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <ImageOff className="h-5 w-5 text-muted-foreground/60" />
                </div>
              )}
            </div>
            <p className="flex-1 text-xs text-muted-foreground font-mono truncate">
              {image.prompt}
            </p>
            <span className="shrink-0 text-xs text-muted-foreground">
              {image.width}×{image.height}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground w-48 text-right">
              {image.model}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground w-48 text-right">
              {formatDateTime(image.fileModifiedAt)}
            </span>
            {image.isFavorite && (
              <Heart className="h-3.5 w-3.5 fill-favorite text-favorite shrink-0" />
            )}
          </div>
        </ContextMenuTrigger>
        {contextMenuContent}
      </ContextMenu>
    );
  }

  const isDense = density === "dense" || density === "minimal" || density === "micro";
  const isMinimalOrMicro = density === "minimal" || density === "micro";
  const isMicro = density === "micro";

  const roundedClass = isMicro
    ? "rounded-sm"
    : isMinimalOrMicro
      ? "rounded-md"
      : isDense
        ? "rounded-lg"
        : "rounded-xl";

  const aspectClass = isMinimalOrMicro ? "aspect-square" : "aspect-[3/4]";

  const favIconSize = isMicro
    ? "h-2 w-2"
    : isMinimalOrMicro
      ? "h-3 w-3"
      : isDense
        ? "h-3.5 w-3.5"
        : "h-4 w-4";

  const favButtonPadding = isMicro ? "p-0.5" : isMinimalOrMicro ? "p-1" : "p-1.5";

  if (image.deleted) {
    return (
      <div
        className={cn(
          "relative overflow-hidden bg-muted/50 border border-border opacity-60",
          roundedClass,
        )}
      >
        <div
          className={cn(
            aspectClass,
            "flex flex-col items-center justify-center gap-2 text-muted-foreground/60",
          )}
        >
          <Trash2 className={isDense ? "h-5 w-5" : "h-8 w-8"} />
          {!isMicro && (
            <span
              className={cn(
                "text-center italic",
                isDense ? "text-[10px]" : "text-xs",
              )}
            >
              {t("imageCard.deleted")}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <ContextMenu onOpenChange={handleContextMenuOpenChange}>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group relative overflow-hidden bg-card border border-border hover:border-primary/50 transition-all duration-300 cursor-pointer",
            roundedClass,
          )}
          onClick={handleCardClick}
          onPointerEnter={handleHoverPreviewActivate}
        >
          {/* Image */}
          <div className={cn(aspectClass, "relative overflow-hidden")}>
            <div className="w-full h-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
              {image.src && !imageBroken && (
                <img
                  ref={imgRef}
                  src={image.src}
                  alt={image.prompt || t("imageCard.previewAlt")}
                  className={cn(
                    "absolute inset-0 h-full w-full object-cover transition-opacity duration-200",
                    imageLoaded ? "opacity-100" : "opacity-0",
                  )}
                  loading="lazy"
                  onLoad={() => setImageLoaded(true)}
                  onError={() => {
                    setImageLoaded(true);
                    setImageBroken(true);
                  }}
                />
              )}
              {image.src && !imageLoaded && !imageBroken && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/40">
                  <Loader2 className={cn("animate-spin text-muted-foreground", isDense ? "h-4 w-4" : "h-6 w-6")} />
                </div>
              )}
              {imageBroken && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-muted-foreground/60">
                  <ImageOff className={isDense ? "h-4 w-4" : "h-8 w-8"} />
                  {!isDense && (
                    <span className="text-xs">{t("imageCard.missingImage")}</span>
                  )}
                </div>
              )}
              {!image.src && !imageBroken && !isDense && (
                <span className="text-muted-foreground text-sm">
                  {t("imageCard.emptyPreview")}
                </span>
              )}
            </div>

            {/* Hover Overlay */}
            {showHoverOverlay && (
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/55 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div className={cn("absolute bottom-0 left-0 right-0", isDense ? "p-1.5" : density === "compact" ? "p-3" : "p-4")}>
                  {showHoverTokens ? (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      onContextMenu={(e) => e.preventDefault()}
                      className={cn(
                        "relative overflow-hidden rounded-md border border-white/15 bg-black/55 shadow-lg backdrop-blur-sm",
                        isDense ? "max-h-16 p-1" : "max-h-28 p-2",
                      )}
                    >
                      {hoverPreviewReady && (
                        <TokenContainer tokens={previewTokens} isEditable={false} />
                      )}
                      {hoverPreviewReady && hiddenTokenCount > 0 && (
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end bg-gradient-to-t from-black/80 to-transparent px-2 pb-1 pt-5">
                          <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white/80">
                            {t("imageCard.moreTokens", { count: hiddenTokenCount })}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* minimal: just model + date on hover */
                    <div className="text-[10px] text-white/80 truncate text-center">
                      {image.model}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Favorite Button */}
            <button
              className={cn(
                "absolute top-2 right-2 rounded-full bg-black/40 backdrop-blur-sm transition-opacity",
                favButtonPadding,
                isMicro && "top-0.5 right-0.5",
                isMinimalOrMicro && !isMicro && "top-1 right-1",
                image.isFavorite
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100",
              )}
              onClick={(e) => {
                e.stopPropagation();
                setFavoritePopping(true);
                onToggleFavorite(image.id);
                setTimeout(() => setFavoritePopping(false), 450);
              }}
            >
              {favoritePopping && !isMicro && (
                <span
                  className="absolute inset-0 rounded-full border-2 border-favorite pointer-events-none"
                  style={{ animation: "heart-ripple 0.45s ease-out forwards" }}
                />
              )}
              <Heart
                className={cn(
                  "relative",
                  favIconSize,
                  image.isFavorite
                    ? "fill-favorite text-favorite"
                    : "text-white",
                )}
                style={
                  favoritePopping && !isMicro
                    ? {
                        animation:
                          "heart-pop 0.45s cubic-bezier(0.36, 0.07, 0.19, 0.97) forwards",
                      }
                    : undefined
                }
              />
            </button>

            {selectionMode && (
              <div
                className={cn(
                  "absolute rounded-md border backdrop-blur-sm",
                  isMicro
                    ? "top-0.5 left-0.5 px-0.5 py-0.5"
                    : isMinimalOrMicro
                      ? "top-1.5 left-1.5 px-1 py-0.5"
                      : "top-3 left-3 px-1.5 py-1",
                  selected
                    ? "bg-primary/90 border-primary"
                    : "bg-background/80 border-border",
                )}
                onClick={(e) => e.stopPropagation()}
              >
                <Checkbox
                  checked={selected}
                  onCheckedChange={(checked) => handleCheckboxChange(!!checked)}
                  className={cn(
                    selected ? "border-primary-foreground" : "",
                    isMicro && "h-3 w-3",
                  )}
                />
              </div>
            )}
          </div>

          {/* Footer */}
          {showFooter && (
            <div className={cn("bg-card", density === "compact" ? "p-2 space-y-1" : "p-3 space-y-2")}>
              {density === "normal" && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant="secondary"
                    className="text-xs bg-secondary text-secondary-foreground"
                  >
                    {image.category}
                  </Badge>
                  {image.tags.slice(0, 2).map((tag) => (
                    <Badge
                      key={tag}
                      variant="outline"
                      className="text-xs border-border text-muted-foreground"
                    >
                      {tag}
                    </Badge>
                  ))}
                  {image.tags.length > 2 && (
                    <span className="text-xs text-muted-foreground">
                      +{image.tags.length - 2}
                    </span>
                  )}
                </div>
              )}
              <div className={cn(
                "flex items-center justify-between text-muted-foreground",
                density === "compact" ? "text-[10px]" : "text-xs",
              )}>
                <span className="truncate">{image.model}</span>
                <span className="shrink-0">{formatDate(image.fileModifiedAt)}</span>
              </div>
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      {contextMenuContent}
    </ContextMenu>
  );
});
