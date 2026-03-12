import { memo, useEffect, useState } from "react";
import {
  Heart,
  Copy,
  ExternalLink,
  Trash2,
  Tag,
  ImagePlus,
  Loader2,
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
import { TokenContainer } from "./token-container";

export interface ImageData {
  id: string;
  path: string;
  src: string;
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
}

interface ImageCardProps {
  image: ImageData;
  viewMode?: "grid" | "compact" | "list";
  onToggleFavorite: (id: string) => void;
  onCopyPrompt: (prompt: string) => void;
  onClick: (image: ImageData) => void;
  onReveal: (path: string) => void;
  onDelete: (id: string) => void;
  onChangeCategory: (image: ImageData) => void;
  onSendToGenerator?: (image: ImageData) => void;
  onAddTagToSearch?: (tag: string) => void;
  onAddTagToGenerator?: (tag: string) => void;
  selectionMode?: boolean;
  selected?: boolean;
  onSelectChange?: (id: string, selected: boolean) => void;
}

export const ImageCard = memo(function ImageCard({
  image,
  viewMode = "grid",
  onToggleFavorite,
  onCopyPrompt,
  onClick,
  onReveal,
  onDelete,
  onChangeCategory,
  onSendToGenerator,
  selectionMode = false,
  selected = false,
  onSelectChange,
}: ImageCardProps) {
  const TOKEN_PREVIEW_LIMIT = 10;
  const [imageLoaded, setImageLoaded] = useState(false);
  const previewTokens = image.tokens.slice(0, TOKEN_PREVIEW_LIMIT);
  const hiddenTokenCount = Math.max(
    0,
    image.tokens.length - TOKEN_PREVIEW_LIMIT,
  );

  useEffect(() => {
    if (!image.src) {
      setImageLoaded(true);
      return;
    }
    setImageLoaded(false);
  }, [image.src]);

  const handleCardClick = () => {
    if (selectionMode && onSelectChange) {
      onSelectChange(image.id, !selected);
      return;
    }
    onClick(image);
  };

  const handleCheckboxChange = (checked: boolean) => {
    if (!onSelectChange) return;
    onSelectChange(image.id, checked);
  };

  const contextMenuContent = (
    <ContextMenuContent>
      <ContextMenuItem onSelect={() => onToggleFavorite(image.id)}>
        <Heart
          className={cn(
            "h-4 w-4",
            image.isFavorite ? "fill-red-500 text-red-500" : "",
          )}
        />
        {image.isFavorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => onCopyPrompt(image.prompt)}>
        <Copy className="h-4 w-4" />
        프롬프트 복사
      </ContextMenuItem>
      {onSendToGenerator && (
        <ContextMenuItem onSelect={() => onSendToGenerator(image)}>
          <ImagePlus className="h-4 w-4" />
          생성 모드로 보내기
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => onReveal(image.path)}>
        <ExternalLink className="h-4 w-4" />
        원본 보기
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => onChangeCategory(image)}>
        <Tag className="h-4 w-4" />
        카테고리 변경
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        className="text-destructive focus:text-destructive"
        onSelect={() => onDelete(image.id)}
      >
        <Trash2 className="h-4 w-4" />
        삭제
      </ContextMenuItem>
    </ContextMenuContent>
  );

  if (viewMode === "list") {
    return (
      <ContextMenu>
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
              {image.src && (
                <img
                  src={image.src}
                  alt={image.prompt || "image preview"}
                  className={cn(
                    "h-full w-full object-cover transition-opacity duration-200",
                    imageLoaded ? "opacity-100" : "opacity-0",
                  )}
                  loading="lazy"
                  onLoad={() => setImageLoaded(true)}
                  onError={() => setImageLoaded(true)}
                />
              )}
              {image.src && !imageLoaded && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/40">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
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
              {new Date(image.fileModifiedAt).toLocaleDateString("ko-KR") +
                " " +
                new Date(image.fileModifiedAt).toLocaleTimeString("ko-KR")}
            </span>
            {image.isFavorite && (
              <Heart className="h-3.5 w-3.5 fill-red-500 text-red-500 shrink-0" />
            )}
          </div>
        </ContextMenuTrigger>
        {contextMenuContent}
      </ContextMenu>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="group relative rounded-xl overflow-hidden bg-card border border-border hover:border-primary/50 transition-all duration-300 cursor-pointer"
          onClick={handleCardClick}
        >
          {/* Image */}
          <div className="aspect-[3/4] relative overflow-hidden">
            <div className="w-full h-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
              {image.src && (
                <img
                  src={image.src}
                  alt={image.prompt || "image preview"}
                  className={cn(
                    "absolute inset-0 h-full w-full object-cover transition-opacity duration-200",
                    imageLoaded ? "opacity-100" : "opacity-0",
                  )}
                  loading="lazy"
                  onLoad={() => setImageLoaded(true)}
                  onError={() => setImageLoaded(true)}
                />
              )}
              {image.src && !imageLoaded && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/40">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}
              {!image.src && (
                <span className="text-muted-foreground text-sm">
                  Image Preview
                </span>
              )}
            </div>

            {/* Hover Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/55 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              <div className="absolute bottom-0 left-0 right-0 p-4">
                <div
                  onClick={(e) => e.stopPropagation()}
                  onContextMenu={(e) => e.preventDefault()}
                  className="relative max-h-28 overflow-hidden rounded-md border border-white/15 bg-black/55 p-2 shadow-lg backdrop-blur-sm"
                >
                  <TokenContainer tokens={previewTokens} isEditable={false} />
                  {hiddenTokenCount > 0 && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end bg-gradient-to-t from-black/80 to-transparent px-2 pb-1 pt-5">
                      <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white/80">
                        외 {hiddenTokenCount}개
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Favorite Badge */}
            {image.isFavorite && (
              <div className="absolute top-3 right-3">
                <Heart className="h-5 w-5 fill-red-500 text-red-500" />
              </div>
            )}

            {selectionMode && (
              <div
                className={cn(
                  "absolute top-3 left-3 rounded-md border px-1.5 py-1 backdrop-blur-sm",
                  selected
                    ? "bg-primary/90 border-primary"
                    : "bg-background/80 border-border",
                )}
                onClick={(e) => e.stopPropagation()}
              >
                <Checkbox
                  checked={selected}
                  onCheckedChange={(checked) => handleCheckboxChange(!!checked)}
                  className={selected ? "border-primary-foreground" : ""}
                />
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-3 space-y-2 bg-card">
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
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{image.model}</span>
              <span>
                {new Date(image.fileModifiedAt).toLocaleDateString("ko-KR")}
              </span>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      {contextMenuContent}
    </ContextMenu>
  );
});
