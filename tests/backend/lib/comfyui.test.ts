import { describe, expect, it } from "vitest";
import { readComfyuiMetaFromBuffer } from "@core/lib/comfyui";
import { createPngBuffer, createPngTextChunk } from "../fixtures/png-fixture";

function comfyPng(
  prompt: Record<string, unknown>,
  workflow?: Record<string, unknown>,
  size?: { width?: number; height?: number },
): Buffer {
  const chunks = [
    createPngTextChunk("prompt", JSON.stringify(prompt)),
  ];
  if (workflow) {
    chunks.push(createPngTextChunk("workflow", JSON.stringify(workflow)));
  }
  return createPngBuffer({ width: size?.width ?? 512, height: size?.height ?? 768, chunks });
}

describe("readComfyuiMetaFromBuffer", () => {
  it("parses a standard KSampler + CLIPTextEncode + CheckpointLoader graph", () => {
    const prompt = {
      "1": {
        class_type: "CheckpointLoaderSimple",
        inputs: { ckpt_name: "animagine-xl.safetensors" },
      },
      "2": {
        class_type: "CLIPTextEncode",
        inputs: { text: "1girl, masterpiece", clip: ["1", 1] },
      },
      "3": {
        class_type: "CLIPTextEncode",
        inputs: { text: "lowres, blurry", clip: ["1", 1] },
      },
      "4": {
        class_type: "EmptyLatentImage",
        inputs: { width: 832, height: 1216, batch_size: 1 },
      },
      "5": {
        class_type: "KSampler",
        inputs: {
          model: ["1", 0],
          positive: ["2", 0],
          negative: ["3", 0],
          latent_image: ["4", 0],
          seed: 42,
          steps: 28,
          cfg: 7,
          sampler_name: "euler",
          scheduler: "normal",
        },
      },
      "6": {
        class_type: "SaveImage",
        inputs: { images: ["5", 0] },
      },
    };

    const meta = readComfyuiMetaFromBuffer(comfyPng(prompt));
    expect(meta).toMatchObject({
      source: "comfyui",
      prompt: "1girl, masterpiece",
      negativePrompt: "lowres, blurry",
      seed: 42,
      steps: 28,
      cfgScale: 7,
      model: "animagine-xl.safetensors",
      sampler: "euler (normal)",
      width: 832,
      height: 1216,
    });
  });

  it("extracts params from Efficient Loader + context sampler", () => {
    const prompt = {
      "1": {
        class_type: "Efficient Loader",
        inputs: {
          ckpt_name: "sd15.safetensors",
          positive: "landscape, scenic",
          negative: "ugly",
          image_width: 768,
          image_height: 512,
          cfg: 5,
          sampler_name: "dpm_2",
          scheduler: "karras",
        },
      },
      "2": {
        class_type: "KSampler (Efficient)",
        inputs: {
          context: ["1", 0],
          seed: 100,
          steps: 20,
          set_seed_cfg_sampler: "from context",
        },
      },
    };

    const meta = readComfyuiMetaFromBuffer(comfyPng(prompt));
    expect(meta).toMatchObject({
      source: "comfyui",
      prompt: "landscape, scenic",
      negativePrompt: "ugly",
      seed: 100,
      steps: 20,
      cfgScale: 5,
      model: "sd15.safetensors",
      sampler: "dpm_2 (karras)",
      width: 768,
      height: 512,
    });
  });

  it("collects LoRA names from LoraLoader nodes", () => {
    const prompt = {
      "1": {
        class_type: "CheckpointLoaderSimple",
        inputs: { ckpt_name: "model.safetensors" },
      },
      "2": {
        class_type: "LoraLoader",
        inputs: {
          model: ["1", 0],
          clip: ["1", 1],
          lora_name: "detail-tweaker.safetensors",
          strength_model: 0.8,
          strength_clip: 1,
        },
      },
      "3": {
        class_type: "CLIPTextEncode",
        inputs: { text: "test", clip: ["2", 1] },
      },
      "4": {
        class_type: "EmptyLatentImage",
        inputs: { width: 512, height: 512, batch_size: 1 },
      },
      "5": {
        class_type: "KSampler",
        inputs: {
          model: ["2", 0],
          positive: ["3", 0],
          negative: ["3", 0],
          latent_image: ["4", 0],
          seed: 1,
          steps: 20,
          cfg: 7,
          sampler_name: "euler",
          scheduler: "normal",
        },
      },
    };

    const meta = readComfyuiMetaFromBuffer(comfyPng(prompt));
    expect(meta).not.toBeNull();
    expect(meta!.raw).toHaveProperty("loras");
    expect((meta!.raw as { loras: string[] }).loras).toContain(
      "detail-tweaker.safetensors:0.8",
    );
  });

  it("falls back to workflow widgets_values when prompt graph has no sampler", () => {
    // Prompt graph with no KSampler → parseComfyPrompt returns null → workflow fallback
    const prompt = {
      "1": {
        class_type: "SomeUnknownNode",
        inputs: { value: "test" },
      },
    };
    const workflow = {
      nodes: [
        { id: 1, type: "CLIPTextEncode", widgets_values: ["beautiful scenery"] },
        { id: 2, type: "CLIPTextEncode", widgets_values: ["ugly, bad"] },
        { id: 3, type: "KSampler", widgets_values: [999, "randomize", 30, 8, "euler_a", "normal", 1.0] },
        { id: 4, type: "CheckpointLoaderSimple", widgets_values: ["wf-model.safetensors"] },
        { id: 5, type: "EmptyLatentImage", widgets_values: [640, 960, 1] },
      ],
    };

    const meta = readComfyuiMetaFromBuffer(comfyPng(prompt, workflow));
    expect(meta).toMatchObject({
      source: "comfyui",
      prompt: "beautiful scenery",
      negativePrompt: "ugly, bad",
      seed: 999,
      steps: 30,
      cfgScale: 8,
      model: "wf-model.safetensors",
      width: 640,
      height: 960,
    });
  });

  it("returns null for non-ComfyUI PNG (no prompt chunk)", () => {
    const buf = createPngBuffer({ width: 100, height: 100 });
    expect(readComfyuiMetaFromBuffer(buf)).toBeNull();
  });

  it("returns null when prompt chunk is not JSON", () => {
    const buf = createPngBuffer({
      chunks: [createPngTextChunk("prompt", "not json at all")],
    });
    expect(readComfyuiMetaFromBuffer(buf)).toBeNull();
  });

  it("uses image dimensions when graph has no EmptyLatentImage", () => {
    const prompt = {
      "1": {
        class_type: "CheckpointLoaderSimple",
        inputs: { ckpt_name: "m.safetensors" },
      },
      "2": {
        class_type: "CLIPTextEncode",
        inputs: { text: "test prompt", clip: ["1", 1] },
      },
      "3": {
        class_type: "KSampler",
        inputs: {
          model: ["1", 0],
          positive: ["2", 0],
          negative: ["2", 0],
          latent_image: ["999", 0],
          seed: 1,
          steps: 10,
          cfg: 5,
          sampler_name: "euler",
          scheduler: "",
        },
      },
    };

    const meta = readComfyuiMetaFromBuffer(comfyPng(prompt, undefined, { width: 1024, height: 768 }));
    expect(meta).toMatchObject({
      width: 1024,
      height: 768,
    });
  });

  it("resolves model through LoraLoader chain", () => {
    const prompt = {
      "1": {
        class_type: "CheckpointLoaderSimple",
        inputs: { ckpt_name: "deep-model.safetensors" },
      },
      "2": {
        class_type: "LoraLoader",
        inputs: { model: ["1", 0], clip: ["1", 1], lora_name: "lora1", strength_model: 1, strength_clip: 1 },
      },
      "3": {
        class_type: "LoraLoader",
        inputs: { model: ["2", 0], clip: ["2", 1], lora_name: "lora2", strength_model: 1, strength_clip: 1 },
      },
      "4": {
        class_type: "CLIPTextEncode",
        inputs: { text: "prompt", clip: ["3", 1] },
      },
      "5": {
        class_type: "EmptyLatentImage",
        inputs: { width: 512, height: 512, batch_size: 1 },
      },
      "6": {
        class_type: "KSampler",
        inputs: {
          model: ["3", 0],
          positive: ["4", 0],
          negative: ["4", 0],
          latent_image: ["5", 0],
          seed: 1,
          steps: 20,
          cfg: 7,
          sampler_name: "euler",
          scheduler: "normal",
        },
      },
    };

    const meta = readComfyuiMetaFromBuffer(comfyPng(prompt));
    expect(meta).toMatchObject({ model: "deep-model.safetensors" });
  });
});
