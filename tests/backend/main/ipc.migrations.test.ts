import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  request: vi.fn(),
  warmManagedRootsCache: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {},
  dialog: {},
  shell: {},
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      mocks.handlers.set(channel, handler);
    },
  },
}));
vi.mock("../../../src/app/main/bridge", () => ({
  bridge: { request: mocks.request },
}));
vi.mock("../../../src/app/main/lib/updater", () => ({
  checkForUpdates: vi.fn(),
  getPendingUpdate: vi.fn(),
  installUpdate: vi.fn(),
}));
vi.mock("../../../src/app/main/lib/path-guard", () => ({
  isManagedImagePath: vi.fn(),
  registerTransientPath: vi.fn(),
  warmManagedRootsCache: mocks.warmManagedRootsCache,
}));
vi.mock("@core/lib/image-meta", () => ({
  readImageMeta: vi.fn(),
  readImageMetaFromBuffer: vi.fn(),
}));

import { registerIpcHandlers } from "../../../src/app/main/ipc";

registerIpcHandlers();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const runMigrations = () => mocks.handlers.get("db:runMigrations")!({});
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  mocks.request.mockReset();
  mocks.warmManagedRootsCache.mockReset().mockResolvedValue(undefined);
});

describe("ipc db:runMigrations", () => {
  it("starts the path-guard warm-up only once the migrations are done", async () => {
    const migrations = deferred<void>();
    mocks.request.mockReturnValueOnce(migrations.promise);

    const reply = runMigrations();
    await flush();
    expect(mocks.request).toHaveBeenCalledWith(
      "db:runMigrations",
      undefined,
      0,
    );
    expect(mocks.warmManagedRootsCache).not.toHaveBeenCalled();

    migrations.resolve();
    await expect(reply).resolves.toBeUndefined();
    expect(mocks.warmManagedRootsCache).toHaveBeenCalledTimes(1);
  });

  it("reports a failed migration and never warms the path guard", async () => {
    const error = new Error("SqliteError: no such table: Image");
    mocks.request.mockRejectedValueOnce(error);

    await expect(runMigrations()).rejects.toBe(error);
    await flush();
    expect(mocks.warmManagedRootsCache).not.toHaveBeenCalled();
  });
});
