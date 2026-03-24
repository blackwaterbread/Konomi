import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const db = {
    image: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
      upsert: vi.fn(),
    },
  };

  return {
    db,
    getFolders: vi.fn(),
    readImageMeta: vi.fn(),
    applyImageSearchStatsMutation: vi.fn(),
    decrementImageSearchStatsForRows: vi.fn(),
    findDuplicateGroupForIncomingPath: vi.fn(),
    forgetIgnoredDuplicatePath: vi.fn(),
    isIgnoredDuplicatePath: vi.fn(),
    deleteSimilarityCacheForImageIds: vi.fn(),
    refreshSimilarityCacheForImageIds: vi.fn(),
  };
});

vi.mock("../../../main/lib/db", () => ({
  getDB: () => mocks.db,
}));

vi.mock("../../../main/lib/folder", () => ({
  getFolders: mocks.getFolders,
}));

vi.mock("../../../main/lib/nai", () => ({
  readImageMeta: mocks.readImageMeta,
}));

vi.mock("../../../main/lib/image", () => ({
  applyImageSearchStatsMutation: mocks.applyImageSearchStatsMutation,
  decrementImageSearchStatsForRows: mocks.decrementImageSearchStatsForRows,
  findDuplicateGroupForIncomingPath: mocks.findDuplicateGroupForIncomingPath,
  forgetIgnoredDuplicatePath: mocks.forgetIgnoredDuplicatePath,
  isIgnoredDuplicatePath: mocks.isIgnoredDuplicatePath,
}));

vi.mock("../../../main/lib/phash", () => ({
  deleteSimilarityCacheForImageIds: mocks.deleteSimilarityCacheForImageIds,
  refreshSimilarityCacheForImageIds: mocks.refreshSimilarityCacheForImageIds,
}));

type WatchCallback = (
  eventType: string,
  filename: string | Buffer | null,
) => void;

type WatcherRecord = {
  path: string;
  callback: WatchCallback;
  close: ReturnType<typeof vi.fn>;
};

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "konomi-watcher-test-"));
  tempDirs.push(dir);
  return dir;
}

function createSender() {
  return {
    send: vi.fn(),
    isDestroyed: vi.fn(() => false),
  };
}

function mockFsWatch(records: WatcherRecord[]) {
  return vi.spyOn(fs, "watch").mockImplementation(((
    folderPath: fs.PathLike,
    _options: fs.WatchOptions,
    listener?: fs.WatchListener<string>,
  ) => {
    const close = vi.fn();
    const callback: WatchCallback =
      typeof listener === "function"
        ? (eventType, filename) =>
            (
              listener as (
                eventType: string,
                filename: string | Buffer | null,
              ) => void
            )(eventType, filename)
        : () => undefined;

    records.push({
      path: String(folderPath),
      callback,
      close,
    });

    return {
      close,
      on: vi.fn(),
    } as unknown as fs.FSWatcher;
  }) as typeof fs.watch);
}

async function loadWatcher() {
  vi.resetModules();
  return import("../../../main/lib/watcher");
}

beforeEach(() => {
  vi.useFakeTimers();

  mocks.getFolders.mockReset();
  mocks.readImageMeta.mockReset();
  mocks.applyImageSearchStatsMutation.mockReset();
  mocks.decrementImageSearchStatsForRows.mockReset();
  mocks.findDuplicateGroupForIncomingPath.mockReset();
  mocks.forgetIgnoredDuplicatePath.mockReset();
  mocks.isIgnoredDuplicatePath.mockReset();
  mocks.deleteSimilarityCacheForImageIds.mockReset();
  mocks.refreshSimilarityCacheForImageIds.mockReset();
  mocks.db.image.findMany.mockReset();
  mocks.db.image.deleteMany.mockReset();
  mocks.db.image.findUnique.mockReset();
  mocks.db.image.delete.mockReset();
  mocks.db.image.upsert.mockReset();

  mocks.getFolders.mockResolvedValue([]);
  mocks.readImageMeta.mockReturnValue(null);
  mocks.applyImageSearchStatsMutation.mockResolvedValue(undefined);
  mocks.decrementImageSearchStatsForRows.mockResolvedValue(undefined);
  mocks.findDuplicateGroupForIncomingPath.mockResolvedValue(null);
  mocks.forgetIgnoredDuplicatePath.mockResolvedValue(undefined);
  mocks.isIgnoredDuplicatePath.mockResolvedValue(false);
  mocks.deleteSimilarityCacheForImageIds.mockResolvedValue(undefined);
  mocks.refreshSimilarityCacheForImageIds.mockResolvedValue(undefined);
  mocks.db.image.findMany.mockResolvedValue([]);
  mocks.db.image.deleteMany.mockResolvedValue({ count: 0 });
  mocks.db.image.findUnique.mockResolvedValue(null);
  mocks.db.image.delete.mockResolvedValue(undefined);
  mocks.db.image.upsert.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("watcher", () => {
  it("restarts folder watchers when watching is started again", async () => {
    const watchRecords: WatcherRecord[] = [];
    mockFsWatch(watchRecords);
    const folderA = createTempDir();
    const folderB = createTempDir();
    const folderC = createTempDir();
    mocks.getFolders
      .mockResolvedValueOnce([
        { id: 1, name: "A", path: folderA },
        { id: 2, name: "B", path: folderB },
      ])
      .mockResolvedValueOnce([{ id: 3, name: "C", path: folderC }]);

    const { startWatching } = await loadWatcher();

    await startWatching(createSender());
    const firstRoundClosers = watchRecords.map((record) => record.close);

    await startWatching(createSender());

    expect(watchRecords.map((record) => record.path)).toEqual([
      folderA,
      folderB,
      folderC,
    ]);
    expect(firstRoundClosers[0]).toHaveBeenCalledTimes(1);
    expect(firstRoundClosers[1]).toHaveBeenCalledTimes(1);
  });

  it("removes deleted files and emits removal side effects", async () => {
    const watchRecords: WatcherRecord[] = [];
    mockFsWatch(watchRecords);
    const sender = createSender();
    const folderPath = createTempDir();
    const removedPath = path.join(folderPath, "removed.png");
    const existingRow = {
      id: 41,
      path: removedPath,
      width: 832,
      height: 1216,
      model: "model-a",
      promptTokens: "[]",
      negativePromptTokens: "[]",
      characterPromptTokens: "[]",
      fileModifiedAt: new Date("2026-03-20T00:00:00.000Z"),
    };

    mocks.getFolders.mockResolvedValue([
      { id: 7, name: "watched", path: folderPath },
    ]);
    mocks.db.image.findUnique.mockResolvedValue(existingRow);

    const { startWatching } = await loadWatcher();
    await startWatching(sender);

    watchRecords[0]?.callback("rename", "removed.png");
    await vi.advanceTimersByTimeAsync(500);

    expect(mocks.forgetIgnoredDuplicatePath).toHaveBeenCalledWith(removedPath);
    expect(mocks.db.image.delete).toHaveBeenCalledWith({
      where: { path: removedPath },
    });
    expect(mocks.deleteSimilarityCacheForImageIds).toHaveBeenCalledWith([41]);
    expect(mocks.applyImageSearchStatsMutation).toHaveBeenCalledWith(
      existingRow,
      null,
      expect.any(Function),
    );
    expect(sender.send).toHaveBeenCalledWith("image:removed", [41]);
  });

  it("emits duplicate groups and reprocesses retained incoming files", async () => {
    const watchRecords: WatcherRecord[] = [];
    mockFsWatch(watchRecords);
    const sender = createSender();
    const folderPath = createTempDir();
    const incomingPath = path.join(folderPath, "incoming.png");
    fs.writeFileSync(incomingPath, "png-binary");

    const duplicateGroup = {
      id: "dup-1",
      hash: "hash-1",
      previewPath: incomingPath,
      previewFileName: "incoming.png",
      existingEntries: [
        { imageId: 5, path: "C:/existing.png", fileName: "existing.png" },
      ],
      incomingEntries: [{ path: incomingPath, fileName: "incoming.png" }],
    };
    const imageRow = {
      id: 99,
      path: incomingPath,
      folderId: 9,
      prompt: "sunset beach",
      negativePrompt: "",
      characterPrompts: "[]",
      promptTokens: JSON.stringify([{ text: "sunset beach", weight: 1 }]),
      negativePromptTokens: "[]",
      characterPromptTokens: "[]",
      source: "webui",
      model: "model-b",
      seed: 123,
      width: 1024,
      height: 1024,
      sampler: "Euler a",
      steps: 28,
      cfgScale: 7,
      cfgRescale: 0,
      noiseSchedule: "",
      varietyPlus: false,
      isFavorite: false,
      pHash: "",
      fileSize: fs.statSync(incomingPath).size,
      fileModifiedAt: fs.statSync(incomingPath).mtime,
      createdAt: new Date("2026-03-20T00:00:00.000Z"),
    };

    mocks.getFolders.mockResolvedValue([
      { id: 9, name: "incoming", path: folderPath },
    ]);
    mocks.findDuplicateGroupForIncomingPath
      .mockResolvedValueOnce(duplicateGroup)
      .mockResolvedValueOnce(null);
    mocks.readImageMeta.mockReturnValue({
      prompt: imageRow.prompt,
      negativePrompt: imageRow.negativePrompt,
      characterPrompts: [],
      source: imageRow.source,
      model: imageRow.model,
      seed: imageRow.seed,
      width: imageRow.width,
      height: imageRow.height,
      sampler: imageRow.sampler,
      steps: imageRow.steps,
      cfgScale: imageRow.cfgScale,
      cfgRescale: imageRow.cfgRescale,
      noiseSchedule: imageRow.noiseSchedule,
      varietyPlus: imageRow.varietyPlus,
    });
    mocks.db.image.upsert.mockResolvedValue(imageRow);

    const { notifyWatchDuplicateResolved, startWatching } = await loadWatcher();
    await startWatching(sender);

    watchRecords[0]?.callback("rename", "incoming.png");
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    expect(sender.send).toHaveBeenCalledWith(
      "image:watchDuplicate",
      duplicateGroup,
    );
    expect(mocks.db.image.upsert).not.toHaveBeenCalled();

    notifyWatchDuplicateResolved({
      touchedIncomingPaths: [incomingPath],
      retainedIncomingPaths: [incomingPath],
    });
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    expect(mocks.db.image.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.refreshSimilarityCacheForImageIds).toHaveBeenCalledWith([99]);
    expect(sender.send).toHaveBeenCalledWith("image:batch", [imageRow]);
  });

  it("reconciles missing rows when the watch event omits a filename", async () => {
    const watchRecords: WatcherRecord[] = [];
    mockFsWatch(watchRecords);
    const sender = createSender();
    const folderPath = createTempDir();
    const missingRowA = {
      id: 11,
      path: path.join(folderPath, "missing-a.png"),
      width: 832,
      height: 1216,
      model: "model-a",
      promptTokens: "[]",
      negativePromptTokens: "[]",
      characterPromptTokens: "[]",
    };
    const missingRowB = {
      id: 12,
      path: path.join(folderPath, "missing-b.png"),
      width: 1024,
      height: 1024,
      model: "model-b",
      promptTokens: "[]",
      negativePromptTokens: "[]",
      characterPromptTokens: "[]",
    };

    mocks.getFolders.mockResolvedValue([
      { id: 12, name: "reconcile", path: folderPath },
    ]);
    mocks.db.image.findMany.mockResolvedValue([missingRowA, missingRowB]);

    const { startWatching } = await loadWatcher();
    await startWatching(sender);

    watchRecords[0]?.callback("rename", null);
    await vi.advanceTimersByTimeAsync(500);

    expect(mocks.db.image.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [11, 12] } },
    });
    expect(mocks.deleteSimilarityCacheForImageIds).toHaveBeenCalledWith([
      11, 12,
    ]);
    expect(mocks.decrementImageSearchStatsForRows).toHaveBeenCalledWith(
      [missingRowA, missingRowB],
      expect.any(Function),
    );
    expect(sender.send).toHaveBeenCalledWith("image:removed", [11, 12]);
  });
});
