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

async function seedSimilarityImages() {
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

  const imageAPath = path.join(folderPath, "image-a.png");
  const imageBPath = path.join(folderPath, "image-b.png");
  const imageCPath = path.join(folderPath, "image-c.png");
  fs.writeFileSync(imageAPath, "a");
  fs.writeFileSync(imageBPath, "b");
  fs.writeFileSync(imageCPath, "c");

  workerState.hashes.set(imageAPath, "0000000000000000");
  workerState.hashes.set(imageBPath, "0000000000000001");
  workerState.hashes.set(imageCPath, "ffffffffffffffff");

  const imageA = await db.image.create({
    data: {
      path: imageAPath,
      folderId: folder.id,
      promptTokens: tokens(["sunset", "beach", "golden hour"]),
      negativePromptTokens: "[]",
      characterPromptTokens: "[]",
      fileModifiedAt: new Date("2026-03-20T00:00:00.000Z"),
    },
  });
  const imageB = await db.image.create({
    data: {
      path: imageBPath,
      folderId: folder.id,
      promptTokens: tokens(["city", "night"]),
      negativePromptTokens: "[]",
      characterPromptTokens: "[]",
      fileModifiedAt: new Date("2026-03-20T00:01:00.000Z"),
    },
  });
  const imageC = await db.image.create({
    data: {
      path: imageCPath,
      folderId: folder.id,
      promptTokens: tokens(["sunset", "beach", "golden hour"]),
      negativePromptTokens: "[]",
      characterPromptTokens: "[]",
      fileModifiedAt: new Date("2026-03-20T00:02:00.000Z"),
    },
  });

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
});
