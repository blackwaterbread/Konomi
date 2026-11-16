import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/server/db", () => ({
  getDB: () => ({}),
}));
// services.ts imports `bun:sqlite`, which the node test runner lacks.
vi.mock("bun:sqlite", () => ({ Database: class {} }));

type Event = { channel: string; data: any };

let app: FastifyInstance;
let events: Event[];
let finishScan: () => void;

beforeEach(async () => {
  events = [];
  const { createServices } = await import("../../../src/server/services");
  const { registerImageRoutes } =
    await import("../../../src/server/routes/image");
  const services = createServices({
    send: (channel, data) => events.push({ channel, data }),
  });
  services.scanService = {
    scanAll: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishScan = resolve;
        }),
    ),
  } as unknown as typeof services.scanService;
  services.maintenanceService = {
    resumeAnalysis: vi.fn(),
    scheduleAnalysis: vi.fn(),
  } as unknown as typeof services.maintenanceService;
  app = Fastify({ logger: false });
  registerImageRoutes(app, services);
});

afterEach(async () => {
  await app.close();
});

const post = async (body: Record<string, unknown>) =>
  (
    await app.inject({ method: "POST", url: "/api/images/scan", payload: body })
  ).json();
const activeEvents = () =>
  events.filter((e) => e.channel === "image:scanActive").map((e) => e.data);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("POST /api/images/scan", () => {
  it("names in its reply the scan id that the scan's scanActive frames carry", async () => {
    const first = await post({});
    expect(first).toEqual({ started: true, scanId: expect.any(Number) });
    const id = first.scanId as number;
    expect(activeEvents()).toEqual([{ active: true, scanId: id }]);

    // A request while it runs is pointed at the running scan.
    await expect(post({ subPaths: ["/images/a/sub"] })).resolves.toEqual({
      started: false,
      alreadyRunning: true,
      scanId: id,
      busySubPaths: ["/images/a/sub"],
    });

    finishScan();
    await settle();
    expect(activeEvents()).toEqual([
      { active: true, scanId: id },
      { active: false, scanId: id },
    ]);

    // The next scan takes a newer id.
    const second = await post({});
    expect(second).toEqual({ started: true, scanId: id + 1 });
    expect(activeEvents().at(-1)).toEqual({ active: true, scanId: id + 1 });
    finishScan();
    await settle();
  });
});
