import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { useAppShellState } from "@/hooks/useAppShellState";

describe("useAppShellState", () => {
  it("blocks leaving settings while a scan is active", async () => {
    const runAnalysisNow = vi.fn().mockResolvedValue(true);
    const scanningRef = { current: true };
    const pendingSimilarityRecalcRef = { current: true };

    const { result } = renderHook(() =>
      useAppShellState({
        scanningRef,
        pendingSimilarityRecalcRef,
        runAnalysisNow,
      }),
    );

    act(() => {
      result.current.setActivePanel("settings");
    });

    await act(async () => {
      await result.current.handlePanelChange("gallery");
    });

    expect(result.current.activePanel).toBe("settings");
    expect(toast.error).toHaveBeenCalledWith(
      "A scan is already running. Please wait until it completes before recalculating similarity.",
    );
    expect(runAnalysisNow).not.toHaveBeenCalled();
  });

  it("reruns similarity analysis when leaving settings with pending work", async () => {
    const runAnalysisNow = vi.fn().mockResolvedValue(true);
    const scanningRef = { current: false };
    const pendingSimilarityRecalcRef = { current: true };

    const { result } = renderHook(() =>
      useAppShellState({
        scanningRef,
        pendingSimilarityRecalcRef,
        runAnalysisNow,
      }),
    );

    act(() => {
      result.current.setActivePanel("settings");
    });

    await act(async () => {
      await result.current.handlePanelChange("gallery");
    });

    expect(result.current.activePanel).toBe("gallery");
    expect(runAnalysisNow).toHaveBeenCalledTimes(1);
  });

  it("tracks sidebar resize and persists the final width", () => {
    const { result } = renderHook(() =>
      useAppShellState({
        scanningRef: { current: false },
        pendingSimilarityRecalcRef: { current: false },
        runAnalysisNow: vi.fn().mockResolvedValue(true),
      }),
    );

    act(() => {
      result.current.handleResizeStart({ clientX: 100 } as React.MouseEvent);
    });

    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 160 }));
    });

    expect(result.current.sidebarWidth).toBe(348);

    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });

    expect(localStorage.getItem("konomi-sidebar-width")).toBe("348");
  });

  it("keeps the feature tour hidden until initial language selection completes", () => {
    const { result } = renderHook(() =>
      useAppShellState({
        scanningRef: { current: false },
        pendingSimilarityRecalcRef: { current: false },
        runAnalysisNow: vi.fn().mockResolvedValue(true),
      }),
    );

    expect(result.current.initialLanguageScreenOpen).toBe(true);
    expect(result.current.showFeatureTour).toBe(false);

    act(() => {
      result.current.handleInitialLanguageContinue();
    });

    expect(result.current.initialLanguageScreenOpen).toBe(false);
    expect(result.current.showFeatureTour).toBe(true);
    expect(
      localStorage.getItem("konomi-initial-language-selection-completed"),
    ).toBe("true");

    act(() => {
      result.current.setActivePanel("settings");
      result.current.handleTourClose();
    });

    expect(result.current.activePanel).toBe("gallery");
    expect(result.current.showFeatureTour).toBe(false);
    expect(localStorage.getItem("konomi-tour-completed")).toBe("true");
  });
});
