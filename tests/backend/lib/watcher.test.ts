import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWatchService } from "../../../konomi-core/services/watch-service";
import type { SearchStatSource } from "../../../konomi-core/types/repository";
import type { ImageRepo } from "@core/lib/repositories/prisma-image-repo";
import type { FolderRepo } from "@core/lib/repositories/prisma-folder-repo";
import type { FolderDuplicateGroup } from "../../../konomi-core/services/duplicate-service";

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
  return { send: vi.fn() };
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
            (listener as (eventType: string, filename: string | Buffer | null) => void)(eventType, filename)
        : () => undefined;

    records.push({ path: String(folderPath), callback, close });

    return {
      close,
      on: vi.fn(),
    } as unknown as fs.FSWatcher;
  }) as typeof fs.watch);
}

function createMockImageRepo(): ImageRepo {
  return {
    findById: vi.fn().mockResolvedValue(null),
    findByPath: vi.fn().mockResolvedValue(null),
    findSyncRowsByFolderId: vi.fn().mockResolvedValue([]),
    upsertBatch: vi.fn().mockResolvedValue([]),
    upsertByPath: vi.fn().mockResolvedValue(undefined),
    deleteByIds: vi.fn().mockResolvedValue(undefined),
    deleteByPath: vi.fn().mockResolvedValue(undefined),
    setFavorite: vi.fn().mockResolvedValue(undefined),
    countByFolderId: vi.fn().mockResolvedValue(0),
    existsByPath: vi.fn().mockResolvedValue(false),
    updateFolderScanMeta: vi.fn().mockResolvedValue(undefined),
    getPathsByFolderId: vi.fn().mockResolvedValue([]),
    sumFileSizeByFolderId: vi.fn().mockResolvedValue(0),
    findIdsByPromptContaining: vi.fn().mockResolvedValue([]),
    findByFileSize: vi.fn().mockResolvedValue([]),
    findSearchStatSourcesByPaths: vi.fn().mockResolvedValue([]),
    findSearchStatSourcesByIds: vi.fn().mockResolvedValue([]),
    listPage: vi.fn().mockResolvedValue({ rows: [], totalCount: 0, page: 1, pageSize: 50, totalPages: 0 }),
    listMatchingIds: vi.fn().mockResolvedValue([]),
    listByIds: vi.fn().mockResolvedValue([]),
    listIdsByFolderId: vi.fn().mockResolvedValue([]),
    findAllIdAndPath: vi.fn().mockResolvedValue([]),
    updateMetadataBatch: vi.fn().mockResolvedValue([]),
    findByFileSizeExcludingPath: vi.fn().mockResolvedValue([]),
    deleteById: vi.fn().mockResolvedValue(true),
    findByFolderIdCursor: vi.fn().mockResolvedValue([]),
  };
}

function createMockFolderRepo(folders: Array<{ id: number; name: string; path: string }> = []): FolderRepo {
  return {
    findAll: vi.fn().mockResolvedValue(folders.map((f) => ({ ...f, createdAt: new Date() }))),
    findById: vi.fn().mockImplementation(async (id: number) => {
      const f = folders.find((f) => f.id === id);
      return f ? { ...f, createdAt: new Date() } : null;
    }),
    create: vi.fn(),
    delete: vi.fn(),
    rename: vi.fn(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("watch-service", () => {
  it("restarts folder watchers when watching is started again", async () => {
    const watchRecords: WatcherRecord[] = [];
    mockFsWatch(watchRecords);
    const folderA = createTempDir();
    const folderB = createTempDir();
    const folderC = createTempDir();

    const imageRepo = createMockImageRepo();
    const sender = createSender();

    // First round
    const folderRepo1 = createMockFolderRepo([
      { id: 1, name: "A", path: folderA },
      { id: 2, name: "B", path: folderB },
    ]);
    const service1 = createWatchService({
      imageRepo,
      folderRepo: folderRepo1,
      sender,
      readMeta: () => null,
    });
    await service1.startAll();
    const firstRoundClosers = watchRecords.map((r) => r.close);

    // Second round (new service simulates restart)
    service1.stopAll();
    const folderRepo2 = createMockFolderRepo([
      { id: 3, name: "C", path: folderC },
    ]);
    const service2 = createWatchService({
      imageRepo,
      folderRepo: folderRepo2,
      sender,
      readMeta: () => null,
    });
    await service2.startAll();

    expect(firstRoundClosers[0]).toHaveBeenCalledTimes(1);
    expect(firstRoundClosers[1]).toHaveBeenCalledTimes(1);
    expect(watchRecords).toHaveLength(3);
    expect(watchRecords[2].path).toBe(folderC);
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
      folderId: 7,
      prompt: "",
      negativePrompt: "",
      characterPrompts: "[]",
      promptTokens: "[]",
      negativePromptTokens: "[]",
      characterPromptTokens: "[]",
      source: "unknown",
      model: "model-a",
      seed: "",
      width: 832,
      height: 1216,
      sampler: "",
      steps: 0,
      cfgScale: 0,
      cfgRescale: 0,
      noiseSchedule: "",
      varietyPlus: false,
      isFavorite: false,
      pHash: "",
      fileSize: 100,
      fileModifiedAt: new Date("2026-03-20T00:00:00.000Z"),
      createdAt: new Date("2026-03-20T00:00:00.000Z"),
    };

    const imageRepo = createMockImageRepo();
    (imageRepo.findByPath as ReturnType<typeof vi.fn>).mockResolvedValue(existingRow);

    const searchStats = {
      applyMutation: vi.fn().mockResolvedValue(undefined),
      decrementForRows: vi.fn().mockResolvedValue(undefined),
    };
    const duplicateDetection = {
      findDuplicateForIncomingPath: vi.fn().mockResolvedValue(null),
      isIgnored: vi.fn().mockResolvedValue(false),
      forgetIgnored: vi.fn().mockResolvedValue(undefined),
    };
    const similarityCache = {
      deleteForImageIds: vi.fn().mockResolvedValue(undefined),
      refreshForImageIds: vi.fn().mockResolvedValue(undefined),
    };

    const service = createWatchService({
      imageRepo,
      folderRepo: createMockFolderRepo([{ id: 7, name: "watched", path: folderPath }]),
      sender,
      readMeta: () => null,
      searchStats,
      duplicateDetection,
      similarityCache,
    });
    await service.startAll();

    watchRecords[0]?.callback("rename", "removed.png");
    await vi.advanceTimersByTimeAsync(500);

    expect(duplicateDetection.forgetIgnored).toHaveBeenCalledWith(removedPath);
    expect(imageRepo.deleteByPath).toHaveBeenCalledWith(removedPath);
    expect(similarityCache.deleteForImageIds).toHaveBeenCalledWith([41]);
    expect(searchStats.applyMutation).toHaveBeenCalledWith(
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

    const duplicateGroup: FolderDuplicateGroup = {
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
      seed: "123",
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

    const imageRepo = createMockImageRepo();
    (imageRepo.upsertByPath as ReturnType<typeof vi.fn>).mockResolvedValue(imageRow);

    const duplicateDetection = {
      findDuplicateForIncomingPath: vi.fn()
        .mockResolvedValueOnce(duplicateGroup)
        .mockResolvedValueOnce(null),
      isIgnored: vi.fn().mockResolvedValue(false),
      forgetIgnored: vi.fn().mockResolvedValue(undefined),
    };
    const searchStats = {
      applyMutation: vi.fn().mockResolvedValue(undefined),
      decrementForRows: vi.fn().mockResolvedValue(undefined),
    };
    const similarityCache = {
      deleteForImageIds: vi.fn().mockResolvedValue(undefined),
      refreshForImageIds: vi.fn().mockResolvedValue(undefined),
    };

    const service = createWatchService({
      imageRepo,
      folderRepo: createMockFolderRepo([{ id: 9, name: "incoming", path: folderPath }]),
      sender,
      readMeta: () => ({
        prompt: imageRow.prompt,
        negativePrompt: imageRow.negativePrompt,
        characterPrompts: [],
        characterNegativePrompts: [],
        characterPositions: [],
        source: imageRow.source as "webui",
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
        raw: {},
      }),
      searchStats,
      duplicateDetection,
      similarityCache,
    });
    await service.startAll();

    watchRecords[0]?.callback("rename", "incoming.png");
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    expect(sender.send).toHaveBeenCalledWith("image:watchDuplicate", duplicateGroup);
    expect(imageRepo.upsertByPath).not.toHaveBeenCalled();

    service.applyResolvedDuplicates({
      touchedIncomingPaths: [incomingPath],
      retainedIncomingPaths: [incomingPath],
    });
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    expect(imageRepo.upsertByPath).toHaveBeenCalledTimes(1);
    expect(similarityCache.refreshForImageIds).toHaveBeenCalledWith([99]);
    expect(sender.send).toHaveBeenCalledWith("image:batch", [imageRow]);
  });

  it("reconciles missing rows when the watch event omits a filename", async () => {
    const watchRecords: WatcherRecord[] = [];
    mockFsWatch(watchRecords);
    const sender = createSender();
    const folderPath = createTempDir();
    const missingRowA: { id: number; path: string } & SearchStatSource = {
      id: 11,
      path: path.join(folderPath, "missing-a.png"),
      width: 832,
      height: 1216,
      model: "model-a",
      promptTokens: "[]",
      negativePromptTokens: "[]",
      characterPromptTokens: "[]",
    };
    const missingRowB: { id: number; path: string } & SearchStatSource = {
      id: 12,
      path: path.join(folderPath, "missing-b.png"),
      width: 1024,
      height: 1024,
      model: "model-b",
      promptTokens: "[]",
      negativePromptTokens: "[]",
      characterPromptTokens: "[]",
    };

    const imageRepo = createMockImageRepo();
    (imageRepo.findByFolderIdCursor as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([missingRowA, missingRowB])
      .mockResolvedValue([]);

    vi.spyOn(fs.promises, "access").mockResolvedValue(undefined);

    const searchStats = {
      applyMutation: vi.fn().mockResolvedValue(undefined),
      decrementForRows: vi.fn().mockResolvedValue(undefined),
    };
    const similarityCache = {
      deleteForImageIds: vi.fn().mockResolvedValue(undefined),
      refreshForImageIds: vi.fn().mockResolvedValue(undefined),
    };

    const service = createWatchService({
      imageRepo,
      folderRepo: createMockFolderRepo([{ id: 12, name: "reconcile", path: folderPath }]),
      sender,
      readMeta: () => null,
      searchStats,
      similarityCache,
    });
    await service.startAll();

    watchRecords[0]?.callback("rename", null);
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    expect(imageRepo.deleteByIds).toHaveBeenCalledWith([11, 12]);
    expect(similarityCache.deleteForImageIds).toHaveBeenCalledWith([11, 12]);
    expect(searchStats.decrementForRows).toHaveBeenCalledWith(
      [missingRowA, missingRowB],
      expect.any(Function),
    );
    expect(sender.send).toHaveBeenCalledWith("image:removed", [11, 12]);
  });
});
