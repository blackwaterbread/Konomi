import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackgroundTasks } from "@core/services/background-tasks";
import { createMaintenanceService } from "@core/services/maintenance-service";
import type { CancelToken } from "@core/lib/scanner";

afterEach(() => vi.useRealTimers());

describe("header task cancellation", () => {
  it("cancels concurrent tasks and discards partial duplicate results, allowing new work", async () => {
    const tasks = createBackgroundTasks();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const signals: CancelToken[] = [];
    const work = (signal: CancelToken) => {
      signals.push(signal);
      return gate.then(() => ["partial result"]);
    };
    const duplicate = tasks.run(work);
    const metadata = tasks.run(work);
    tasks.cancel();
    expect(signals.every((signal) => signal.cancelled)).toBe(true);
    release();
    expect(await duplicate).toBeNull();
    expect(await metadata).toBeNull();
    expect(await tasks.run(async () => 3)).toBe(3);
  });

  it("stops active and queued analysis without restarting from trailing batch events", async () => {
    vi.useFakeTimers();
    let signal!: CancelToken;
    let release!: (count: number) => void;
    const computeAllHashes = vi.fn((_hash, _similarity, token) => {
      signal = token;
      return new Promise<number>((resolve) => {
        release = resolve;
      });
    });
    const send = vi.fn();
    const maintenance = createMaintenanceService({
      computeAllHashes,
      sender: { send },
    });
    const run = maintenance.runAnalysisNow();
    maintenance.scheduleAnalysis(100);
    maintenance.cancelAnalysis();
    expect(signal.cancelled).toBe(true);
    maintenance.scheduleAnalysis(0);
    release(2);
    expect(await run).toEqual({ ok: false, hashed: 2 });
    expect(send).toHaveBeenLastCalledWith("image:analysisActive", {
      active: false,
      cancelled: true,
    });
    await vi.runAllTimersAsync();
    expect(computeAllHashes).toHaveBeenCalledTimes(1);
    computeAllHashes.mockResolvedValueOnce(1);
    expect(await maintenance.runAnalysisNow()).toEqual({ ok: true, hashed: 1 });
  });
});
