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
        scanStartCountRef: { current: 0 },
        rescanningRef: { current: false },
        scheduleAnalysis,
        schedulePageRefresh,
        runScan: vi.fn().mockResolvedValue(true),
      }),
    );

    await waitFor(() => expect(loadSearchPresetStats).toHaveBeenCalledTimes(1));
    expect(scheduleAnalysis).toHaveBeenCalledWith(0);

    act(() => {
      preloadEvents.image.batch.emit([]);
      preloadEvents.image.batch.emit([createImageRow({ id: 1 })]);
      preloadEvents.image.removed.emit([11, 12]);
    });

    expect(schedulePageRefresh).toHaveBeenCalledWith(150);
    expect(schedulePageRefresh).toHaveBeenCalledWith(60);
    expect(scheduleAnalysis).toHaveBeenCalledTimes(3);
    expect(scheduleSearchStatsRefresh).toHaveBeenCalledWith(180);
    expect(scheduleSearchStatsRefresh).toHaveBeenCalledWith(120);
  });

  it("uses immediate refresh for the first scan batch, then slower for subsequent", async () => {
    const scheduleSearchStatsRefresh = vi.fn();
    const scheduleAnalysis = vi.fn();
    const schedulePageRefresh = vi.fn();

    renderHook(() =>
      useImageWatchBootstrap({
        loadSearchPresetStats: vi.fn().mockResolvedValue(undefined),
        scheduleSearchStatsRefresh,

        scanningRef: { current: true },
        scanStartCountRef: { current: 1 },
        rescanningRef: { current: false },
        scheduleAnalysis,
        schedulePageRefresh,
        runScan: vi.fn().mockResolvedValue(true),
      }),
    );

    // Wait for the initial async chain (quickVerify → runScan → scheduleAnalysis)
    await act(async () => {
      await Promise.resolve();
    });

    // scheduleAnalysis called once during initial setup (runScan().then)
    const setupCallCount = scheduleAnalysis.mock.calls.length;

    // First batch during scan → immediate refresh
    act(() => {
      preloadEvents.image.batch.emit([createImageRow({ id: 1 })]);
    });

    expect(schedulePageRefresh).toHaveBeenCalledWith(0);
    // Batch handler during scan does not call scheduleAnalysis
    expect(scheduleAnalysis).toHaveBeenCalledTimes(setupCallCount);
    expect(scheduleSearchStatsRefresh).not.toHaveBeenCalled();

    schedulePageRefresh.mockClear();

    // Second batch during scan → debounced refresh
    act(() => {
      preloadEvents.image.batch.emit([createImageRow({ id: 2 })]);
    });

    // 두 번째 배치는 스로틀 경로 — 0보다 큰 지연값으로 호출되어야 한다
    expect(schedulePageRefresh).toHaveBeenCalledTimes(1);
    expect(schedulePageRefresh.mock.calls[0][0]).toBeGreaterThan(0);
  });
});
