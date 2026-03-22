import { describe, expect, it } from "vitest";
import {
  readImageMetaFromBuffer,
} from "../../../main/lib/nai";
import { readMidjourneyMetaFromBuffer } from "../../../main/lib/midjourney";
import { readWebuiMetaFromBuffer } from "../../../main/lib/webui";
import {
  createNaiPngBuffer,
  createPngBuffer,
  createPngTextChunk,
} from "../fixtures/png-fixture";

describe("metadata readers", () => {
  it("parses Stable Diffusion WebUI metadata from PNG text chunks", () => {
    const buf = createPngBuffer({
      width: 832,
      height: 1216,
      chunks: [
        createPngTextChunk(
          "parameters",
          [
            "masterpiece, 1girl",
            "Negative prompt: lowres, blurry",
            "Steps: 28, Sampler: Euler a, CFG scale: 7, Seed: 1234, Size: 832x1216, Model: animeModel",
          ].join("\n"),
        ),
      ],
    });

    expect(readWebuiMetaFromBuffer(buf)).toMatchObject({
      source: "webui",
      prompt: "masterpiece, 1girl",
      negativePrompt: "lowres, blurry",
      sampler: "Euler a",
      steps: 28,
      cfgScale: 7,
      seed: 1234,
      model: "animeModel",
      width: 832,
      height: 1216,
    });
  });

  it("parses Midjourney metadata when enough Midjourney signals are present", () => {
    const buf = createPngBuffer({
      width: 1024,
      height: 1024,
      chunks: [
        createPngTextChunk(
          "Description",
          "cat wizard --ar 3:2 --v 6 --seed 987 Job ID: abc123",
        ),
        createPngTextChunk("Author", "u123456"),
        createPngTextChunk(
          "XML:com.adobe.xmp",
          '<x:xmpmeta DigImageGUID="guid-123" />',
        ),
      ],
    });

    expect(readMidjourneyMetaFromBuffer(buf)).toMatchObject({
      source: "midjourney",
      prompt: "cat wizard",
      seed: 987,
      model: "midjourney-v6",
      width: 1024,
      height: 1024,
      raw: expect.objectContaining({
        aspectRatio: "3:2",
        jobId: "abc123",
        version: "6",
      }),
    });
  });

  it("prefers WebUI metadata over Midjourney metadata in the unified reader", () => {
    const buf = createPngBuffer({
      width: 832,
      height: 1216,
      chunks: [
        createPngTextChunk(
          "parameters",
          [
            "portrait, dramatic lighting",
            "Negative prompt: lowres",
            "Steps: 20, Sampler: DPM++ 2M, CFG scale: 6, Seed: 42, Size: 832x1216, Model: webuiModel",
          ].join("\n"),
        ),
        createPngTextChunk(
          "Description",
          "different prompt --ar 1:1 --v 6 Job ID: mj123",
        ),
        createPngTextChunk("Author", "u222222"),
      ],
    });

    expect(readImageMetaFromBuffer(buf)).toMatchObject({
      source: "webui",
      prompt: "portrait, dramatic lighting",
      model: "webuiModel",
      seed: 42,
    });
  });

  it("maps the NovelAI V4.5 infilling source hash to the full model", () => {
    const buf = createNaiPngBuffer({
      Software: "NovelAI",
      Source: "NovelAI Diffusion V4.5 4BDE2A90",
      Comment: JSON.stringify({
        prompt: "",
        uc: "",
        seed: 0,
        sampler: "k_euler",
        steps: 28,
        scale: 6,
        width: 896,
        height: 1152,
      }),
    });

    expect(readImageMetaFromBuffer(buf)).toMatchObject({
      source: "nai",
      model: "nai-diffusion-4-5-full",
      width: 896,
      height: 1152,
    });
  });
});
