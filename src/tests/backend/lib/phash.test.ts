/* 추후 Mock 데이터 좀 보강할것 */

import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setupIsolatedDbTest,
  type IsolatedDbTestContext,
} from "../helpers/test-db";

const workerState = vi.hoisted(() => ({
  hashes: new Map<string, string | null>(),
}));

vi.mock("worker_threads", () => {
  class FakeWorker {
    private listeners = new Map<string, (value: unknown) => void>();

    on(event: string, listener: (value: unknown) => void): this {
      this.listeners.set(event, listener);
      return this;
    }

    postMessage(message: { id: number; filePath: string }): void {
      const hash = workerState.hashes.get(message.filePath) ?? null;
      setImmediate(() => {
        this.listeners.get("message")?.({
          id: message.id,
          hash,
        });
      });
    }
  }

  return {
    Worker: FakeWorker,
  };
});

let ctx: IsolatedDbTestContext;

function tokens(values: string[]): string {
  return JSON.stringify(values.map((text) => ({ text, weight: 1 })));
}

type SimilaritySeedSpec = {
  name: string;
  hash: string | null;
  promptTokens: string[];
  negativePromptTokens?: string[];
  characterPromptTokens?: string[];
};

type SeededSimilarityImage = {
  id: number;
};

async function seedConfiguredSimilarityImages(specs: SimilaritySeedSpec[]) {
  const { getDB } = await import("../../../main/lib/db");
  const db = getDB();
  const folderPath = path.join(ctx.userDataDir, "phash-images");
  fs.mkdirSync(folderPath, { recursive: true });

  const folder = await db.folder.create({
    data: {
      name: "Similarity",
      path: folderPath,
    },
  });

  const images: SeededSimilarityImage[] = [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    const imagePath = path.join(folderPath, `${spec.name}.png`);
    fs.writeFileSync(imagePath, spec.name);
    if (spec.hash !== null) {
      workerState.hashes.set(imagePath, spec.hash);
    } else {
      workerState.hashes.delete(imagePath);
    }

    images.push(
      await db.image.create({
        data: {
          path: imagePath,
          folderId: folder.id,
          promptTokens: tokens(spec.promptTokens),
          negativePromptTokens: tokens(spec.negativePromptTokens ?? []),
          characterPromptTokens: tokens(spec.characterPromptTokens ?? []),
          fileModifiedAt: new Date(
            `2026-03-20T00:0${Math.min(i, 9)}:00.000Z`,
          ),
        },
      }),
    );
  }

  return { db, images };
}

async function seedSimilarityImages() {
  const { db, images } = await seedConfiguredSimilarityImages([
    {
      name: "image-a",
      hash: "0000000000000000",
      promptTokens: ["sunset", "beach", "golden hour"],
    },
    {
      name: "image-b",
      hash: "0000000000000001",
      promptTokens: ["city", "night"],
    },
    {
      name: "image-c",
      hash: "ffffffffffffffff",
      promptTokens: ["sunset", "beach", "golden hour"],
    },
  ]);
  const [imageA, imageB, imageC] = images;
  if (!imageA || !imageB || !imageC) {
    throw new Error("Failed to seed similarity images");
  }
  return { db, imageA, imageB, imageC };
}

beforeEach(async () => {
  ctx = await setupIsolatedDbTest();
  workerState.hashes.clear();
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("phash", () => {
  it("computes nibble-based Hamming distance", async () => {
    const { hammingDistance } = await import("../../../main/lib/phash");

    expect(hammingDistance("0000000000000000", "000000000000000f")).toBe(4);
    expect(hammingDistance("ffffffffffffffff", "ffffffffffffff0f")).toBe(4);
  });

  it("computes hashes, refreshes similarity cache, and classifies reasons", async () => {
    const { imageA, imageB, imageC } = await seedSimilarityImages();
    const {
      computeAllHashes,
      getSimilarGroups,
      getSimilarityReasons,
    } = await import("../../../main/lib/phash");
    const onHashProgress = vi.fn();
    const onSimilarityProgress = vi.fn();

    await expect(
      computeAllHashes(onHashProgress, onSimilarityProgress),
    ).resolves.toBe(3);

    const groups = await getSimilarGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]?.imageIds).toEqual([imageA.id, imageB.id, imageC.id]);

    const reasons = await getSimilarityReasons(imageA.id, [
      imageB.id,
      imageC.id,
    ]);
    expect(reasons[0]).toMatchObject({
      imageId: imageB.id,
      reason: "visual",
    });
    expect(reasons[0]!.score).toBeGreaterThan(0);
    expect(reasons[1]).toMatchObject({
      imageId: imageC.id,
      reason: "prompt",
    });
    expect(reasons[1]!.score).toBeGreaterThan(0.25);

    expect(onHashProgress).toHaveBeenLastCalledWith(3, 3);
    expect(onSimilarityProgress).toHaveBeenLastCalledWith(
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("deletes similarity cache rows and resets persisted hashes", async () => {
    const { db, imageA, imageB, imageC } = await seedSimilarityImages();
    const {
      computeAllHashes,
      deleteSimilarityCacheForImageIds,
      getSimilarGroups,
      resetAllHashes,
    } = await import("../../../main/lib/phash");

    await computeAllHashes();
    await expect(getSimilarGroups()).resolves.toHaveLength(1);

    await deleteSimilarityCacheForImageIds([imageA.id]);
    await expect(getSimilarGroups()).resolves.toEqual([]);

    await resetAllHashes();
    await expect(
      db.image.findMany({
        where: { id: { in: [imageA.id, imageB.id, imageC.id] } },
        orderBy: { id: "asc" },
        select: { pHash: true },
      }),
    ).resolves.toEqual([{ pHash: "" }, { pHash: "" }, { pHash: "" }]);
  });

  it("classifies hybrid-only matches as both when visual and prompt signals combine", async () => {
    const { images } = await seedConfiguredSimilarityImages([
      {
        name: "hybrid-a",
        hash: "0000000000000000",
        promptTokens: ["sunset", "beach", "golden hour", "dramatic clouds"],
      },
      {
        name: "hybrid-b",
        hash: "0000000000000fff",
        promptTokens: ["sunset", "beach", "golden hour", "city lights"],
      },
    ]);
    const [imageA, imageB] = images;
    if (!imageA || !imageB) {
      throw new Error("Failed to seed hybrid similarity images");
    }
    const { computeAllHashes, getSimilarGroups, getSimilarityReasons } =
      await import("../../../main/lib/phash");

    await computeAllHashes();

    await expect(getSimilarGroups()).resolves.toEqual([
      expect.objectContaining({
        imageIds: [imageA.id, imageB.id],
      }),
    ]);

    const reasons = await getSimilarityReasons(imageA.id, [imageB.id]);
    expect(reasons).toEqual([
      expect.objectContaining({
        imageId: imageB.id,
        reason: "both",
      }),
    ]);
    expect(reasons[0]!.score).toBeGreaterThan(0.72);
  });

  it("respects a stricter prompt threshold override for prompt-only matches", async () => {
    const { images } = await seedConfiguredSimilarityImages([
      {
        name: "prompt-a",
        hash: "0000000000000000",
        promptTokens: ["sunset", "beach", "golden hour"],
      },
      {
        name: "prompt-b",
        hash: "ffffffffffffffff",
        promptTokens: ["sunset", "beach", "golden hour", "warm light"],
      },
    ]);
    const [imageA, imageB] = images;
    if (!imageA || !imageB) {
      throw new Error("Failed to seed prompt-only similarity images");
    }
    const { computeAllHashes, getSimilarGroups, getSimilarityReasons } =
      await import("../../../main/lib/phash");

    await computeAllHashes();

    await expect(getSimilarGroups()).resolves.toEqual([
      expect.objectContaining({
        imageIds: [imageA.id, imageB.id],
      }),
    ]);

    const defaultReasons = await getSimilarityReasons(imageA.id, [imageB.id]);
    expect(defaultReasons).toEqual([
      expect.objectContaining({
        imageId: imageB.id,
        reason: "prompt",
      }),
    ]);

    await expect(getSimilarGroups(10, 0.75)).resolves.toEqual([]);
  });

  it("drops prompt-only matches after negative prompt conflicts are introduced", async () => {
    const { db, images } = await seedConfiguredSimilarityImages([
      {
        name: "conflict-a",
        hash: "0000000000000000",
        promptTokens: ["sunset", "beach", "golden hour"],
      },
      {
        name: "conflict-b",
        hash: "ffffffffffffffff",
        promptTokens: ["sunset", "beach", "golden hour", "warm light"],
      },
    ]);
    const [imageA, imageB] = images;
    if (!imageA || !imageB) {
      throw new Error("Failed to seed conflict similarity images");
    }
    const {
      computeAllHashes,
      getSimilarGroups,
      refreshSimilarityCacheForImageIds,
    } = await import("../../../main/lib/phash");

    await computeAllHashes();
    await expect(getSimilarGroups()).resolves.toEqual([
      expect.objectContaining({
        imageIds: [imageA.id, imageB.id],
      }),
    ]);

    await db.image.update({
      where: { id: imageB.id },
      data: {
        negativePromptTokens: tokens(["sunset", "beach", "golden hour"]),
      },
    });
    await refreshSimilarityCacheForImageIds([imageB.id]);

    await expect(getSimilarGroups()).resolves.toEqual([]);
  });

  it("batches similarity-reason lookups when a group has hundreds of candidates", async () => {
    const candidateCount = 520;
    const { db, images } = await seedConfiguredSimilarityImages([
      {
        name: "batch-anchor",
        hash: "0000000000000000",
        promptTokens: ["sunset", "beach", "golden hour"],
      },
      ...Array.from({ length: candidateCount }, (_, index) => ({
        name: `batch-candidate-${index + 1}`,
        hash: "0000000000000001",
        promptTokens: ["sunset", "beach", "golden hour"],
      })),
    ]);
    const [anchorImage, ...candidateImages] = images;
    if (!anchorImage || candidateImages.length !== candidateCount) {
      throw new Error("Failed to seed batched similarity reason images");
    }

    const { refreshSimilarityCacheForImageIds, getSimilarityReasons } =
      await import("../../../main/lib/phash");

    await refreshSimilarityCacheForImageIds([anchorImage.id]);
    await db.$executeRawUnsafe(
      "UPDATE ImageSimilarityCacheMeta SET primedAt = datetime('now') WHERE id = 1",
    );

    const reasons = await getSimilarityReasons(
      anchorImage.id,
      candidateImages.map((image) => image.id),
    );

    expect(reasons).toHaveLength(candidateCount);
    expect(reasons[0]).toMatchObject({
      imageId: candidateImages[0]?.id,
      reason: "prompt",
    });
    expect(reasons.at(-1)).toMatchObject({
      imageId: candidateImages.at(-1)?.id,
      reason: "prompt",
    });
  });
});
