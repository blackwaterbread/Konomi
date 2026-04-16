import type { PromptToken } from "@/lib/token";
import type { ImageData } from "@/components/image-card";

const DEFAULT_TOKENS: PromptToken[] = [{ text: "sample prompt", weight: 1 }];

export function createGalleryImage(
  overrides: Partial<ImageData> = {},
): ImageData {
  return {
    id: "image-1",
    path: "C:\\gallery\\image-1.png",
    src: "konomi://local/C%3A%2Fgallery%2Fimage-1.png?w=400",
    fullSrc: "konomi://local/C%3A%2Fgallery%2Fimage-1.png",
    prompt: "sample prompt",
    negativePrompt: "",
    characterPrompts: [],
    tokens: DEFAULT_TOKENS,
    negativeTokens: [],
    characterTokens: [],
    category: "",
    tags: [],
    fileModifiedAt: "2026-03-20T12:00:00.000Z",
    isFavorite: false,
    pHash: "0123456789abcdef",
    source: "nai",
    folderId: 1,
    model: "nai-diffusion-4-5-full",
    seed: "123",
    width: 832,
    height: 1216,
    cfgScale: 5,
    cfgRescale: 0,
    noiseSchedule: "native",
    varietyPlus: false,
    sampler: "k_euler_ancestral",
    steps: 28,
    ...overrides,
  };
}
