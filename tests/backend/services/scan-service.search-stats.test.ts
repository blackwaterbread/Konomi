import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setupIsolatedDbTest,
  type IsolatedDbTestContext,
} from "../helpers/test-db";
import type { CancelToken } from "@core/lib/scanner";
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

async function setup() {
  const { getDB } = await import("@core/lib/db");
  const { createPrismaImageRepo } =
    await import("@core/lib/repositories/prisma-image-repo");
  const { createPrismaFolderRepo } =
    await import("@core/lib/repositories/prisma-folder-repo");
  const { createScanService } = await import("@core/services/scan-service");
  const store = await import("@core/lib/search-stats-store");

  const readMeta = vi.fn(async (filePath: string) => metaFromFile(filePath));
  const scanService = createScanService({
    imageRepo: createPrismaImageRepo(getDB),
    folderRepo: createPrismaFolderRepo(getDB),
    sender: { send: () => {} },
    readMeta,
    searchStats: {
      applyMutations: store.applyImageSearchStatsMutations,
      applyDeltas: store.applyImageSearchStatDeltas,
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
});
