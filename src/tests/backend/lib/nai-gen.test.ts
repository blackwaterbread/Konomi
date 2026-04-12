import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setupIsolatedDbTest,
  type IsolatedDbTestContext,
} from "../helpers/test-db";

const sdkState = vi.hoisted(() => ({
  apiKeys: [] as string[],
  requests: [] as Array<{ parameters: Record<string, unknown> }>,
  streamChunks: [] as Array<Record<string, string>>,
  isV4Model: vi.fn((model: string) => model.startsWith("nai-diffusion-4")),
}));

vi.mock("novelai-sdk-unofficial", () => {
  class FakeNovelAI {
    apiClient = {
      image: {
        generateStream: async function* (request: {
          parameters: Record<string, unknown>;
        }) {
          sdkState.requests.push(request);
          for (const chunk of sdkState.streamChunks) {
            yield chunk;
          }
        },
      },
    };

    image = {
      generateStream: (sdkRequest: {
        prompt: string;
        negativePrompt?: string;
        model?: string;
        seed?: number;
        characters?: unknown[];
      }) => {
        const parameters = {
          seed: sdkRequest.seed,
          negative_prompt: `sdk:${sdkRequest.negativePrompt ?? ""}`,
          ucPreset: 1,
          v4_prompt: {
            caption: {
              base_caption: sdkRequest.prompt,
              char_captions: [],
            },
          },
          v4_negative_prompt: {
            caption: {
              base_caption: sdkRequest.negativePrompt ?? "",
              char_captions: [],
            },
          },
          characterPrompts: sdkRequest.characters ?? [],
        };
        return this.apiClient.image.generateStream({ parameters });
      },
    };

    constructor(config: { apiKey: string }) {
      sdkState.apiKeys.push(config.apiKey);
    }
  }

  return {
    NovelAI: FakeNovelAI,
    isV4Model: sdkState.isV4Model,
  };
});

let ctx: IsolatedDbTestContext;
const fetchMock = vi.fn();

async function createService() {
  const { getDB } = await import("../../../main/lib/db");
  const { createPrismaNaiConfigRepo } = await import(
    "../../../main/lib/repositories/prisma-nai-config-repo"
  );
  const { createNaiGenService } = await import(
    "@core/services/nai-gen-service"
  );
  const naiConfigRepo = createPrismaNaiConfigRepo(getDB);
  return createNaiGenService({ naiConfigRepo });
}

beforeEach(async () => {
  ctx = await setupIsolatedDbTest();
  sdkState.apiKeys.length = 0;
  sdkState.requests.length = 0;
  sdkState.streamChunks.length = 0;
  sdkState.isV4Model.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await ctx.cleanup();
});

describe("nai-gen", () => {
  it("creates and updates the persisted NovelAI config", async () => {
    const service = await createService();

    await expect(service.getConfig()).resolves.toMatchObject({
      id: 1,
      apiKey: "",
    });

    await expect(
      service.updateConfig({ apiKey: "secret-key" }),
    ).resolves.toMatchObject({
      id: 1,
      apiKey: "secret-key",
    });
    await expect(service.getConfig()).resolves.toMatchObject({
      id: 1,
      apiKey: "secret-key",
    });
  });

  it("validates API keys and maps subscription tiers", async () => {
    const service = await createService();

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ tier: 2 }),
    });

    await expect(service.validateApiKey("token-123")).resolves.toEqual({
      valid: true,
      tier: "Scroll",
      anlas: 0,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.novelai.net/user/subscription",
      {
        headers: { Authorization: "Bearer token-123" },
      },
    );
  });

  it("throws a detailed error when API key validation fails", async () => {
    const service = await createService();

    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "bad token",
    });

    await expect(service.validateApiKey("bad-token")).rejects.toThrow(
      "HTTP 401: bad token",
    );
  });

  it("streams previews, saves the final image, and patches V4 requests", async () => {
    const service = await createService();
    const outputFolder = path.join(ctx.userDataDir, "generated");
    const previewBytes = Buffer.from("preview-image");
    const finalBytes = Buffer.from("final-image");
    const onPreview = vi.fn();

    sdkState.streamChunks.push(
      {
        event_type: "intermediate",
        image: previewBytes.toString("base64"),
      },
      {
        event_type: "final",
        image: finalBytes.toString("base64"),
      },
    );

    await service.updateConfig({ apiKey: "secret-api-key" });

    const outputPath = await service.generate(
      {
        prompt: "masterpiece, 2girls",
        negativePrompt: "lowres, blurry",
        characterPrompts: ["alice", "bob"],
        characterNegativePrompts: ["bad alice", "bad bob"],
        characterPositions: ["A1", "global"],
        outputFolder,
        model: "nai-diffusion-4-5-curated",
        width: 1024,
        height: 1024,
        scale: 6.5,
        cfgRescale: 0.33,
        varietyPlus: true,
        sampler: "k_euler",
        steps: 28,
        seed: 4_000_000_000,
        noiseSchedule: "karras",
      },
      onPreview,
    );

    expect(sdkState.apiKeys).toEqual(["secret-api-key"]);
    expect(onPreview).toHaveBeenCalledWith(
      `data:image/png;base64,${previewBytes.toString("base64")}`,
    );
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(path.dirname(outputPath)).toBe(outputFolder);
    expect(fs.readFileSync(outputPath)).toEqual(finalBytes);

    const request = sdkState.requests.at(-1);
    expect(request).toBeDefined();
    expect(request?.parameters.seed).toBe(4_000_000_000);
    expect(request?.parameters.cfg_rescale).toBe(0.33);
    expect(request?.parameters.dynamic_thresholding).toBe(true);
    expect(request?.parameters.negative_prompt).toBe("lowres, blurry");
    expect(request?.parameters.ucPreset).toBe(4);
    expect(request?.parameters.use_coords).toBe(true);
    expect(request?.parameters.characterPrompts).toEqual([]);
    expect(request?.parameters.v4_prompt).toEqual({
      caption: {
        base_caption: "masterpiece, 2girls",
        char_captions: [
          {
            char_caption: "alice",
            centers: [{ x: 0.1, y: 0.1 }],
          },
          {
            char_caption: "bob",
            centers: [{ x: 0.5, y: 0.5 }],
          },
        ],
      },
      use_coords: true,
      use_order: true,
      legacy_uc: false,
    });
    expect(request?.parameters.v4_negative_prompt).toEqual({
      caption: {
        base_caption: "lowres, blurry",
        char_captions: [
          {
            char_caption: "bad alice",
            centers: [{ x: 0.1, y: 0.1 }],
          },
          {
            char_caption: "bad bob",
            centers: [{ x: 0.5, y: 0.5 }],
          },
        ],
      },
      use_coords: true,
      use_order: false,
      legacy_uc: false,
    });
  });
});
