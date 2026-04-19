import { describe, expect, it, vi } from "vitest";
import { createWebSocketSender } from "../../../src/server/sender";
import type { WebSocket } from "ws";

const OPEN = 1;
const CLOSED = 3;

type MockSocket = {
  readyState: number;
  OPEN: number;
  send: ReturnType<typeof vi.fn>;
};

function mockSocket(readyState: number): MockSocket {
  return { readyState, OPEN, send: vi.fn() };
}

function makeSender(sockets: MockSocket[]) {
  const set = new Set(sockets as unknown as WebSocket[]);
  return {
    sender: createWebSocketSender(() => set),
    sockets,
  };
}

describe("createWebSocketSender", () => {
  it("broadcasts serialized { event, data } to all OPEN clients", () => {
    const { sender, sockets } = makeSender([
      mockSocket(OPEN),
      mockSocket(OPEN),
    ]);

    sender.send("image:batch", { rows: [{ id: 1 }] });

    const expected = JSON.stringify({
      event: "image:batch",
      data: { rows: [{ id: 1 }] },
    });
    expect(sockets[0].send).toHaveBeenCalledWith(expected);
    expect(sockets[1].send).toHaveBeenCalledWith(expected);
  });

  it("skips clients that are not OPEN", () => {
    const open = mockSocket(OPEN);
    const closed = mockSocket(CLOSED);
    const { sender } = makeSender([open, closed]);

    sender.send("image:scanProgress", { done: 1, total: 10 });

    expect(open.send).toHaveBeenCalledTimes(1);
    expect(closed.send).not.toHaveBeenCalled();
  });

  it("reads the client set lazily so late connections receive later events", () => {
    const a = mockSocket(OPEN);
    const b = mockSocket(OPEN);
    const clients = new Set<WebSocket>([a as unknown as WebSocket]);
    const sender = createWebSocketSender(() => clients);

    sender.send("evt", 1);
    clients.add(b as unknown as WebSocket);
    sender.send("evt", 2);

    expect(a.send).toHaveBeenCalledTimes(2);
    expect(b.send).toHaveBeenCalledTimes(1);
    expect(b.send).toHaveBeenCalledWith(JSON.stringify({ event: "evt", data: 2 }));
  });

  it("does nothing when there are no clients", () => {
    const { sender } = makeSender([]);
    expect(() => sender.send("evt", { x: 1 })).not.toThrow();
  });
});
