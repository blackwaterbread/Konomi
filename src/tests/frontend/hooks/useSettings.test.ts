import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { DEFAULTS, readStoredSettings, useSettings } from "@/hooks/useSettings";

describe("useSettings", () => {
  it("migrates legacy stored settings into the current shape", () => {
    localStorage.setItem(
      "konomi-settings",
      JSON.stringify({
        recentDays: 14,
        pageSize: 40,
        similarityThreshold: 15,
        similarPageSize: 24,
        jaccardThreshold: 0.72,
        theme: "white",
        language: "ko",
      }),
    );

    expect(readStoredSettings()).toEqual({
      ...DEFAULTS,
      recentDays: 14,
      pageSize: 40,
      similarityThreshold: 15,
      visualSimilarityThreshold: 15,
      promptSimilarityThreshold: 0.72,
      useAdvancedSimilarityThresholds: true,
      similarPageSize: 24,
      theme: "white",
      language: "ko",
    });
  });

  it("updates and resets settings while persisting the result", () => {
    const { result } = renderHook(() => useSettings());

    act(() => {
      result.current.updateSettings({
        theme: "white",
        language: "en",
        recentDays: 30,
      });
    });

    expect(result.current.settings).toMatchObject({
      theme: "white",
      language: "en",
      recentDays: 30,
    });
    expect(
      JSON.parse(localStorage.getItem("konomi-settings") ?? "{}"),
    ).toMatchObject({
      theme: "white",
      language: "en",
      recentDays: 30,
    });

    act(() => {
      result.current.resetSettings(["theme", "language"]);
    });

    expect(result.current.settings).toMatchObject({
      theme: DEFAULTS.theme,
      language: DEFAULTS.language,
      recentDays: 30,
    });
  });
});
