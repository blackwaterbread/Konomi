import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (event: unknown, ...args: unknown[]) => void;

const mocks = vi.hoisted(() => ({
  exposed: {} as Record<string, unknown>,
  listeners: new Map<string, Set<Listener>>(),
  invoke: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, api: unknown) => {
      mocks.exposed[key] = api;
    },
  },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: (channel: string, listener: Listener) => {
      let set = mocks.listeners.get(channel);
      if (!set) {
        set = new Set();
        mocks.listeners.set(channel, set);
      }
      set.add(listener);
    },
    removeListener: (channel: string, listener: Listener) => {
      mocks.listeners.get(channel)?.delete(listener);
    },
  },
  webFrame: { clearCache: () => {} },
}));

import "../../../src/app/preload/index";

type ScanResult = { cancelled: boolean; skippedSubPaths?: string[] };

function scan(options?: { folderIds?: number[] }): Promise<ScanResult> {
  const api = mocks.exposed.image as {
    scan: (options?: { folderIds?: number[] }) => Promise<ScanResult>;
  };
  return api.scan(options);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function track<T>(promise: Promise<T>) {
  const state: { settled: boolean; value?: T; error?: unknown } = {
    settled: false,
  };
  promise.then(
    (value) => {
      state.settled = true;
      state.value = value;
    },
    (error: unknown) => {
      state.settled = true;
      state.error = error;
    },
  );
  return state;
}

function startScan(options?: { folderIds?: number[] }) {
  const reply = deferred<ScanResult>();
  mocks.invoke.mockReturnValueOnce(reply.promise);
  const state = track(scan(options));
  const call = mocks.invoke.mock.calls.at(-1)!;
  return { reply, state, requestId: call[2] as unknown, call };
}

function pushSettled(requestId: unknown): void {
  for (const listener of [
    ...(mocks.listeners.get("image:scanSettled") ?? []),
  ]) {
    listener({}, requestId);
  }
}

const settledListeners = () =>
  mocks.listeners.get("image:scanSettled")?.size ?? 0;

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  mocks.listeners.clear();
});

describe("preload image.scan", () => {
  it("holds the reply until the settled push for the request arrives", async () => {
    const result = { cancelled: false, skippedSubPaths: [] };
    const { reply, state, requestId, call } = startScan({ folderIds: [3] });
    expect(call).toEqual(["image:scan", { folderIds: [3] }, requestId]);

    reply.resolve(result);
    await flush();
    expect(state.settled).toBe(false);

    pushSettled(requestId);
    await flush();
    expect(state.value).toBe(result);
    expect(settledListeners()).toBe(0);
  });

  it("resolves with the reply once it arrives after the settled push", async () => {
    const result = { cancelled: true };
    const { reply, state, requestId } = startScan();

    pushSettled(requestId);
    await flush();
    expect(state.settled).toBe(false);

    reply.resolve(result);
    await flush();
    expect(state.value).toBe(result);
    expect(settledListeners()).toBe(0);
  });

  it("rejects as soon as the request fails, without waiting for a push", async () => {
    const error = new Error("Utility process exited unexpectedly (code: 1)");
    const { reply, state } = startScan();

    reply.reject(error);
    await flush();
    expect(state.error).toBe(error);
    expect(settledListeners()).toBe(0);
  });

  it("does not settle a scan on another request's push", async () => {
    const first = startScan();
    const second = startScan();
    expect(first.requestId).not.toBe(second.requestId);

    first.reply.resolve({ cancelled: false });
    second.reply.resolve({ cancelled: false });
    pushSettled(second.requestId);
    await flush();
    expect(second.state.settled).toBe(true);
    expect(first.state.settled).toBe(false);

    pushSettled(first.requestId);
    await flush();
    expect(first.state.settled).toBe(true);
    expect(settledListeners()).toBe(0);
  });
});
