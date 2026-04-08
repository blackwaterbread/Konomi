import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useImageEventSubscriptions } from "@/hooks/useImageWatchBootstrap";
import { createImageRow } from "../helpers/image-row";
import { preloadEvents } from "../helpers/preload-mocks";

describe("useImageEventSubscriptions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("accumulates pending changes from batch and removed events", async () => {
    const scheduleSearchStatsRefresh = vi.fn();
    const scheduleAnalysis = vi.fn();
    const addPendingChanges = vi.fn();
    const scanningRef = { current: false };

    renderHook(() =>
      useImageEventSubscriptions({
        scheduleSearchStatsRefresh,
        scanningRef,
        scanStartCountRef: { current: 0 },
        rescanningRef: { current: false },
        scheduleAnalysis,
        addPendingChanges,
      }),
    );

    act(() => {
      preloadEvents.image.batch.emit([]);
      preloadEvents.image.batch.emit([createImageRow({ id: 1 })]);
      preloadEvents.image.removed.emit([11, 12]);
    });

    // Empty batch ignored
    expect(addPendingChanges).toHaveBeenCalledTimes(2);
    expect(addPendingChanges).toHaveBeenCalledWith(1, 0, 1);
    expect(addPendingChanges).toHaveBeenCalledWith(0, 2);
    expect(scheduleAnalysis).toHaveBeenCalledTimes(2);
    expect(scheduleSearchStatsRefresh).toHaveBeenCalledWith(180);
    expect(scheduleSearchStatsRefresh).toHaveBeenCalledWith(120);
  });

  it("accumulates pending changes during scan without scheduling analysis", async () => {
    const scheduleSearchStatsRefresh = vi.fn();
    const scheduleAnalysis = vi.fn();
    const addPendingChanges = vi.fn();

    renderHook(() =>
      useImageEventSubscriptions({
        scheduleSearchStatsRefresh,
        scanningRef: { current: true },
        scanStartCountRef: { current: 1 },
        rescanningRef: { current: false },
        scheduleAnalysis,
        addPendingChanges,
      }),
    );

    act(() => {
      preloadEvents.image.batch.emit([createImageRow({ id: 1 })]);
      preloadEvents.image.batch.emit([createImageRow({ id: 2 })]);
    });

    expect(addPendingChanges).toHaveBeenCalledTimes(2);
    expect(addPendingChanges).toHaveBeenCalledWith(1, 0, 1);
    // During scan, analysis and search stats are not scheduled
    expect(scheduleAnalysis).not.toHaveBeenCalled();
    expect(scheduleSearchStatsRefresh).not.toHaveBeenCalled();
  });
});
