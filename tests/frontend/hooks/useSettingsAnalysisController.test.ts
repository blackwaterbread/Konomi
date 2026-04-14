import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { useSettingsAnalysisController } from "@/hooks/useSettingsAnalysisController";
import { preloadMocks } from "../helpers/preload-mocks";

describe("useSettingsAnalysisController", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("marks pending similarity recalculation only for similarity-related updates and resets", () => {
    const updateSettings = vi.fn();
    const resetSettings = vi.fn();
    const pendingSimilarityRecalcRef = { current: false };

    const { result } = renderHook(() =>
      useSettingsAnalysisController({
        updateSettings,
        resetSettings,
        scanningRef: { current: false },
        analyzeTimerRef: { current: null },
        pendingSimilarityRecalcRef,
        suspendAutoAnalysisRef: { current: false },
        runAnalysisNow: vi.fn().mockResolvedValue(true),
      }),
    );

    act(() => {
      result.current.handleSettingsUpdate({ theme: "white" });
    });

    expect(updateSettings).toHaveBeenCalledWith({ theme: "white" });
    expect(pendingSimilarityRecalcRef.current).toBe(false);

    act(() => {
      result.current.handleSettingsUpdate({ similarityThreshold: 15 });
    });

    expect(updateSettings).toHaveBeenCalledWith({ similarityThreshold: 15 });
    expect(pendingSimilarityRecalcRef.current).toBe(true);

    pendingSimilarityRecalcRef.current = false;

    act(() => {
      result.current.handleSettingsReset(["theme"]);
    });

    expect(resetSettings).toHaveBeenCalledWith(["theme"]);
    expect(pendingSimilarityRecalcRef.current).toBe(false);

    act(() => {
      result.current.handleSettingsReset(["visualSimilarityThreshold"]);
    });

    expect(resetSettings).toHaveBeenCalledWith(["visualSimilarityThreshold"]);
    expect(pendingSimilarityRecalcRef.current).toBe(true);
  });

  it("resets hashes and reruns analysis when scanning is idle", async () => {
    const runAnalysisNow = vi.fn().mockResolvedValue(true);
    const timer = setTimeout(() => {}, 1000);
    const analyzeTimerRef = { current: timer };
    const pendingSimilarityRecalcRef = { current: true };
    const suspendAutoAnalysisRef = { current: false };

    const { result } = renderHook(() =>
      useSettingsAnalysisController({
        updateSettings: vi.fn(),
        resetSettings: vi.fn(),
        scanningRef: { current: false },
        analyzeTimerRef,
        pendingSimilarityRecalcRef,
        suspendAutoAnalysisRef,
        runAnalysisNow,
      }),
    );

    await act(async () => {
      await result.current.handleResetHashes();
    });

    expect(preloadMocks.image.resetHashes).toHaveBeenCalledTimes(1);
    expect(runAnalysisNow).toHaveBeenCalledTimes(1);
    expect(analyzeTimerRef.current).toBeNull();
    expect(pendingSimilarityRecalcRef.current).toBe(false);
    expect(suspendAutoAnalysisRef.current).toBe(false);
  });

  it("blocks hash reset while a scan is active", async () => {
    const runAnalysisNow = vi.fn().mockResolvedValue(true);

    const { result } = renderHook(() =>
      useSettingsAnalysisController({
        updateSettings: vi.fn(),
        resetSettings: vi.fn(),
        scanningRef: { current: true },
        analyzeTimerRef: { current: null },
        pendingSimilarityRecalcRef: { current: false },
        suspendAutoAnalysisRef: { current: false },
        runAnalysisNow,
      }),
    );

    await act(async () => {
      await result.current.handleResetHashes();
    });

    expect(toast.error).toHaveBeenCalledWith(
      "A scan is already running. Please wait until it completes before recalculating hashes.",
    );
    expect(preloadMocks.image.resetHashes).not.toHaveBeenCalled();
    expect(runAnalysisNow).not.toHaveBeenCalled();
  });

  it("surfaces hash reset failures and restores auto analysis", async () => {
    const runAnalysisNow = vi.fn().mockResolvedValue(true);
    preloadMocks.image.resetHashes.mockRejectedValueOnce(
      new Error("disk unavailable"),
    );
    const suspendAutoAnalysisRef = { current: false };

    const { result } = renderHook(() =>
      useSettingsAnalysisController({
        updateSettings: vi.fn(),
        resetSettings: vi.fn(),
        scanningRef: { current: false },
        analyzeTimerRef: { current: null },
        pendingSimilarityRecalcRef: { current: false },
        suspendAutoAnalysisRef,
        runAnalysisNow,
      }),
    );

    await act(async () => {
      await result.current.handleResetHashes();
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Failed to reset hashes: disk unavailable",
    );
    expect(runAnalysisNow).not.toHaveBeenCalled();
    expect(suspendAutoAnalysisRef.current).toBe(false);
  });
});
