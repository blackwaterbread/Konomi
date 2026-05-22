import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setupIsolatedDbTest,
  type IsolatedDbTestContext,
} from "../helpers/test-db";
import type { SearchStatMutation } from "@core/types/repository";
import type { ImageMeta } from "@core/types/image-meta";

vi.mock("worker_threads", () => {
  class FakeWorker {
    on(): this {
      return this;
    }

    postMessage(): void {
      // image-service.test.ts never drives the worker-backed scan path.
    }
  }
  return { Worker: FakeWorker };
});

let ctx: IsolatedDbTestContext;

beforeEach(async () => {
  ctx = await setupIsolatedDbTest();
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("imageService.registerExternalPath", () => {
  async function buildService(opts?: {
    readMetaImpl?: (filePath: string) => Promise<ImageMeta | null>;
  }) {
    const { getDB } = await import("@core/lib/db");
    const { createPrismaImageRepo } = await import(
      "@core/lib/repositories/prisma-image-repo"
    );
    const { createPrismaFolderRepo } = await import(
      "@core/lib/repositories/prisma-folder-repo"
    );
    const { createImageService } = await import(
      "@core/services/image-service"
    );

    const imageRepo = createPrismaImageRepo(getDB);
    const folderRepo = createPrismaFolderRepo(getDB);

    const mutations: SearchStatMutation[] = [];
    const searchStats = {
      applyMutations: vi.fn(async (incoming: SearchStatMutation[]) => {
        mutations.push(...incoming);
      }),
    };

    const defaultMeta: ImageMeta = {
      prompt: "external prompt",
      negativePrompt: "",
      characterPrompts: [],
      characterNegativePrompts: [],
      characterPositions: [],
      source: "nai",
      model: "nai-diffusion",
      seed: "42",
      width: 832,
      height: 1216,
      sampler: "k_euler",
      steps: 28,
      cfgScale: 6,
      cfgRescale: 0,
      noiseSchedule: "karras",
      varietyPlus: false,
      raw: {},
    };
    const readMeta = vi.fn<(filePath: string) => Promise<ImageMeta | null>>(
      opts?.readMetaImpl ?? (async () => defaultMeta),
    );

    const imageService = createImageService({
      imageRepo,
      folderRepo,
      readMeta,
      searchStats,
    });

    return { imageRepo, folderRepo, imageService, readMeta, searchStats, mutations };
  }

  async function createFolderOnDisk(name: string) {
    const dir = path.join(ctx.userDataDir, name);
    fs.mkdirSync(dir, { recursive: true });
    const { getDB } = await import("@core/lib/db");
    const folder = await getDB().folder.create({
      data: { name, path: dir },
    });
    return { folder, dir };
  }

  function writePng(filePath: string, mtime?: Date) {
    fs.writeFileSync(filePath, "fake-png-bytes");
    if (mtime) fs.utimesSync(filePath, mtime, mtime);
  }

  it("returns null when the path is outside every registered folder root", async () => {
    const { imageService, searchStats } = await buildService();
    await createFolderOnDisk("registered");

    const outsideDir = path.join(ctx.userDataDir, "outside");
    fs.mkdirSync(outsideDir, { recursive: true });
    const outsidePath = path.join(outsideDir, "nai-out.png");
    writePng(outsidePath);

    const result = await imageService.registerExternalPath(outsidePath);

    expect(result).toBeNull();
    expect(searchStats.applyMutations).not.toHaveBeenCalled();
    const { getDB } = await import("@core/lib/db");
    expect(await getDB().image.count()).toBe(0);
  });

  it("upserts a new image, emits a search-stat mutation, and returns the row", async () => {
    const { imageService, searchStats, readMeta } = await buildService();
    const { folder, dir } = await createFolderOnDisk("registered");
    const generatedPath = path.join(dir, "nai-2026.png");
    writePng(generatedPath);

    const result = await imageService.registerExternalPath(generatedPath);

    expect(result).not.toBeNull();
    expect(result!.path).toBe(generatedPath);
    expect(result!.folderId).toBe(folder.id);
    expect(result!.model).toBe("nai-diffusion");
    expect(readMeta).toHaveBeenCalledWith(generatedPath);
    expect(searchStats.applyMutations).toHaveBeenCalledTimes(1);
    const [batch] = searchStats.applyMutations.mock.calls[0];
    expect(batch).toHaveLength(1);
    expect(batch[0].before).toBeNull();
    expect(batch[0].after?.model).toBe("nai-diffusion");
  });

  it("is idempotent when called twice on a file whose mtime did not change", async () => {
    const { imageService, searchStats, readMeta } = await buildService();
    const { dir } = await createFolderOnDisk("registered");
    const generatedPath = path.join(dir, "nai-2026.png");
    const fixedMtime = new Date("2026-05-22T12:00:00.000Z");
    writePng(generatedPath, fixedMtime);

    const first = await imageService.registerExternalPath(generatedPath);
    expect(first).not.toBeNull();

    // Reset call counts and replay.
    searchStats.applyMutations.mockClear();
    readMeta.mockClear();

    const second = await imageService.registerExternalPath(generatedPath);

    expect(second).not.toBeNull();
    expect(second!.id).toBe(first!.id);
    // Same mtime → metadata read + search-stat mutation skipped.
    expect(readMeta).not.toHaveBeenCalled();
    expect(searchStats.applyMutations).not.toHaveBeenCalled();
  });
});
