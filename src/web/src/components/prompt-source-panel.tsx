import { memo, useState } from "react";
import { GripVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { PromptToken } from "@/lib/token";
import { tokenToRawString } from "@/lib/token";
import type { ImageData } from "./image-card";

const DRAG_MIME = "application/x-konomi-token";

interface DraggableTokenChipProps {
  token: PromptToken;
}

function DraggableTokenChip({ token }: DraggableTokenChipProps) {
  const [dragging, setDragging] = useState(false);
  const raw = tokenToRawString(token);
  const hasWeight = Math.abs(token.weight - 1.0) > 0.001;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify(token));
        e.dataTransfer.effectAllowed = "copy";
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      className={cn(
        "inline-flex cursor-grab select-none items-center gap-1 rounded-md border border-border/60 bg-secondary px-2 py-0.5 text-xs transition-opacity active:cursor-grabbing",
        dragging && "opacity-40",
      )}
      title={raw}
    >
      <GripVertical className="h-2.5 w-2.5 shrink-0 -ml-0.5 text-muted-foreground/50" />
      <span className="max-w-35 truncate text-foreground/90">{token.text}</span>
      {hasWeight ? (
        <span className="shrink-0 text-[10px] font-mono text-primary/70">
          {token.weight.toFixed(2)}
        </span>
      ) : null}
    </div>
  );
}

interface TokenSectionProps {
  label: string;
  tokens: PromptToken[];
}

function TokenSection({ label, tokens }: TokenSectionProps) {
  if (tokens.length === 0) return null;

  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="shrink-0 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/50">
          {label}
        </span>
        <div className="h-px flex-1 bg-border/40" />
      </div>
      <div className="flex flex-wrap gap-1">
        {tokens.map((token, index) => (
          <DraggableTokenChip key={index} token={token} />
        ))}
      </div>
    </div>
  );
}

interface PromptSourcePanelProps {
  image: ImageData;
}

export const PromptSourcePanel = memo(function PromptSourcePanel({
  image,
}: PromptSourcePanelProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {image.src ? (
        <div className="shrink-0 px-3 pt-2.5 pb-2">
          <div
            className="w-full overflow-hidden rounded-md border border-border/40 bg-secondary/30"
            style={{ maxHeight: 140 }}
          >
            <img
              src={image.src}
              alt={t("promptSourcePanel.referenceImageAlt")}
              className="h-full w-full object-contain"
              style={{ maxHeight: 140 }}
            />
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-2">
        <p className="mb-2 text-[9px] text-muted-foreground/40">
          {t("promptSourcePanel.dragHint")}
        </p>
        <TokenSection
          label={t("promptSourcePanel.sections.prompt")}
          tokens={image.tokens}
        />
        <TokenSection
          label={t("promptSourcePanel.sections.negative")}
          tokens={image.negativeTokens}
        />
        {image.characterTokens.length > 0 ? (
          <TokenSection
            label={t("promptSourcePanel.sections.character")}
            tokens={image.characterTokens}
          />
        ) : null}
        {image.tokens.length === 0 &&
        image.negativeTokens.length === 0 &&
        image.characterTokens.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground/40">
            {t("promptSourcePanel.empty")}
          </p>
        ) : null}
      </div>
    </div>
  );
});
