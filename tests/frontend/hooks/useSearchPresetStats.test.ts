import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSearchPresetStats } from "@/hooks/useSearchPresetStats";
import { preloadMocks } from "../helpers/preload-mocks";

describe("useSearchPresetStats", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads preset stats and debounces refresh requests", async () => {
    preloadMocks.image.getSearchPresetStats.mockResolvedValue({
      availableResolutions: [{ width: 832, height: 1216 }],
      availableModels: ["nai-diffusion-4-5-full"],
    });

    const { result } = renderHook(() => useSearchPresetStats());

    await act(async () => {
      await result.current.loadSearchPresetStats();
    });

    expect(result.current.availableResolutions).toEqual([
      { width: 832, height: 1216 },
    ]);
    expect(result.current.availableModels).toEqual(["nai-diffusion-4-5-full"]);

    vi.useFakeTimers();
    preloadMocks.image.getSearchPresetStats.mockClear();

    act(() => {
      result.current.scheduleSearchStatsRefresh(200);
      result.current.scheduleSearchStatsRefresh(200);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(199);
    });
    expect(preloadMocks.image.getSearchPresetStats).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(preloadMocks.image.getSearchPresetStats).toHaveBeenCalledTimes(1);
  });
});
