export interface NovelAIMeta {
  source: "nai" | "webui" | "unknown";
  prompt: string;
  negativePrompt: string;
  characterPrompts: string[];
  characterNegativePrompts: string[];
  characterPositions: string[];
  seed: number;
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
