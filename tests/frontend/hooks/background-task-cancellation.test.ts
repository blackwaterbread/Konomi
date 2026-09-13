import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { cancelBackgroundTaskContinuations } from "@/lib/background-task-cancellation";
import { runAppInitialization } from "@/hooks/useImageWatchBootstrap";
import { useDuplicateResolutionDialog } from "@/hooks/useDuplicateResolutionDialog";
import { useImageAnalysis } from "@/hooks/useImageAnalysis";
import { DEFAULTS } from "@/hooks/useSettings";
import { preloadEvents, preloadMocks } from "../helpers/preload-mocks";

describe("cancelled background task continuations", () => {
  it("does not start a cache rebuild when analysis completes after X", async () => {
    renderHook(() => useImageAnalysis({ scanningRef: { current: false }, settings: DEFAULTS }));
    act(() => { preloadEvents.image.analysisActive.emit({ active: true }); });
    cancelBackgroundTaskContinuations();
    await act(async () => { preloadEvents.image.analysisActive.emit({ active: false }); });
    expect(preloadMocks.image.similarGroups).not.toHaveBeenCalled();
  });
  it("does not start a boot scan after cancellation during quick verify", async () => {
    let release!: (value: {
      changedFolderIds: number[];
      unchangedFolderIds: number[];
    }) => void;
    preloadMocks.image.quickVerify.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const runScan = vi.fn();
    const setScanning = vi.fn();
    const onInitialRefreshDone = vi.fn();
    const scanningRef = { current: false };
    runAppInitialization({
      loadSearchPresetStats: vi.fn(),
      runScan,
      setScanning,
      scanningRef,
      onInitialRefreshDone,
    });
    cancelBackgroundTaskContinuations();
    release({ changedFolderIds: [1], unchangedFolderIds: [] });
    await act(async () => {});
    expect(runScan).not.toHaveBeenCalled();
    expect(scanningRef.current).toBe(false);
    expect(onInitialRefreshDone).toHaveBeenCalledOnce();
  });

  it("does not start a rescan from a late duplicate response after X", async () => {
    let release!: (value: []) => void;
    preloadMocks.folder.findDuplicates.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const onSubfolderRescan = vi.fn();
    const { result } = renderHook(() =>
      useDuplicateResolutionDialog({ addFolder: vi.fn(), onSubfolderRescan }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.handleSubfolderRescanWithDuplicateCheck(
        1,
        "/images/sub",
      );
    });
    cancelBackgroundTaskContinuations();
    release([]);
    await act(async () => {
      await pending;
    });
    expect(onSubfolderRescan).not.toHaveBeenCalled();
    expect(result.current.checkingDuplicates).toBe(false);
  });

  it("does not treat a backend-cancelled duplicate check as an empty successful result", async () => {
    preloadMocks.folder.findDuplicates.mockResolvedValue(null);
    const onSubfolderRescan = vi.fn();
    const { result } = renderHook(() =>
      useDuplicateResolutionDialog({ addFolder: vi.fn(), onSubfolderRescan }),
    );
    await act(async () => {
      await result.current.handleSubfolderRescanWithDuplicateCheck(
        1,
        "/images/sub",
      );
    });
    expect(onSubfolderRescan).not.toHaveBeenCalled();
    expect(result.current.checkingDuplicates).toBe(false);
  });
});
