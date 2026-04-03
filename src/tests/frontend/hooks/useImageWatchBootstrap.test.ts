import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useImageWatchBootstrap } from "@/hooks/useImageWatchBootstrap";
import { createImageRow } from "../helpers/image-row";
import { preloadEvents, preloadMocks } from "../helpers/preload-mocks";

describe("useImageWatchBootstrap", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("retries watcher startup with backoff and stops retrying after unmount", async () => {
    vi.useFakeTimers();
    preloadMocks.image.watch
      .mockRejectedValueOnce(new Error("watch failed"))
      .mockResolvedValueOnce(undefined);

    const unmountScheduleAnalysis = vi.fn();
    const { unmount } = renderHook(() =>
      useImageWatchBootstrap({
        loadSearchPresetStats: vi.fn().mockResolvedValue(undefined),
        scheduleSearchStatsRefresh: vi.fn(),
        handleSearchStatsProgress: vi.fn(),
        scanningRef: { current: false },
        scanStartCountRef: { current: 0 },
        scheduleAnalysis: unmountScheduleAnalysis,
        schedulePageRefresh: vi.fn(),
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(preloadMocks.image.watch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(preloadMocks.image.watch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(preloadMocks.image.watch).toHaveBeenCalledTimes(2);
    expect(unmountScheduleAnalysis).toHaveBeenCalledWith(0);

    preloadMocks.image.watch
      .mockReset()
      .mockRejectedValueOnce(new Error("watch failed again"));

    const { unmount: unmountBeforeRetry } = renderHook(() =>
      useImageWatchBootstrap({
        loadSearchPresetStats: vi.fn().mockResolvedValue(undefined),
        scheduleSearchStatsRefresh: vi.fn(),
        handleSearchStatsProgress: vi.fn(),
        scanningRef: { current: false },
        scanStartCountRef: { current: 0 },
        scheduleAnalysis: vi.fn(),
        schedulePageRefresh: vi.fn(),
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(preloadMocks.image.watch).toHaveBeenCalledTimes(1);

    unmountBeforeRetry();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(preloadMocks.image.watch).toHaveBeenCalledTimes(1);

    unmount();
  });

  it("boots watchers and reacts to batch, removed, and stats progress events", async () => {
    const loadSearchPresetStats = vi.fn().mockResolvedValue(undefined);
    const scheduleSearchStatsRefresh = vi.fn();
    const handleSearchStatsProgress = vi.fn();
    const scheduleAnalysis = vi.fn();
    const schedulePageRefresh = vi.fn();
    const scanningRef = { current: false };

    renderHook(() =>
      useImageWatchBootstrap({
        loadSearchPresetStats,
        scheduleSearchStatsRefresh,
        handleSearchStatsProgress,
        scanningRef,
        scanStartCountRef: { current: 0 },
        scheduleAnalysis,
        schedulePageRefresh,
      }),
    );

    await waitFor(() => expect(loadSearchPresetStats).toHaveBeenCalledTimes(1));
    expect(scheduleAnalysis).toHaveBeenCalledWith(0);
    expect(preloadMocks.image.watch).toHaveBeenCalledTimes(1);

    act(() => {
      preloadEvents.image.batch.emit([]);
      preloadEvents.image.batch.emit([createImageRow({ id: 1 })]);
      preloadEvents.image.removed.emit([11, 12]);
      preloadEvents.image.searchStatsProgress.emit({ done: 2, total: 3 });
    });

    expect(schedulePageRefresh).toHaveBeenCalledWith(150);
    expect(schedulePageRefresh).toHaveBeenCalledWith(60);
    expect(scheduleAnalysis).toHaveBeenCalledTimes(3);
    expect(scheduleSearchStatsRefresh).toHaveBeenCalledWith(180);
    expect(scheduleSearchStatsRefresh).toHaveBeenCalledWith(120);
    expect(handleSearchStatsProgress).toHaveBeenCalledWith({
      done: 2,
      total: 3,
    });
  });

  it("uses immediate refresh for the first scan batch, then slower for subsequent", async () => {
    const scheduleSearchStatsRefresh = vi.fn();
    const scheduleAnalysis = vi.fn();
    const schedulePageRefresh = vi.fn();

    renderHook(() =>
      useImageWatchBootstrap({
        loadSearchPresetStats: vi.fn().mockResolvedValue(undefined),
        scheduleSearchStatsRefresh,
        handleSearchStatsProgress: vi.fn(),
        scanningRef: { current: true },
        scanStartCountRef: { current: 1 },
        scheduleAnalysis,
        schedulePageRefresh,
      }),
    );

    // First batch during scan → immediate refresh
    act(() => {
      preloadEvents.image.batch.emit([createImageRow({ id: 1 })]);
    });

    expect(schedulePageRefresh).toHaveBeenCalledWith(0);
    expect(scheduleAnalysis).toHaveBeenCalledTimes(1);
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
