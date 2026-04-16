export interface ImageMeta {
  source: "nai" | "webui" | "midjourney" | "comfyui" | "unknown";
  prompt: string;
  negativePrompt: string;
  characterPrompts: string[];
  characterNegativePrompts: string[];
  characterPositions: string[];
  seed: string;
  model: string;
  sampler: string;
  steps: number;
  cfgScale: number;
  cfgRescale: number;
  noiseSchedule: string;
  varietyPlus: boolean;
  width: number;
  height: number;
  raw: Record<string, unknown>;
}

/** @deprecated Use ImageMeta instead */
export type NovelAIMeta = ImageMeta;
