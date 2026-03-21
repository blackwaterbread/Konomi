import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Category } from "@preload/index.d";
import { useCategories } from "@/hooks/useCategories";
import { preloadMocks } from "../helpers/preload-mocks";

function createCategory(overrides: Partial<Category>): Category {
  return {
    id: overrides.id ?? 1,
    name: overrides.name ?? "Category",
    isBuiltin: overrides.isBuiltin ?? false,
    order: overrides.order ?? 99,
  };
}

describe("useCategories", () => {
  it("loads categories with builtin entries first and respects stored custom order", async () => {
    localStorage.setItem("konomi-category-order", JSON.stringify([4, 3]));
    preloadMocks.category.list.mockResolvedValue([
      createCategory({ id: 3, name: "Characters" }),
      createCategory({ id: 1, name: "Random", isBuiltin: true, order: 1 }),
      createCategory({ id: 4, name: "Landscapes" }),
      createCategory({ id: 2, name: "Favorites", isBuiltin: true, order: 2 }),
    ]);

    const { result } = renderHook(() => useCategories());

    await waitFor(() =>
      expect(result.current.categories.map((category) => category.id)).toEqual([
        1,
        2,
        4,
        3,
      ]),
    );

    act(() => {
      result.current.selectCategory(1);
    });
    expect(result.current.selectedBuiltinCategory).toBe("random");

    act(() => {
      result.current.selectCategory(2);
    });
    expect(result.current.selectedBuiltinCategory).toBe("favorites");

    act(() => {
      result.current.selectCategory(4);
    });
    expect(result.current.selectedBuiltinCategory).toBeNull();
  });

  it("supports category CRUD, reordering, and add-by-prompt refresh checks", async () => {
    preloadMocks.category.list.mockResolvedValue([
      createCategory({ id: 1, name: "Random", isBuiltin: true, order: 1 }),
      createCategory({ id: 2, name: "Favorites", isBuiltin: true, order: 2 }),
    ]);
    preloadMocks.category.create.mockResolvedValue(
      createCategory({ id: 7, name: "Drafts" }),
    );
    preloadMocks.category.rename.mockResolvedValue(
      createCategory({ id: 7, name: "Final Drafts" }),
    );

    const { result } = renderHook(() => useCategories());

    await waitFor(() => expect(result.current.categories).toHaveLength(2));

    await act(async () => {
      await result.current.createCategory("Drafts");
    });
    expect(result.current.categories.map((category) => category.id)).toEqual([
      1,
      2,
      7,
    ]);

    await act(async () => {
      await result.current.renameCategory(7, "Final Drafts");
    });
    expect(
      result.current.categories.find((category) => category.id === 7)?.name,
    ).toBe("Final Drafts");

    act(() => {
      result.current.reorderCategories([7]);
    });
    expect(result.current.categories.map((category) => category.id)).toEqual([
      1,
      2,
      7,
    ]);
    expect(localStorage.getItem("konomi-category-order")).toBe("[7]");

    act(() => {
      result.current.selectCategory(7);
    });

    await act(async () => {
      await expect(
        result.current.addCategoryByPrompt(7, "sparkles"),
      ).resolves.toBe(true);
    });
    expect(preloadMocks.category.addByPrompt).toHaveBeenCalledWith(
      7,
      "sparkles",
    );

    await act(async () => {
      await result.current.deleteCategory(7);
    });
    expect(result.current.categories.map((category) => category.id)).toEqual([
      1,
      2,
    ]);
    expect(result.current.selectedCategoryId).toBeNull();
  });
});
