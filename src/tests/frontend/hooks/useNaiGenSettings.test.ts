import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useNaiGenSettings } from "@/hooks/useNaiGenSettings";

describe("useNaiGenSettings", () => {
  it("reads, updates, and resets the persisted output folder", () => {
    localStorage.setItem(
      "konomi-nai-gen-settings",
      JSON.stringify({
        outputFolder: "C:/images/out",
        model: "nai-diffusion-4",
      }),
    );

    const { result } = renderHook(() => useNaiGenSettings());

    expect(result.current.outputFolder).toBe("C:/images/out");

    act(() => {
      result.current.setOutputFolder("D:/next-output");
    });

    expect(result.current.outputFolder).toBe("D:/next-output");
    expect(
      JSON.parse(localStorage.getItem("konomi-nai-gen-settings") ?? "{}"),
    ).toEqual({
      outputFolder: "D:/next-output",
      model: "nai-diffusion-4",
    });

    act(() => {
      result.current.resetOutputFolder();
    });

    expect(result.current.outputFolder).toBe("");
    expect(
      JSON.parse(localStorage.getItem("konomi-nai-gen-settings") ?? "{}"),
    ).toEqual({
      outputFolder: "",
      model: "nai-diffusion-4",
    });
  });
});
