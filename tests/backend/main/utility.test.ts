import { beforeEach, describe, expect, it, vi } from "vitest";

type Message = Record<string, unknown>;
type MessageHandler = (event: { data: unknown }) => Promise<void>;

const mocks = vi.hoisted(() => ({
  runMigrations: vi.fn(),
  dbReady: vi.fn(),
  disconnectDB: vi.fn(),
  getDB: vi.fn(),
  getReadDB: vi.fn(),
  getRawDB: vi.fn(),
  seedBuiltins: vi.fn(),
  ensureIgnoredLoaded: vi.fn(),
  listFolders: vi.fn(),
  scanAll: vi.fn(),
  computeAllHashes: vi.fn(),
  posted: [] as Message[],
  handler: null as MessageHandler | null,
}));

vi.mock("@core/lib/db", () => ({
  runMigrations: mocks.runMigrations,
  dbReady: mocks.dbReady,
  disconnectDB: mocks.disconnectDB,
  getDB: mocks.getDB,
  getReadDB: mocks.getReadDB,
  getRawDB: mocks.getRawDB,
  getDialect: () => "sqlite",
  insertIgnore: () => "INSERT OR IGNORE INTO",
}));

// phash.ts builds an eager worker pool on import; real workers would be
// spawned on every module load here and fail to find their script.
vi.mock("@core/lib/worker-pool", () => ({
  WorkerPool: class {
    run(): Promise<null> {
      return Promise.resolve(null);
    }
    shutdown(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

vi.mock("@core/services/category-service", () => ({
  createCategoryService: () => ({ seedBuiltins: mocks.seedBuiltins }),
}));

vi.mock("@core/services/duplicate-service", () => ({
  createDuplicateService: () => ({
    ensureIgnoredLoaded: mocks.ensureIgnoredLoaded,
  }),
}));

vi.mock("@core/services/folder-service", () => ({
  createFolderService: () => ({ list: mocks.listFolders }),
}));

vi.mock("@core/services/scan-service", () => ({
  createScanService: () => ({ scanAll: mocks.scanAll }),
}));

vi.mock("@core/lib/phash", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@core/lib/phash")>()),
  computeAllHashes: mocks.computeAllHashes,
}));

let nextId = 1;

/** Loads a fresh utility module, as a newly (re)started utility process. */
async function startUtility(): Promise<void> {
  vi.resetModules();
  mocks.handler = null;
  Object.defineProperty(process, "parentPort", {
    configurable: true,
    value: {
      on: (_: string, handler: MessageHandler) => {
        mocks.handler = handler;
      },
      postMessage: (message: Message) => {
        mocks.posted.push(message);
      },
    },
  });
  await import("../../../src/app/main/utility");
}

async function request(type: string): Promise<Message> {
  const id = nextId++;
  await mocks.handler!({ data: { id, type } });
  // Boot tasks are started, not awaited, by the request.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return mocks.posted.find(
    (message) => message.id === id && message.ack === undefined,
  )!;
}

beforeEach(() => {
  mocks.posted.length = 0;
  mocks.runMigrations.mockReset().mockResolvedValue(undefined);
  mocks.dbReady.mockReset().mockResolvedValue(undefined);
  mocks.disconnectDB.mockReset().mockResolvedValue(undefined);
  mocks.seedBuiltins.mockReset().mockResolvedValue(undefined);
  mocks.ensureIgnoredLoaded.mockReset().mockResolvedValue(undefined);
  mocks.listFolders.mockReset().mockResolvedValue([]);
  mocks.scanAll.mockReset();
  mocks.computeAllHashes.mockReset().mockResolvedValue(0);
});

describe("utility DB readiness", () => {
  it("leaves the database alone until a request arrives", async () => {
    await startUtility();

    expect(mocks.runMigrations).not.toHaveBeenCalled();
    expect(mocks.dbReady).not.toHaveBeenCalled();
    expect(mocks.getDB).not.toHaveBeenCalled();
    expect(mocks.getReadDB).not.toHaveBeenCalled();
    expect(mocks.getRawDB).not.toHaveBeenCalled();
    expect(mocks.seedBuiltins).not.toHaveBeenCalled();
  });

  it("applies migrations with progress before readying the DB, then boots once", async () => {
    const progress = { done: 0, total: 1, migrationName: "20990101000000_a" };
    mocks.runMigrations.mockImplementation(
      async (onProgress: (p: typeof progress) => void) => onProgress(progress),
    );
    await startUtility();

    const reply = await request("db:runMigrations");

    expect(reply).not.toHaveProperty("error");
    expect(mocks.runMigrations.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.dbReady.mock.invocationCallOrder[0],
    );
    const progressIndex = mocks.posted.findIndex(
      (message) => message.event === "db:migrationProgress",
    );
    expect(mocks.posted[progressIndex].payload).toEqual(progress);
    expect(progressIndex).toBeLessThan(mocks.posted.indexOf(reply));
    expect(mocks.seedBuiltins).toHaveBeenCalledTimes(1);
    expect(mocks.ensureIgnoredLoaded).toHaveBeenCalledTimes(1);

    await request("folder:list");
    await request("db:runMigrations");
    expect(mocks.seedBuiltins).toHaveBeenCalledTimes(1);
    expect(mocks.ensureIgnoredLoaded).toHaveBeenCalledTimes(1);
  });

  it("reports a failed migration without readying the DB or booting", async () => {
    mocks.runMigrations.mockRejectedValue(new Error('near "x": syntax error'));
    await startUtility();

    const reply = await request("db:runMigrations");

    expect(reply.error).toContain('near "x": syntax error');
    expect(mocks.dbReady).not.toHaveBeenCalled();
    expect(mocks.seedBuiltins).not.toHaveBeenCalled();
    expect(mocks.ensureIgnoredLoaded).not.toHaveBeenCalled();
  });

  it("readies the DB and boots on whichever request comes first after a restart", async () => {
    await startUtility();

    await request("folder:list");
    await request("folder:list");

    expect(mocks.runMigrations).not.toHaveBeenCalled();
    expect(mocks.dbReady).toHaveBeenCalled();
    expect(mocks.seedBuiltins).toHaveBeenCalledTimes(1);
    expect(mocks.ensureIgnoredLoaded).toHaveBeenCalledTimes(1);
  });

  it("shuts down without readying the DB", async () => {
    await startUtility();

    const reply = await request("system:shutdown");

    expect(reply).toEqual({ id: reply.id, result: null });
    expect(mocks.dbReady).not.toHaveBeenCalled();
    expect(mocks.runMigrations).not.toHaveBeenCalled();
    expect(mocks.disconnectDB).toHaveBeenCalledTimes(1);
  });
});

type RunningScan = {
  signal: { cancelled: boolean };
  finish: () => void;
  reply: Promise<void>;
};

/** Sends an `image:scan` whose scanAll stays pending until `finish()`. */
async function startScan(): Promise<RunningScan> {
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let signal!: { cancelled: boolean };
  mocks.scanAll.mockImplementationOnce(
    async (options: { signal: { cancelled: boolean } }) => {
      signal = options.signal;
      await finished;
      return [];
    },
  );
  const reply = mocks.handler!({ data: { id: nextId++, type: "image:scan" } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { signal, finish, reply };
}

describe("utility overlapping scans", () => {
  it.each(["image:cancelScan", "system:shutdown"])(
    "%s reaches every scan still running",
    async (type) => {
      await startUtility();
      const first = await startScan();
      const second = await startScan();

      await request(type);

      expect(first.signal.cancelled).toBe(true);
      expect(second.signal.cancelled).toBe(true);
      first.finish();
      second.finish();
      await Promise.all([first.reply, second.reply]);
    },
  );

  it("keeps an earlier scan cancellable after a later one finishes", async () => {
    await startUtility();
    const first = await startScan();
    const second = await startScan();
    second.finish();
    await second.reply;

    await request("image:cancelScan");

    expect(first.signal.cancelled).toBe(true);
    first.finish();
    await first.reply;
  });

  it("holds analysis back until the last running scan ends", async () => {
    await startUtility();
    const first = await startScan();
    const second = await startScan();

    second.finish();
    await second.reply;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.computeAllHashes).not.toHaveBeenCalled();

    first.finish();
    await first.reply;
    await vi.waitFor(() =>
      expect(mocks.computeAllHashes).toHaveBeenCalledTimes(1),
    );
  });

  it("schedules analysis after a scan that finishes while a cancelled one drains", async () => {
    await startUtility();
    const cancelled = await startScan();
    await request("image:cancelScan");
    const fresh = await startScan();

    fresh.finish();
    await fresh.reply;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.computeAllHashes).not.toHaveBeenCalled();
    cancelled.finish();
    await cancelled.reply;

    // Deferred while the cancelled scan was still running: re-checked every 1 s.
    await vi.waitFor(
      () => expect(mocks.computeAllHashes).toHaveBeenCalledTimes(1),
      { timeout: 3_000 },
    );
  });
});
