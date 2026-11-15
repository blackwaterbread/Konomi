import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeChild = {
  posted: Array<Record<string, unknown>>;
  emit: (event: string, ...args: unknown[]) => boolean;
};

const mocks = vi.hoisted(() => ({ children: [] as FakeChild[] }));

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeUtilityProcess extends EventEmitter {
    posted: Array<Record<string, unknown>> = [];
    postMessage(message: Record<string, unknown>): void {
      this.posted.push(message);
    }
    kill(): void {
      // Nothing to stop: the fake has no process behind it.
    }
  }
  return {
    app: {
      getPath: () => "userData",
      getAppPath: () => "app",
      isPackaged: false,
    },
    utilityProcess: {
      fork: () => {
        const child = new FakeUtilityProcess();
        mocks.children.push(child);
        return child;
      },
    },
  };
});

vi.mock("@core/lib/logger", () => ({
  createLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    errorWithStack: () => {},
  }),
}));

const originalTimeoutEnv = process.env.KONOMI_BRIDGE_TIMEOUT_MS;
let stopBridge: (() => void) | null = null;

/** A fresh bridge module: `requestTimeoutMs` is read from the env at load. */
async function startBridge(timeoutEnv: string) {
  vi.resetModules();
  mocks.children.length = 0;
  process.env.KONOMI_BRIDGE_TIMEOUT_MS = timeoutEnv;
  const { bridge } = await import("../../../src/app/main/bridge");
  bridge.start("utility.js");
  stopBridge = () => bridge.stop();
  return { bridge, child: mocks.children[0] };
}

function track(promise: Promise<unknown>) {
  const state: { settled: boolean; value?: unknown; error?: unknown } = {
    settled: false,
  };
  promise.then(
    (value) => Object.assign(state, { settled: true, value }),
    (error: unknown) => Object.assign(state, { settled: true, error }),
  );
  return state;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  stopBridge?.();
  stopBridge = null;
  vi.useRealTimers();
  if (originalTimeoutEnv === undefined) {
    delete process.env.KONOMI_BRIDGE_TIMEOUT_MS;
  } else {
    process.env.KONOMI_BRIDGE_TIMEOUT_MS = originalTimeoutEnv;
  }
});

describe("UtilityBridge request timeouts", () => {
  it("times a request without an override out at the configured timeout", async () => {
    const { bridge } = await startBridge("5000");
    const reply = track(bridge.request("folder:list"));

    await vi.advanceTimersByTimeAsync(4_999);
    expect(reply.settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(String(reply.error)).toContain(
      "timed out after 5000ms: folder:list",
    );
  });

  it("restarts the configured timeout from the ack", async () => {
    const { bridge, child } = await startBridge("5000");
    const reply = track(bridge.request("folder:list"));

    await vi.advanceTimersByTimeAsync(3_000);
    child.emit("message", { id: child.posted[0].id, ack: true });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(reply.settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(String(reply.error)).toContain("timed out after 5000ms");
  });

  it("never times out a request sent with an explicit 0, and still resolves on its reply", async () => {
    const { bridge, child } = await startBridge("5000");
    const reply = track(bridge.request("db:runMigrations", undefined, 0));
    const { id } = child.posted[0];

    child.emit("message", { id, ack: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reply.settled).toBe(false);

    child.emit("message", { id, result: "migrated" });
    await vi.advanceTimersByTimeAsync(0);
    expect(reply).toEqual({ settled: true, value: "migrated" });
  });

  it("rejects a request sent with an explicit 0 when the utility exits", async () => {
    const { bridge, child } = await startBridge("5000");
    const reply = track(bridge.request("db:runMigrations", undefined, 0));

    child.emit("exit", 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(String(reply.error)).toContain(
      "Utility process exited unexpectedly",
    );
  });
});
