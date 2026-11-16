import { beforeEach, describe, expect, it, vi } from "vitest";

// The POST reply and the WebSocket frames travel separately, so each test
// fixes one interleaving: `push` delivers a frame, `reply` resolves the POST.

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
}

const fetchMock = vi.fn();

async function setup() {
  vi.resetModules();
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("fetch", fetchMock);
  const mod = await import("@/browser-api");
  mod.connectWebSocket();

  let reply!: (body: unknown) => void;
  fetchMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        reply = (body) =>
          resolve({
            ok: true,
            status: 200,
            text: async () => JSON.stringify(body),
          });
      }),
  );

  const push = (event: string, data: unknown) =>
    FakeWebSocket.instances.at(-1)!.onmessage!({
      data: JSON.stringify({ event, data }),
    });
  // A reconnect: the server's hello frame arrives on a fresh socket.
  const reconnect = () => mod.connectWebSocket();

  const api = mod.createBrowserApi();
  const scan = (options?: Parameters<typeof api.image.scan>[0]) => {
    const state: { settled: boolean; value?: { cancelled: boolean } } = {
      settled: false,
    };
    void api.image.scan(options).then((value) => {
      state.settled = true;
      state.value = value;
    });
    return state;
  };

  return { scan, push, reconnect, reply: (body: unknown) => reply(body) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const K = 1_000;

beforeEach(() => {
  fetchMock.mockReset();
});

describe("browser-api image.scan", () => {
  it("resolves when its scan finished before the POST reply arrived", async () => {
    const { scan, push, reply } = await setup();
    const result = scan();

    push("image:scanActive", { active: true, scanId: K });
    push("image:scanComplete", { cancelled: false });
    push("image:scanActive", { active: false, scanId: K });
    reply({ started: true, scanId: K });
    await flush();

    expect(result).toEqual({ settled: true, value: { cancelled: false } });
  });

  it("ignores a late frame from before its scan started", async () => {
    const { scan, push, reply } = await setup();
    const result = scan();

    reply({ started: true, scanId: K });
    await flush();
    // The previous scan's end (or a hello sent before this request reached
    // the server), delivered after the reply.
    push("image:scanComplete", { cancelled: true });
    push("image:scanActive", { active: false, scanId: K - 1 });
    push("image:scanActive", { active: true, scanId: K });
    await flush();
    expect(result.settled).toBe(false);

    push("image:scanComplete", { cancelled: false });
    push("image:scanActive", { active: false, scanId: K });
    await flush();
    expect(result).toEqual({ settled: true, value: { cancelled: false } });
  });

  it("waits for the scan that holds the lock when the request is rejected as busy", async () => {
    const { scan, push, reply } = await setup();
    const result = scan({ subPaths: ["/images/a/sub"] });

    // An earlier scan ends while the request is in flight; another scan took
    // the lock before the request reached the server.
    push("image:scanActive", { active: false, scanId: K - 1 });
    reply({
      started: false,
      alreadyRunning: true,
      scanId: K,
      busySubPaths: ["/images/a/sub"],
    });
    await flush();
    expect(result.settled).toBe(false);

    push("image:scanActive", { active: true, scanId: K });
    push("image:scanComplete", { cancelled: true });
    push("image:scanActive", { active: false, scanId: K });
    await flush();
    expect(result).toEqual({ settled: true, value: { cancelled: true } });
  });

  it("resolves from a reconnect hello once a newer scan is running", async () => {
    const { scan, push, reconnect, reply } = await setup();
    const result = scan();

    reply({ started: true, scanId: K });
    push("image:scanActive", { active: true, scanId: K });
    await flush();

    // Socket drops; the scan is still running at the first reconnect.
    reconnect();
    push("image:scanActive", { active: true, scanId: K });
    await flush();
    expect(result.settled).toBe(false);

    // It ended while the socket was down again, and another scan started.
    reconnect();
    push("image:scanActive", { active: true, scanId: K + 1 });
    await flush();
    expect(result).toEqual({ settled: true, value: { cancelled: false } });
  });
});
