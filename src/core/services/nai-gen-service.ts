import path from "path";
import fs from "fs/promises";
import { createLogger } from "../lib/logger";
import type { NaiConfigRepo } from "../lib/repositories/prisma-nai-config-repo";

const log = createLogger("nai-gen-service");

export interface NaiConfigPatch {
  apiKey?: string;
}

export interface I2IRef {
  imageData: Uint8Array;
  strength: number;
  noise: number;
}

export interface VibeRef {
  imageData: Uint8Array;
  infoExtracted: number;
  strength: number;
}

export interface PreciseRef {
  imageData: Uint8Array;
  fidelity: number;
}

export interface GenerateParams {
  prompt: string;
  negativePrompt?: string;
  characterPrompts?: string[];
  characterNegativePrompts?: string[];
  characterPositions?: string[];
  outputFolder?: string;
  model?: string;
  width?: number;
  height?: number;
  scale?: number;
  cfgRescale?: number;
  varietyPlus?: boolean;
  sampler?: string;
  steps?: number;
  seed?: number;
  noiseSchedule?: string;
  i2i?: I2IRef;
  vibes?: VibeRef[];
  preciseRef?: PreciseRef;
}

const TIER_NAMES: Record<number, string> = {
  1: "Tablet",
  2: "Scroll",
  3: "Opus",
};

export type NaiGenServiceDeps = {
  naiConfigRepo: NaiConfigRepo;
};

export function createNaiGenService(deps: NaiGenServiceDeps) {
  const { naiConfigRepo } = deps;

  // Lazy-load novelai-sdk-unofficial to avoid import issues
  // when the package isn't available (e.g. in test environments).
  let _sdk: typeof import("novelai-sdk-unofficial") | null = null;
  async function loadSdk() {
    if (!_sdk) _sdk = await import("novelai-sdk-unofficial");
    return _sdk;
  }

  return {
    async getConfig() {
      return naiConfigRepo.get();
    },

    async updateConfig(patch: NaiConfigPatch) {
      return naiConfigRepo.update(patch);
    },

    async validateApiKey(
      apiKey: string,
    ): Promise<{
      valid: boolean;
      tier?: string;
      anlas?: number;
      error?: string;
    }> {
      const res = await fetch("https://api.novelai.net/user/subscription", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${body}`);
      }
      const data = (await res.json()) as {
        tier?: number;
        trainingStepsLeft?: {
          fixedTrainingStepsLeft?: number;
          purchasedTrainingSteps?: number;
        };
      };
      const fixed = data.trainingStepsLeft?.fixedTrainingStepsLeft ?? 0;
      const purchased = data.trainingStepsLeft?.purchasedTrainingSteps ?? 0;
      return {
        valid: true,
        tier: TIER_NAMES[data.tier ?? 0] ?? "Unknown",
        anlas: fixed + purchased,
      };
    },

    async getSubscriptionInfo(): Promise<{
      tier: string;
      anlas: number;
      fixedAnlas: number;
      purchasedAnlas: number;
    }> {
      const config = await naiConfigRepo.get();
      if (!config.apiKey) throw new Error("API 키가 설정되지 않았습니다");
      const res = await fetch("https://api.novelai.net/user/subscription", {
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${body}`);
      }
      const data = (await res.json()) as {
        tier?: number;
        trainingStepsLeft?: {
          fixedTrainingStepsLeft?: number;
          purchasedTrainingSteps?: number;
        };
      };
      const fixedAnlas = data.trainingStepsLeft?.fixedTrainingStepsLeft ?? 0;
      const purchasedAnlas =
        data.trainingStepsLeft?.purchasedTrainingSteps ?? 0;
      return {
        tier: TIER_NAMES[data.tier ?? 0] ?? "Unknown",
        anlas: fixedAnlas + purchasedAnlas,
        fixedAnlas,
        purchasedAnlas,
      };
    },

    async generate(
      params: GenerateParams,
      onPreview?: (dataUrl: string) => void,
    ): Promise<string> {
      const config = await naiConfigRepo.get();
      if (!config.apiKey) throw new Error("API 키가 설정되지 않았습니다");
      if (!params.outputFolder)
        throw new Error("출력 폴더가 설정되지 않았습니다");

      const { NovelAI, isV4Model } = await loadSdk();
      const client = new NovelAI({ apiKey: config.apiKey });

      const model = params.model ?? "nai-diffusion-4-5-curated";
      const width = params.width ?? 832;
      const height = params.height ?? 1216;
      const chars = (params.characterPrompts ?? [])
        .map((prompt, index) => ({
          prompt: prompt.trim(),
          negativePrompt:
            params.characterNegativePrompts?.[index]?.trim() ?? "",
        }))
        .filter((c) => c.prompt);

      const hasV4Characters =
        chars.length > 0 &&
        isV4Model(model as Parameters<typeof isV4Model>[0]);

      const colMap: Record<string, number> = {
        A: 0.1,
        B: 0.3,
        C: 0.5,
        D: 0.7,
        E: 0.9,
      };
      const rowMap: Record<string, number> = {
        "1": 0.1,
        "2": 0.3,
        "3": 0.5,
        "4": 0.7,
        "5": 0.9,
      };
      const centers = chars.map((_, i) => {
        const posKey = params.characterPositions?.[i] ?? "global";
        if (posKey === "global" || posKey.length < 2)
          return { x: 0.5, y: 0.5 };
        return { x: colMap[posKey[0]] ?? 0.5, y: rowMap[posKey[1]] ?? 0.5 };
      });
      const useCoords =
        hasV4Characters &&
        (params.characterPositions ?? []).some(
          (p) => p !== "global" && p.length >= 2,
        );

      const origGenerateStream =
        client.apiClient.image.generateStream.bind(
          client.apiClient.image,
        );
      (client.apiClient.image as any).generateStream = async function* (
        request: any,
        signal?: AbortSignal,
      ) {
        const p = request.parameters;
        if (p) {
          if (params.seed !== undefined) p.seed = params.seed;
          if (params.cfgRescale !== undefined)
            p.cfg_rescale = params.cfgRescale;
          if (params.varietyPlus !== undefined)
            p.dynamic_thresholding = params.varietyPlus;
          const rawNeg = params.negativePrompt ?? "";
          p.negative_prompt = rawNeg;
          p.ucPreset = 4;
          if (p.v4_negative_prompt?.caption) {
            p.v4_negative_prompt.caption.base_caption = rawNeg;
          }
          if (hasV4Characters && p.v4_prompt) {
            p.use_coords = useCoords;
            p.v4_prompt = {
              caption: {
                base_caption:
                  p.v4_prompt.caption?.base_caption ?? params.prompt,
                char_captions: chars.map((c, i) => ({
                  char_caption: c.prompt,
                  centers: [centers[i]],
                })),
              },
              use_coords: useCoords,
              use_order: true,
              legacy_uc: false,
            };
            p.v4_negative_prompt = {
              caption: {
                base_caption: rawNeg,
                char_captions: chars.map((c, i) => ({
                  char_caption: c.negativePrompt,
                  centers: [centers[i]],
                })),
              },
              use_coords: useCoords,
              use_order: false,
              legacy_uc: false,
            };
            p.characterPrompts = [];
          }
        }
        log.debug("Patched request", {
          seed: p?.seed,
          useCoords,
          charCount: chars.length,
        });
        yield* origGenerateStream(request, signal);
      };

      const sdkRequest = {
        prompt: params.prompt,
        negativePrompt: params.negativePrompt ?? "",
        model: model as any,
        size: [width, height] as [number, number],
        steps: params.steps ?? 28,
        scale: params.scale ?? 6.0,
        sampler: (params.sampler ?? "k_euler") as any,
        noiseSchedule: (params.noiseSchedule ?? "karras") as any,
        seed:
          params.seed !== undefined && params.seed <= 999999999
            ? params.seed
            : undefined,
        quality: false,
        ...(!hasV4Characters &&
          chars.length > 0 && {
            characters: chars.map((c) => ({
              prompt: c.prompt,
              negativePrompt: c.negativePrompt,
              position: [0.5, 0.5] as [number, number],
            })),
          }),
        ...(params.i2i && {
          i2i: {
            image: Buffer.from(params.i2i.imageData),
            strength: params.i2i.strength,
            noise: params.i2i.noise,
          },
        }),
        ...(params.vibes?.length && {
          controlnet: {
            images: params.vibes.map((v) => ({
              image: Buffer.from(v.imageData),
              infoExtracted: v.infoExtracted,
              strength: v.strength,
            })),
          },
        }),
        ...(params.preciseRef && {
          characterReferences: [
            {
              image: Buffer.from(params.preciseRef.imageData),
              fidelity: params.preciseRef.fidelity,
            },
          ],
        }),
      };

      const stream = client.image.generateStream(sdkRequest as any);
      let finalImage: Buffer | null = null;

      for await (const chunk of stream) {
        const c = chunk as {
          event_type?: string;
          image?: string;
          error?: string;
          message?: string;
        };
        if (c.event_type === "intermediate" && onPreview && c.image) {
          onPreview(`data:image/png;base64,${c.image}`);
        } else if (c.event_type === "final" && c.image) {
          finalImage = Buffer.from(c.image, "base64");
        } else if (c.error || c.message) {
          log.error("NAI stream error", {
            error: c.error,
            message: c.message,
          });
          throw new Error(c.error ?? c.message ?? "NAI API 오류");
        }
      }

      if (!finalImage)
        throw new Error("스트림에서 최종 이미지를 받지 못했습니다");

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const outName = `nai-${timestamp}.png`;
      const outPath = path.join(params.outputFolder, outName);
      await fs.mkdir(params.outputFolder, { recursive: true });
      await fs.writeFile(outPath, finalImage);
      return outPath;
    },
  };
}

export type NaiGenService = ReturnType<typeof createNaiGenService>;
