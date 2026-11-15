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
