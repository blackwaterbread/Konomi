import type { ImageRow } from "@preload/index.d";

export function createImageRow(overrides?: Partial<ImageRow>): ImageRow {
  return {
    id: overrides?.id ?? 1,
    path: overrides?.path ?? "C:\\images\\sample.png",
    folderId: overrides?.folderId ?? 1,
    prompt: overrides?.prompt ?? "sample prompt",
    negativePrompt: overrides?.negativePrompt ?? "",
    characterPrompts: overrides?.characterPrompts ?? "[]",
    promptTokens: overrides?.promptTokens ?? "[]",
    negativePromptTokens: overrides?.negativePromptTokens ?? "[]",
    characterPromptTokens: overrides?.characterPromptTokens ?? "[]",
    source: overrides?.source ?? "webui",
    model: overrides?.model ?? "model-a",
    seed: overrides?.seed ?? "123",
    width: overrides?.width ?? 832,
    height: overrides?.height ?? 1216,
    sampler: overrides?.sampler ?? "Euler a",
    steps: overrides?.steps ?? 28,
    cfgScale: overrides?.cfgScale ?? 7,
    cfgRescale: overrides?.cfgRescale ?? 0,
    noiseSchedule: overrides?.noiseSchedule ?? "",
    varietyPlus: overrides?.varietyPlus ?? false,
    isFavorite: overrides?.isFavorite ?? false,
    pHash: overrides?.pHash ?? "",
    fileModifiedAt:
      overrides?.fileModifiedAt ?? new Date("2026-03-20T00:00:00.000Z"),
    createdAt: overrides?.createdAt ?? new Date("2026-03-20T00:00:00.000Z"),
  };
}
