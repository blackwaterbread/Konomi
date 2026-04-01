import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setupIsolatedDbTest,
  type IsolatedDbTestContext,
} from "../helpers/test-db";

const syncState = vi.hoisted(() => ({
  scanResults: new Map<string, string[]>(),
  workerResults: new Map<string, unknown>(),
  deleteSimilarityCacheForImageIds: vi.fn(),
}));

vi.mock("../../../main/lib/scanner", () => ({
  scanPngFiles: async (folderPath: string) =>
    syncState.scanResults.get(folderPath) ?? [],
  walkPngFiles: async function* (folderPath: string) {
    const results = syncState.scanResults.get(folderPath) ?? [];
    for (const item of results) {
      yield item;
    }
  },
  withConcurrency: async <T>(
    items: T[] | AsyncIterable<T>,
    _concurrency: number,
    worker: (item: T) => Promise<void> | void,
    signal?: { cancelled?: boolean },
  ) => {
    if (Array.isArray(items)) {
      for (const item of items) {
        if (signal?.cancelled) break;
        await worker(item);
      }
    } else {
      for await (const item of items) {
        if (signal?.cancelled) break;
        await worker(item);
      }
    }
  },
}));

vi.mock("../../../main/lib/phash", () => ({
  deleteSimilarityCacheForImageIds: syncState.deleteSimilarityCacheForImageIds,
}));

vi.mock("worker_threads", () => {
  class FakeWorker {
    private listeners = new Map<string, (value: unknown) => void>();

    on(event: string, listener: (value: unknown) => void): this {
      this.listeners.set(event, listener);
      return this;
    }

    postMessage(message: { id: number; filePath: string }): void {
      const result = syncState.workerResults.get(message.filePath) ?? null;
      setImmediate(() => {
        this.listeners.get("message")?.({
          id: message.id,
          result,
        });
      });
    }
  }

  return {
    Worker: FakeWorker,
  };
});

let ctx: IsolatedDbTestContext;

function tokens(values: string[]) {
  return JSON.stringify(values.map((text) => ({ text, weight: 1 })));
}

function sortResolutions(
  values: Array<{ width: number; height: number }>,
): Array<{ width: number; height: number }> {
  return [...values].sort((a, b) => a.width - b.width || a.height - b.height);
}

beforeEach(async () => {
  ctx = await setupIsolatedDbTest();
  syncState.scanResults.clear();
  syncState.workerResults.clear();
  syncState.deleteSimilarityCacheForImageIds.mockReset();
  syncState.deleteSimilarityCacheForImageIds.mockResolvedValue(undefined);
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("image sync integration", () => {
  it("removes stale rows, skips unchanged files, and imports new files in batches", async () => {
    const { getDB } = await import("../../../main/lib/db");
    const db = getDB();
    const folderPath = path.join(ctx.userDataDir, "sync-folder");
    fs.mkdirSync(folderPath, { recursive: true });

    const folder = await db.folder.create({
      data: {
        name: "Sync",
        path: folderPath,
      },
    });

    const currentPath = path.join(folderPath, "current.png");
    const newPath = path.join(folderPath, "new.png");
    const stalePath = path.join(folderPath, "stale.png");
    fs.writeFileSync(currentPath, "current-binary");
    fs.writeFileSync(newPath, "new-binary");

    const currentStat = fs.statSync(currentPath);
    const staleImage = await db.image.create({
      data: {
        path: stalePath,
        folderId: folder.id,
        promptTokens: tokens(["stale tag"]),
        model: "stale-model",
        width: 640,
        height: 640,
        fileSize: 123,
        fileModifiedAt: new Date("2026-03-20T00:00:00.000Z"),
      },
    });
    await db.image.create({
      data: {
        path: currentPath,
        folderId: folder.id,
        promptTokens: tokens(["current tag"]),
        source: "nai",
        model: "current-model",
        width: 832,
        height: 1216,
        fileSize: currentStat.size,
        fileModifiedAt: currentStat.mtime,
      },
    });

    const batches: string[][] = [];
    const folderStarts: Array<[number, string]> = [];
    const folderEnds: number[] = [];
    const progressCalls: Array<[number, number]> = [];

    const { getImageSearchPresetStats, syncAllFolders } =
      await import("../../../main/lib/image");
    const initialStats = await getImageSearchPresetStats();
    expect(sortResolutions(initialStats.availableResolutions)).toEqual([
      { width: 640, height: 640 },
      { width: 832, height: 1216 },
    ]);
    expect(initialStats.availableModels).toEqual([
      "current-model",
      "stale-model",
    ]);

    syncState.scanResults.set(folderPath, [currentPath, newPath]);
    syncState.workerResults.set(newPath, {
      prompt: "fresh sunset",
      negativePrompt: "lowres",
      characterPrompts: [],
      source: "webui",
      model: "new-model",
      seed: 1234,
      width: 1024,
      height: 1024,
      sampler: "Euler a",
      steps: 28,
      cfgScale: 7,
      cfgRescale: 0,
      noiseSchedule: "",
      varietyPlus: false,
    });

    await syncAllFolders(
      (images) => batches.push(images.map((image) => image.path)),
      (done, total) => progressCalls.push([done, total]),
      (folderId, folderName) => folderStarts.push([folderId, folderName]),
      (folderId) => folderEnds.push(folderId),
    );

    await expect(
      db.image.findUnique({ where: { path: stalePath } }),
    ).resolves.toBeNull();
    await expect(
      db.image.findUnique({ where: { path: currentPath } }),
    ).resolves.not.toBeNull();
    await expect(
      db.image.findUnique({ where: { path: newPath } }),
    ).resolves.not.toBeNull();

    expect(syncState.deleteSimilarityCacheForImageIds).toHaveBeenCalledWith([
      staleImage.id,
    ]);
    expect(batches).toEqual([[newPath]]);
    expect(folderStarts).toEqual([[folder.id, "Sync"]]);
    expect(folderEnds).toEqual([folder.id]);
    expect(progressCalls.at(-1)).toEqual([2, 2]);

    const finalStats = await getImageSearchPresetStats();
    expect(sortResolutions(finalStats.availableResolutions)).toEqual([
      { width: 832, height: 1216 },
      { width: 1024, height: 1024 },
    ]);
    expect(finalStats.availableModels).toEqual(["current-model", "new-model"]);
  });

  it("detects duplicate incoming files before import and skips them until resolved", async () => {
    const { getDB } = await import("../../../main/lib/db");
    const db = getDB();
    const folderPath = path.join(ctx.userDataDir, "duplicate-sync-folder");
    fs.mkdirSync(folderPath, { recursive: true });

    const folder = await db.folder.create({
      data: {
        name: "Duplicates",
        path: folderPath,
      },
    });

    const existingPath = path.join(folderPath, "existing.png");
    const incomingPath = path.join(folderPath, "incoming.png");
    fs.writeFileSync(existingPath, "same-binary");
    fs.writeFileSync(incomingPath, "same-binary");

    const existingStat = fs.statSync(existingPath);
    const existingImage = await db.image.create({
      data: {
        path: existingPath,
        folderId: folder.id,
        promptTokens: tokens(["existing tag"]),
        source: "nai",
        model: "model-a",
        width: 832,
        height: 1216,
        fileSize: existingStat.size,
        fileModifiedAt: existingStat.mtime,
      },
    });

    syncState.scanResults.set(folderPath, [existingPath, incomingPath]);
    syncState.workerResults.set(incomingPath, {
      prompt: "should not import",
      negativePrompt: "",
      characterPrompts: [],
      source: "webui",
      model: "model-b",
      seed: 999,
      width: 1024,
      height: 1024,
      sampler: "Euler a",
      steps: 20,
      cfgScale: 6,
      cfgRescale: 0,
      noiseSchedule: "",
      varietyPlus: false,
    });

    const duplicateGroups: string[][] = [];
    const importedPaths: string[] = [];

    const { syncAllFolders } = await import("../../../main/lib/image");

    await syncAllFolders(
      (images) => importedPaths.push(...images.map((image) => image.path)),
      undefined,
      undefined,
      undefined,
      undefined,
      (group) => {
        duplicateGroups.push(group.incomingEntries.map((entry) => entry.path));
      },
    );

    expect(duplicateGroups).toEqual([[incomingPath]]);
    expect(importedPaths).toEqual([]);
    await expect(
      db.image.findMany({
        orderBy: { id: "asc" },
        select: { id: true, path: true },
      }),
    ).resolves.toEqual([{ id: existingImage.id, path: existingPath }]);
    expect(syncState.deleteSimilarityCacheForImageIds).not.toHaveBeenCalled();
  });
});

describe("refreshImagePrompts", () => {
  it("re-parses unknown-source images and updates only those that resolve", async () => {
    const { getDB } = await import("../../../main/lib/db");
    const db = getDB();
    const folderPath = path.join(ctx.userDataDir, "refresh-folder");
    fs.mkdirSync(folderPath, { recursive: true });

    const folder = await db.folder.create({
      data: { name: "Refresh", path: folderPath },
    });

    const knownPath = path.join(folderPath, "known.png");
    const unknownResolvablePath = path.join(folderPath, "resolvable.png");
    const unknownStillPath = path.join(folderPath, "still-unknown.png");
    fs.writeFileSync(knownPath, "known-binary");
    fs.writeFileSync(unknownResolvablePath, "resolvable-binary");
    fs.writeFileSync(unknownStillPath, "still-unknown-binary");

    const knownStat = fs.statSync(knownPath);
    const resolvableStat = fs.statSync(unknownResolvablePath);
    const stillStat = fs.statSync(unknownStillPath);

    await db.image.create({
      data: {
        path: knownPath,
        folderId: folder.id,
        promptTokens: tokens(["known tag"]),
        source: "nai",
        model: "known-model",
        width: 832,
        height: 1216,
        fileSize: knownStat.size,
        fileModifiedAt: knownStat.mtime,
      },
    });
    await db.image.create({
      data: {
        path: unknownResolvablePath,
        folderId: folder.id,
        promptTokens: "[]",
        source: "unknown",
        model: "",
        width: 0,
        height: 0,
        fileSize: resolvableStat.size,
        fileModifiedAt: resolvableStat.mtime,
      },
    });
    await db.image.create({
      data: {
        path: unknownStillPath,
        folderId: folder.id,
        promptTokens: "[]",
        source: "unknown",
        model: "",
        width: 0,
        height: 0,
        fileSize: stillStat.size,
        fileModifiedAt: stillStat.mtime,
      },
    });

    // resolvable image now returns comfyui meta
    syncState.workerResults.set(unknownResolvablePath, {
      prompt: "comfy sunset",
      negativePrompt: "lowres",
      characterPrompts: [],
      source: "comfyui",
      model: "comfy-model",
      seed: 42,
      width: 1024,
      height: 1024,
      sampler: "Euler a",
      steps: 20,
      cfgScale: 7,
      cfgRescale: 0,
      noiseSchedule: "",
      varietyPlus: false,
    });
    // still-unknown returns null (no metadata found)
    syncState.workerResults.set(unknownStillPath, null);

    const batches: string[][] = [];
    const progressCalls: Array<[number, number]> = [];

    const { refreshImagePrompts } = await import("../../../main/lib/image");

    const updated = await refreshImagePrompts(
      (done, total) => progressCalls.push([done, total]),
      (images) => batches.push(images.map((img) => img.path)),
    );

    expect(updated).toBe(1);
    expect(batches).toEqual([[unknownResolvablePath]]);
    expect(progressCalls.at(-1)).toEqual([2, 2]);

    // resolvable image should be updated
    const resolvableRow = await db.image.findUnique({
      where: { path: unknownResolvablePath },
    });
    expect(resolvableRow!.source).toBe("comfyui");
    expect(resolvableRow!.model).toBe("comfy-model");
    expect(resolvableRow!.prompt).toBe("comfy sunset");

    // still-unknown image should remain unchanged
    const stillRow = await db.image.findUnique({
      where: { path: unknownStillPath },
    });
    expect(stillRow!.source).toBe("unknown");

    // known image should not have been touched at all
    const knownRow = await db.image.findUnique({
      where: { path: knownPath },
    });
    expect(knownRow!.source).toBe("nai");
    expect(knownRow!.model).toBe("known-model");
  });

  it("returns 0 when there are no unknown-source images", async () => {
    const { refreshImagePrompts } = await import("../../../main/lib/image");
    const updated = await refreshImagePrompts();
    expect(updated).toBe(0);
  });
});
