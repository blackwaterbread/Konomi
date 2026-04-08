import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useImageEventSubscriptions } from "@/hooks/useImageWatchBootstrap";
import { createImageRow } from "../helpers/image-row";
import { preloadEvents, preloadMocks } from "../helpers/preload-mocks";

describe("useImageEventSubscriptions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("retries watcher startup with backoff and stops retrying after unmount", async () => {
    vi.useFakeTimers();
    preloadMocks.image.watch
      .mockRejectedValueOnce(new Error("watch failed"))
      .mockResolvedValueOnce(undefined);

    const { unmount } = renderHook(() =>
      useImageEventSubscriptions({
        scheduleSearchStatsRefresh: vi.fn(),
        scanningRef: { current: false },
        scanStartCountRef: { current: 0 },
        rescanningRef: { current: false },
        scheduleAnalysis: vi.fn(),
        addPendingChanges: vi.fn(),
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

    preloadMocks.image.watch
      .mockReset()
      .mockRejectedValueOnce(new Error("watch failed again"));

    const { unmount: unmountBeforeRetry } = renderHook(() =>
      useImageEventSubscriptions({
        scheduleSearchStatsRefresh: vi.fn(),
        scanningRef: { current: false },
        scanStartCountRef: { current: 0 },
        rescanningRef: { current: false },
        scheduleAnalysis: vi.fn(),
        addPendingChanges: vi.fn(),
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

    await act(async () => {
      await Promise.resolve();
    });

    expect(preloadMocks.image.watch).toHaveBeenCalledTimes(1);

    act(() => {
      preloadEvents.image.batch.emit([]);
      preloadEvents.image.batch.emit([createImageRow({ id: 1 })]);
      preloadEvents.image.removed.emit([11, 12]);
    });

    // Empty batch ignored
    expect(addPendingChanges).toHaveBeenCalledTimes(2);
    expect(addPendingChanges).toHaveBeenCalledWith(1, 0);
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

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      preloadEvents.image.batch.emit([createImageRow({ id: 1 })]);
      preloadEvents.image.batch.emit([createImageRow({ id: 2 })]);
    });

    expect(addPendingChanges).toHaveBeenCalledTimes(2);
    expect(addPendingChanges).toHaveBeenCalledWith(1, 0);
    // During scan, analysis and search stats are not scheduled
    expect(scheduleAnalysis).not.toHaveBeenCalled();
    expect(scheduleSearchStatsRefresh).not.toHaveBeenCalled();
  });
});
