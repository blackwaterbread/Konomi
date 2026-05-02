import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useImageEventSubscriptions,
  useImageWatchBootstrap,
} from "@/hooks/useImageWatchBootstrap";
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
    // batch calls addPendingNewIds and removed calls addPendingRemovedIds
    // (gallery shows a banner instead of auto-refreshing).
    expect(schedulePageRefresh).not.toHaveBeenCalled();
    // init(0) + batch + removed = 3
    expect(scheduleAnalysis).toHaveBeenCalledTimes(3);
    expect(scheduleSearchStatsRefresh).toHaveBeenCalledWith(180);
    expect(scheduleSearchStatsRefresh).toHaveBeenCalledWith(120);
  });

  it("forwards ids of isNew rows in visible folders to addPendingNewIds", () => {
    const addPendingNewIds = vi.fn();
    const effectiveFolderIds = new Set<number>([1, 2]);

    renderHook(() =>
      useImageEventSubscriptions({
        scheduleSearchStatsRefresh: vi.fn(),
        scanningRef: { current: false },
        rescanningRef: { current: false },
        scheduleAnalysis: vi.fn(),
        schedulePageRefresh: vi.fn(),
        addPendingNewIds,
        addPendingRemovedIds: vi.fn(),
        effectiveFolderIds,
        refreshSubfolders: vi.fn().mockResolvedValue(undefined),
      }),
    );

    act(() => {
      preloadEvents.image.batch.emit([
        createImageRow({ id: 1, folderId: 1, isNew: true }),
        createImageRow({ id: 2, folderId: 1, isNew: false }),
        createImageRow({ id: 3, folderId: 2, isNew: true }),
        // Out-of-view folder should be skipped regardless of isNew
        createImageRow({ id: 4, folderId: 99, isNew: true }),
        // Missing isNew (would mean a buggy emitter) — fail closed.
        createImageRow({ id: 5, folderId: 1 }),
      ]);
    });

    expect(addPendingNewIds).toHaveBeenCalledTimes(1);
    expect(addPendingNewIds).toHaveBeenCalledWith([1, 3]);
  });

  it("forwards image:removed ids to addPendingRemovedIds", () => {
    const addPendingRemovedIds = vi.fn();

    renderHook(() =>
      useImageEventSubscriptions({
        scheduleSearchStatsRefresh: vi.fn(),
        scanningRef: { current: false },
        rescanningRef: { current: false },
        scheduleAnalysis: vi.fn(),
        schedulePageRefresh: vi.fn(),
        addPendingNewIds: vi.fn(),
        addPendingRemovedIds,
        effectiveFolderIds: new Set<number>([1]),
        refreshSubfolders: vi.fn().mockResolvedValue(undefined),
      }),
    );

    act(() => {
      preloadEvents.image.removed.emit([11, 12, 13]);
    });

    expect(addPendingRemovedIds).toHaveBeenCalledTimes(1);
    expect(addPendingRemovedIds).toHaveBeenCalledWith([11, 12, 13]);
  });

  it("debounces refreshSubfolders across rapid batch/removed events into one call", async () => {
    vi.useFakeTimers();
    try {
      const refreshSubfolders = vi.fn().mockResolvedValue(undefined);
      const effectiveFolderIds = new Set<number>([1, 2]);

      renderHook(() =>
        useImageEventSubscriptions({
          scheduleSearchStatsRefresh: vi.fn(),
          scanningRef: { current: false },
          rescanningRef: { current: false },
          scheduleAnalysis: vi.fn(),
          schedulePageRefresh: vi.fn(),
          addPendingNewIds: vi.fn(),
          addPendingRemovedIds: vi.fn(),
          effectiveFolderIds,
          refreshSubfolders,
        }),
      );

      act(() => {
        preloadEvents.image.batch.emit([createImageRow({ id: 1, folderId: 1 })]);
        preloadEvents.image.batch.emit([createImageRow({ id: 2, folderId: 1 })]);
        preloadEvents.image.batch.emit([createImageRow({ id: 3, folderId: 2 })]);
        preloadEvents.image.removed.emit([11]);
        preloadEvents.image.removed.emit([12]);
      });

      // Within the debounce window, refreshSubfolders must not have fired
      expect(refreshSubfolders).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      // All five events collapse into a single refreshSubfolders call
      expect(refreshSubfolders).toHaveBeenCalledTimes(1);
      const [folderIds, options] = refreshSubfolders.mock.calls[0];
      expect(new Set(folderIds as number[])).toEqual(new Set([1, 2]));
      // allowEmpty must propagate when any event in the window requested it
      // (removed events do — subfolder can be fully emptied by deletion).
      expect(options).toEqual({ allowEmpty: true });
    } finally {
      vi.useRealTimers();
    }
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
