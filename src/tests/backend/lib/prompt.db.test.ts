import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  setupIsolatedDbTest,
  type IsolatedDbTestContext,
} from "../helpers/test-db";

let ctx: IsolatedDbTestContext;

beforeEach(async () => {
  ctx = await setupIsolatedDbTest();
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("prompt db integration", () => {
  it("seeds builtin prompt categories lazily", async () => {
    const { listCategories } = await import("../../../main/lib/prompt");

    const categories = await listCategories();

    expect(categories.length).toBeGreaterThan(0);
    expect(categories.every((category) => category.isBuiltin)).toBe(true);
    expect(categories.map((category) => category.order)).toEqual(
      [...categories]
        .map((category) => category.order)
        .sort((a, b) => a - b),
    );
  });

  it("creates groups and tokens and persists token reorder", async () => {
    const {
      createCategory,
      createGroup,
      createToken,
      listCategories,
      reorderTokens,
    } = await import("../../../main/lib/prompt");

    const category = await createCategory("Custom");
    const group = await createGroup(category.id, "Lighting");
    const warm = await createToken(group.id, "warm light");
    const rim = await createToken(group.id, "rim light");

    await reorderTokens(group.id, [rim.id, warm.id]);

    const categories = await listCategories();
    const savedCategory = categories.find((item) => item.id === category.id);
    const savedGroup = savedCategory?.groups.find((item) => item.id === group.id);

    expect(savedCategory).toMatchObject({
      id: category.id,
      name: "Custom",
      isBuiltin: false,
    });
    expect(savedGroup?.tokens.map((token) => token.label)).toEqual([
      "rim light",
      "warm light",
    ]);
  });
});
