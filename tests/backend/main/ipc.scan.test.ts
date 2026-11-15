import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  request: vi.fn(),
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
  warmManagedRootsCache: vi.fn(),
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

function createSender(destroyed = false) {
  return { isDestroyed: vi.fn(() => destroyed), send: vi.fn() };
}

function scan(
  sender: ReturnType<typeof createSender>,
  options: unknown,
  requestId: string,
) {
  return mocks.handlers.get("image:scan")!({ sender }, options, requestId);
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  mocks.request.mockReset();
});

describe("ipc image:scan", () => {
  it("sends the settled push with the request id only after the scan resolves", async () => {
    const result = { cancelled: false, skippedSubPaths: [] };
    const reply = deferred<typeof result>();
    mocks.request.mockReturnValueOnce(reply.promise);
    const sender = createSender();

    const handled = scan(sender, { folderIds: [3] }, "scope:7");
    await flush();
    expect(mocks.request).toHaveBeenCalledWith("image:scan", {
      folderIds: [3],
    });
    expect(sender.send).not.toHaveBeenCalled();

    reply.resolve(result);
    await expect(handled).resolves.toBe(result);
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.send).toHaveBeenCalledWith("image:scanSettled", "scope:7");
  });

  it("sends nothing when the scan request fails", async () => {
    const error = new Error("Utility process exited unexpectedly (code: 1)");
    mocks.request.mockRejectedValueOnce(error);
    const sender = createSender();

    await expect(scan(sender, undefined, "scope:8")).rejects.toBe(error);
    expect(sender.send).not.toHaveBeenCalled();
  });

  it("sends nothing to a destroyed sender but still returns the result", async () => {
    const result = { cancelled: true };
    mocks.request.mockResolvedValueOnce(result);
    const sender = createSender(true);

    await expect(scan(sender, undefined, "scope:9")).resolves.toBe(result);
    expect(sender.send).not.toHaveBeenCalled();
  });
});
