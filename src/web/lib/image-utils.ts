import type { ImageData } from "@/components/image-card";
import type { PromptToken } from "@/lib/token";
import type { ImageRow } from "@preload/index.d";

export function parseTokens(json: string | undefined): PromptToken[] {
  try {
    const parsed = JSON.parse(json ?? "[]");
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    if (typeof parsed[0] === "string")
      return (parsed as string[]).map((text) => ({ text, weight: 1 }));
    return parsed as PromptToken[];
  } catch {
    return [];
  }
}

const GALLERY_THUMB_WIDTH = 400;

const THUMB_WIDTH_MAP: Record<"low" | "normal" | "high", number> = {
  low: 200,
  normal: 400,
  high: 800,
};

export function thumbWidthForQuality(
  quality: "low" | "normal" | "high",
): number {
  return THUMB_WIDTH_MAP[quality];
}

function isElectronEnv(): boolean {
  return (
    typeof window !== "undefined" && window.appInfo?.isElectron === true
  );
}

/** Build an image URL for an arbitrary path. Electron uses the konomi:// protocol; browser uses the server file API. */
export function imageUrl(filePath: string, thumbWidth?: number): string {
  if (isElectronEnv()) {
    const encoded = encodeURIComponent(filePath.replace(/\\/g, "/"));
    return thumbWidth
      ? `konomi://local/${encoded}?w=${thumbWidth}`
      : `konomi://local/${encoded}`;
  }
  const base = `/api/files/image?path=${encodeURIComponent(filePath)}`;
  return thumbWidth ? `${base}&w=${thumbWidth}` : base;
}

export function rowToImageData(row: ImageRow, thumbWidth?: number): ImageData {
  return {
    id: String(row.id),
    path: row.path,
    src: imageUrl(row.path, thumbWidth ?? GALLERY_THUMB_WIDTH),
    fullSrc: imageUrl(row.path),
    prompt: row.prompt,
    negativePrompt: row.negativePrompt,
    characterPrompts: (() => {
      try {
        return JSON.parse(row.characterPrompts) as string[];
      } catch {
        return [];
      }
    })(),
    tokens: parseTokens(row.promptTokens),
    negativeTokens: parseTokens(row.negativePromptTokens),
    characterTokens: parseTokens(row.characterPromptTokens),
    category: "",
    tags: [],
    fileModifiedAt: new Date(row.fileModifiedAt).toISOString(),
    isFavorite: row.isFavorite,
    pHash: row.pHash,
    source: row.source,
    folderId: row.folderId,
    model: row.model,
    seed: row.seed,
    width: row.width,
    height: row.height,
    cfgScale: row.cfgScale,
    cfgRescale: row.cfgRescale,
    noiseSchedule: row.noiseSchedule,
    varietyPlus: row.varietyPlus,
    sampler: row.sampler,
    steps: row.steps,
  };
}
