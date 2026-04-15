import { cn } from "@/lib/utils";

function formatTagSuggestionCount(count: number): string {
  return new Intl.NumberFormat().format(Math.max(0, Math.floor(count)));
}

const TAG_SUGGESTION_BUCKET_OPACITY = [0.18, 0.34, 0.52, 0.72, 0.94];

function getTagSuggestionIntensity(
  count: number,
  bucketThresholds: number[],
): number {
  if (bucketThresholds.length === 0) return 0.25;

  const normalizedCount = Math.max(0, count);
  let bucketIndex = 0;
  for (const threshold of bucketThresholds) {
    if (normalizedCount >= threshold) {
      bucketIndex += 1;
      continue;
    }
    break;
  }

  return (
    TAG_SUGGESTION_BUCKET_OPACITY[
      Math.min(bucketIndex, TAG_SUGGESTION_BUCKET_OPACITY.length - 1)
    ] ?? 0.25
  );
}

interface PromptTagSuggestionIndicatorProps {
  count: number;
  bucketThresholds: number[];
  className?: string;
}

export function PromptTagSuggestionIndicator({
  count,
  bucketThresholds,
  className,
}: PromptTagSuggestionIndicatorProps) {
  const formattedCount = formatTagSuggestionCount(count);

  return (
    <span
      className={cn("flex shrink-0 items-center justify-center", className)}
      title={`Tag frequency ${formattedCount}`}
    >
      <span className="sr-only">{`Tag frequency ${formattedCount}`}</span>
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 rounded-full bg-primary ring-1 ring-primary/15"
        style={{ opacity: getTagSuggestionIntensity(count, bucketThresholds) }}
      />
    </span>
  );
}
