import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useScanning } from "@/hooks/useScanning";
import { preloadEvents, preloadMocks } from "../helpers/preload-mocks";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useScanning", () => {
  it("tracks scan progress and folder activity during a successful scan", async () => {
    const deferred = createDeferred<{ cancelled: boolean }>();
    const schedulePageRefresh = vi.fn();
    const loadSearchPresetStats = vi.fn().mockResolvedValue(undefined);
    preloadMocks.image.scan.mockReturnValue(deferred.promise);
    localStorage.setItem("konomi-folder-order", JSON.stringify([9, 3]));

    const { result } = renderHook(() =>
      useScanning({
        schedulePageRefresh,
        loadSearchPresetStats,
      }),
    );

    let scanPromise!: Promise<{ ok: boolean; cancelled: boolean }>;
    act(() => {
      scanPromise = result.current.runScan({
        detectDuplicates: true,
        folderIds: [3],
      });
    });

    expect(result.current.scanning).toBe(true);
    expect(preloadMocks.image.scan).toHaveBeenCalledWith({
      detectDuplicates: true,
      folderIds: [3],
      orderedFolderIds: [9, 3],
    });

    act(() => {
      preloadEvents.image.scanProgress.emit({ done: 1, total: 4 });
      preloadEvents.image.scanFolder.emit({
        folderId: 3,
        folderName: "Images",
        active: true,
      });
    });

    expect(result.current.activeScanFolderIds.has(3)).toBe(true);

    deferred.resolve({ cancelled: false });
    await act(async () => {
      await scanPromise;
    });

    expect(schedulePageRefresh).toHaveBeenCalledWith(0);
    expect(loadSearchPresetStats).toHaveBeenCalledTimes(1);
    expect(result.current.scanning).toBe(false);
    expect(result.current.activeScanFolderIds.size).toBe(0);
  });

  it("cancels an active scan and raises a folder rollback request", async () => {
    vi.useFakeTimers();
    const deferred = createDeferred<{ cancelled: boolean }>();
    const schedulePageRefresh = vi.fn();
    const loadSearchPresetStats = vi.fn().mockResolvedValue(undefined);
    preloadMocks.image.scan.mockReturnValue(deferred.promise);

    const { result } = renderHook(() =>
      useScanning({
        schedulePageRefresh,
        loadSearchPresetStats,
      }),
    );

    let scanPromise!: Promise<{ ok: boolean; cancelled: boolean }>;
    act(() => {
      scanPromise = result.current.runScan();
      result.current.setRollbackFolderIds(new Set([7, 8]));
      result.current.handleCancelScan();
    });

    expect(result.current.scanCancelConfirmOpen).toBe(true);

    await act(async () => {
      const confirmPromise = result.current.confirmCancelScan();
      deferred.resolve({ cancelled: true });
      await scanPromise;
      await vi.advanceTimersByTimeAsync(50);
      await confirmPromise;
    });

    expect(preloadMocks.image.cancelScan).toHaveBeenCalledTimes(1);
    expect(schedulePageRefresh).toHaveBeenCalledWith(0);
    expect(result.current.scanCancelConfirmOpen).toBe(false);
    expect(result.current.folderRollbackRequest).toMatchObject({
      folderIds: [7, 8],
    });
  });
});
