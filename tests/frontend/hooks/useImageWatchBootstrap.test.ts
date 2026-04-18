import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useImageWatchBootstrap } from "@/hooks/useImageWatchBootstrap";
import { createImageRow } from "../helpers/image-row";
import { preloadEvents } from "../helpers/preload-mocks";

describe("useImageWatchBootstrap", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("boots watchers and reacts to batch and removed events", async () => {
    const loadSearchPresetStats = vi.fn().mockResolvedValue(undefined);
    const scheduleSearchStatsRefresh = vi.fn();
    const scheduleAnalysis = vi.fn();
    const schedulePageRefresh = vi.fn();
    const scanningRef = { current: false };

    renderHook(() =>
      useImageWatchBootstrap({
        loadSearchPresetStats,
        scheduleSearchStatsRefresh,
        scanningRef,
        rescanningRef: { current: false },
        scheduleAnalysis,
        schedulePageRefresh,
        runScan: vi.fn().mockResolvedValue(true),
      }),
    );

    await waitFor(() => expect(scheduleAnalysis).toHaveBeenCalledWith(0));

    // runAppInitialization sets scanningRef.current = true; reset it so
    // batch/removed events are processed as post-scan watcher events.
    scanningRef.current = false;

    act(() => {
      preloadEvents.image.batch.emit([]);
      preloadEvents.image.batch.emit([createImageRow({ id: 1 })]);
      preloadEvents.image.removed.emit([11, 12]);
    });

    // Neither batch nor removed events trigger schedulePageRefresh anymore —
    // batch calls incrementPendingNew and removed calls incrementPendingRemoved
    // (gallery shows a banner instead of auto-refreshing).
    expect(schedulePageRefresh).not.toHaveBeenCalled();
    // init(0) + batch + removed = 3
    expect(scheduleAnalysis).toHaveBeenCalledTimes(3);
    expect(scheduleSearchStatsRefresh).toHaveBeenCalledWith(180);
    expect(scheduleSearchStatsRefresh).toHaveBeenCalledWith(120);
  });

  it("skips gallery refresh during scan to avoid IO contention", async () => {
    const scheduleSearchStatsRefresh = vi.fn();
    const scheduleAnalysis = vi.fn();
    const schedulePageRefresh = vi.fn();

    renderHook(() =>
      useImageWatchBootstrap({
        loadSearchPresetStats: vi.fn().mockResolvedValue(undefined),
        scheduleSearchStatsRefresh,

        scanningRef: { current: true },
        rescanningRef: { current: false },
        scheduleAnalysis,
        schedulePageRefresh,
        runScan: vi.fn().mockResolvedValue(true),
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Batches during scan should NOT trigger gallery refresh
    act(() => {
      preloadEvents.image.batch.emit([createImageRow({ id: 1 })]);
      preloadEvents.image.batch.emit([createImageRow({ id: 2 })]);
    });

    expect(schedulePageRefresh).not.toHaveBeenCalled();
    expect(scheduleSearchStatsRefresh).not.toHaveBeenCalled();
  });
});
