import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Category } from "@preload/index.d";
import { useBrowseScope } from "@/hooks/useBrowseScope";
import { preloadMocks } from "../helpers/preload-mocks";

function createCategory(overrides: Partial<Category>): Category {
  return {
    id: overrides.id ?? 1,
    name: overrides.name ?? "Category",
    isBuiltin: overrides.isBuiltin ?? false,
    order: overrides.order ?? 99,
    color: null,
    ...overrides,
  };
}

describe("useBrowseScope", () => {
  it("keeps sidebar state and query fragment aligned", async () => {
    preloadMocks.category.list.mockResolvedValue([
      createCategory({ id: 1, name: "Random", isBuiltin: true, order: 1 }),
      createCategory({ id: 2, name: "Favorites", isBuiltin: true, order: 2 }),
      createCategory({ id: 7, name: "Portraits" }),
    ]);
    preloadMocks.category.addByPrompt.mockResolvedValue(0);

    const { result } = renderHook(() => useBrowseScope());

    await waitFor(() =>
      expect(
        result.current.sidebarCategoryState.categories.map(
          (category) => category.id,
        ),
      ).toEqual([1, 2, 7]),
    );

    expect(result.current.queryFragment.onlyRecent).toBe(false);
    expect(result.current.queryFragment.customCategoryId).toBeNull();
    expect(result.current.queryFragment.builtinCategory).toBeNull();

    act(() => {
      result.current.categoryCommands.selectCategory(1);
    });
    expect(result.current.queryFragment.builtinCategory).toBe("random");

    const previousSeed = result.current.queryFragment.randomSeed;
    act(() => {
      result.current.categoryCommands.refreshRandomSelection();
    });
    expect(result.current.queryFragment.randomSeed).toBe(previousSeed + 1);

    act(() => {
      result.current.sidebarView.onViewChange("recent");
    });
    expect(result.current.sidebarView.activeView).toBe("recent");
    expect(result.current.sidebarCategoryState.selectedCategoryId).toBeNull();
    expect(result.current.queryFragment.onlyRecent).toBe(true);

    act(() => {
      result.current.categoryCommands.selectCategory(7);
    });
    expect(result.current.queryFragment.customCategoryId).toBe(7);
    expect(result.current.queryFragment.builtinCategory).toBeNull();

    await act(async () => {
      await expect(
        result.current.categoryCommands.addCategoryByPrompt(7, "sparkles"),
      ).resolves.toBe(true);
    });
    expect(preloadMocks.category.addByPrompt).toHaveBeenCalledWith(
      7,
      "sparkles",
    );
  });
});
