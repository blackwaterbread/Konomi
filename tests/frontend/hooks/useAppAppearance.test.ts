import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppAppearance } from "@/hooks/useAppAppearance";
import { applyAppLanguagePreference } from "@/lib/i18n";

vi.mock("@/lib/i18n", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/i18n")>("@/lib/i18n");
  return {
    ...actual,
    applyAppLanguagePreference: vi.fn().mockResolvedValue("en"),
  };
});

describe("useAppAppearance", () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = "";
    document.documentElement.classList.remove("dark");
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  it("applies language preference and syncs the auto theme", async () => {
    const { result } = renderHook(() =>
      useAppAppearance({
        theme: "auto",
        language: "en",
      }),
    );

    await waitFor(() =>
      expect(applyAppLanguagePreference).toHaveBeenCalledWith("en"),
    );
    expect(result.current.isDarkTheme).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
