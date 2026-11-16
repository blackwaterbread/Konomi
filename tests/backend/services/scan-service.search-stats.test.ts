import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setupIsolatedDbTest,
  type IsolatedDbTestContext,
} from "../helpers/test-db";
import type { CancelToken } from "@core/lib/scanner";
import type { ImageRepo } from "@core/lib/repositories/prisma-image-repo";
import type { SearchStatsAdapter } from "@core/types/adapters";
import type { ImageMeta } from "@core/types/image-meta";

vi.mock("worker_threads", () => {
  class FakeWorker {
    on(): this {
      return this;
    }

    postMessage(): void {
      // The scan service under test is driven with an injected readMeta.
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

/** A fixture file's content is its metadata: `model|width|height|prompt`. */
const VARIANTS = [
  "nai-v4|832|1216|1girl, blue hair, smile",
  "nai-v4|1024|1024|landscape, night",
  "sdxl|832|1216|1girl, red eyes",
  "nai-v3|512|768|cat, smile",
];

function metaFromFile(filePath: string): ImageMeta {
  const [model, width, height, prompt] = fs
    .readFileSync(filePath, "utf8")
    .split("|");
  return {
    prompt,
    negativePrompt: "lowres",
    characterPrompts: [],
    characterNegativePrompts: [],
    characterPositions: [],
    source: "nai",
    model,
    seed: "1",
    width: Number(width),
    height: Number(height),
    sampler: "k_euler",
    steps: 28,
    cfgScale: 6,
    cfgRescale: 0,
    noiseSchedule: "karras",
    varietyPlus: false,
    raw: {},
  };
}

function writeImage(filePath: string, content: string, mtime?: Date) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  if (mtime) fs.utimesSync(filePath, mtime, mtime);
}

async function setup(
  wrapImageRepo: (repo: ImageRepo) => ImageRepo = (repo) => repo,
  applyDeltas?: SearchStatsAdapter["applyDeltas"],
) {
  const { getDB } = await import("@core/lib/db");
  const { createPrismaImageRepo } =
    await import("@core/lib/repositories/prisma-image-repo");
  const { createPrismaFolderRepo } =
    await import("@core/lib/repositories/prisma-folder-repo");
  const { createScanService } = await import("@core/services/scan-service");
  const store = await import("@core/lib/search-stats-store");

  const readMeta = vi.fn(async (filePath: string) => metaFromFile(filePath));
  const scanService = createScanService({
    imageRepo: wrapImageRepo(createPrismaImageRepo(getDB)),
    folderRepo: createPrismaFolderRepo(getDB),
    sender: { send: () => {} },
    readMeta,
    searchStats: {
      applyMutations: store.applyImageSearchStatsMutations,
      applyDeltas: applyDeltas ?? store.applyImageSearchStatDeltas,
    },
  });
  const readStats = () =>
    getDB().$queryRawUnsafe(
      "SELECT kind, `key`, width, height, model, count FROM ImageSearchStat ORDER BY kind, `key`",
    );
  /** The table as a from-scratch rebuild over the Image rows leaves it. */
  const rebuiltStats = async () => {
    await store.rebuildImageSearchPresetStats();
    return readStats();
  };
  return { getDB, scanService, readMeta, readStats, rebuiltStats };
}

describe("scanService search stats", () => {
  it("matches a rebuild across new, edited, rewritten, deleted and moved images", async () => {
    const { getDB, scanService, readStats, rebuiltStats } = await setup();
    const outer = path.join(ctx.userDataDir, "outer");
    const inner = path.join(outer, "inner");
    // More files than one scan batch, so each folder is written in several.
    for (let i = 0; i < 260; i++) {
      writeImage(path.join(outer, `o${i}.png`), VARIANTS[i % 4]);
    }
    for (let i = 0; i < 30; i++) {
      writeImage(path.join(inner, `i${i}.png`), VARIANTS[(i + 1) % 4]);
    }
    await getDB().folder.create({ data: { name: "outer", path: outer } });
    // A folder registered inside another takes its rows back on every scan.
    await getDB().folder.create({ data: { name: "inner", path: inner } });

    await scanService.scanAll({ detectDuplicates: false });
    const first = await readStats();
    expect(first).not.toHaveLength(0);
    expect(first).toEqual(await rebuiltStats());

    const later = new Date(Date.now() + 60_000);
    for (let i = 0; i < 40; i++) fs.rmSync(path.join(outer, `o${i}.png`));
    for (let i = 40; i < 120; i++) {
      writeImage(path.join(outer, `o${i}.png`), VARIANTS[(i + 2) % 4], later);
    }
    for (let i = 120; i < 140; i++) {
      writeImage(path.join(outer, `o${i}.png`), VARIANTS[i % 4], later);
    }
    for (let i = 0; i < 10; i++) {
      writeImage(path.join(inner, `i${i}.png`), VARIANTS[i % 4], later);
    }
    for (let i = 260; i < 330; i++) {
      writeImage(path.join(outer, `o${i}.png`), VARIANTS[(i + 3) % 4]);
    }

    await scanService.scanAll({ detectDuplicates: false });
    expect(await readStats()).toEqual(await rebuiltStats());

    await scanService.scanAll({ detectDuplicates: false });
    expect(await readStats()).toEqual(await rebuiltStats());
  });

  it("applies the stats of everything a cancelled scan wrote", async () => {
    const { getDB, scanService, readMeta, readStats, rebuiltStats } =
      await setup();
    const root = path.join(ctx.userDataDir, "library");
    for (let i = 0; i < 300; i++) {
      writeImage(path.join(root, `f${i}.png`), VARIANTS[i % 4]);
    }
    await getDB().folder.create({ data: { name: "library", path: root } });
    const signal: CancelToken = { cancelled: false };
    readMeta.mockImplementation(async (filePath: string) => {
      if (readMeta.mock.calls.length >= 150) signal.cancelled = true;
      return metaFromFile(filePath);
    });

    const result = await scanService.scanAll({
      detectDuplicates: false,
      signal,
    });

    expect(result.cancelled).toBe(true);
    const written = await getDB().image.count();
    expect(written).toBeGreaterThan(100);
    expect(written).toBeLessThan(300);
    expect(await readStats()).toEqual(await rebuiltStats());
  });

  it("applies no stats for a batch whose write failed and writes it on the next scan", async () => {
    let upsertCalls = 0;
    let failedRows = 0;
    let failing = true;
    const { getDB, scanService, readStats, rebuiltStats } = await setup(
      (repo) => ({
        ...repo,
        upsertBatch: async (rows) => {
          if (failing && ++upsertCalls === 2) {
            failedRows = rows.length;
            throw new Error("database is locked");
          }
          return repo.upsertBatch(rows);
        },
      }),
    );
    const root = path.join(ctx.userDataDir, "library");
    for (let i = 0; i < 250; i++) {
      writeImage(path.join(root, `f${i}.png`), VARIANTS[i % 4]);
    }
    const folder = await getDB().folder.create({
      data: { name: "library", path: root },
    });

    const result = await scanService.scanAll({ detectDuplicates: false });

    expect(result.cancelled).toBe(false);
    expect(failedRows).toBeGreaterThan(0);
    expect(await getDB().image.count()).toBe(250 - failedRows);
    expect(await readStats()).toEqual(await rebuiltStats());
    // The count is what the walk found, so it is still the next denominator.
    await expect(
      getDB().folder.findUnique({ where: { id: folder.id } }),
    ).resolves.toMatchObject({ lastScanFileCount: 250 });

    failing = false;
    await scanService.scanAll({ detectDuplicates: false });
    expect(await getDB().image.count()).toBe(250);
    expect(await readStats()).toEqual(await rebuiltStats());
  });

  it("applies the stats of the batches already written when the last write fails", async () => {
    let upsertCalls = 0;
    const { getDB, scanService, readStats, rebuiltStats } = await setup(
      (repo) => ({
        ...repo,
        upsertBatch: async (rows) => {
          // Two full batches during the walk, then the final flush of 50.
          if (++upsertCalls === 3) throw new Error("database is locked");
          return repo.upsertBatch(rows);
        },
      }),
    );
    const root = path.join(ctx.userDataDir, "library");
    for (let i = 0; i < 250; i++) {
      writeImage(path.join(root, `f${i}.png`), VARIANTS[i % 4]);
    }
    await getDB().folder.create({ data: { name: "library", path: root } });

    await expect(
      scanService.scanAll({ detectDuplicates: false }),
    ).rejects.toThrow("database is locked");

    expect(await getDB().image.count()).toBe(200);
    expect(await readStats()).toEqual(await rebuiltStats());
  });

  it("rejects with the write failure, not a stats failure that follows it", async () => {
    let upsertCalls = 0;
    const { getDB, scanService } = await setup(
      (repo) => ({
        ...repo,
        upsertBatch: async (rows) => {
          if (++upsertCalls === 3) throw new Error("final write failed");
          return repo.upsertBatch(rows);
        },
      }),
      async () => {
        throw new Error("stats apply failed");
      },
    );
    const root = path.join(ctx.userDataDir, "library");
    for (let i = 0; i < 250; i++) {
      writeImage(path.join(root, `f${i}.png`), VARIANTS[i % 4]);
    }
    await getDB().folder.create({ data: { name: "library", path: root } });

    await expect(
      scanService.scanAll({ detectDuplicates: false }),
    ).rejects.toThrow("final write failed");

    // With nothing else failing, the stats failure is the scan's error.
    await expect(
      scanService.scanAll({ detectDuplicates: false }),
    ).rejects.toThrow("stats apply failed");
  });

  it("folds stale rows only once they are deleted", async () => {
    let failDelete = false;
    const { getDB, scanService, readStats, rebuiltStats } = await setup(
      (repo) => ({
        ...repo,
        deleteByIds: async (ids) => {
          if (failDelete) throw new Error("database is locked");
          return repo.deleteByIds(ids);
        },
      }),
    );
    const root = path.join(ctx.userDataDir, "library");
    for (let i = 0; i < 30; i++) {
      writeImage(path.join(root, `f${i}.png`), VARIANTS[i % 4]);
    }
    await getDB().folder.create({ data: { name: "library", path: root } });
    await scanService.scanAll({ detectDuplicates: false });

    for (let i = 0; i < 10; i++) fs.rmSync(path.join(root, `f${i}.png`));
    for (let i = 30; i < 40; i++) {
      writeImage(path.join(root, `f${i}.png`), VARIANTS[(i + 1) % 4]);
    }
    failDelete = true;
    await expect(
      scanService.scanAll({ detectDuplicates: false }),
    ).rejects.toThrow("database is locked");

    // The new files are in, the stale rows are still there.
    expect(await getDB().image.count()).toBe(40);
    expect(await readStats()).toEqual(await rebuiltStats());

    failDelete = false;
    await scanService.scanAll({ detectDuplicates: false });
    expect(await getDB().image.count()).toBe(30);
    expect(await readStats()).toEqual(await rebuiltStats());
  });
});
