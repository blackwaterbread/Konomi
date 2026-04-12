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

async function createService() {
  const { getDB } = await import("../../../main/lib/db");
  const { createPrismaPromptRepo } = await import(
    "../../../main/lib/repositories/prisma-prompt-repo"
  );
  const { createPromptBuilderService } = await import(
    "@core/services/prompt-builder-service"
  );
  const promptRepo = createPrismaPromptRepo(getDB);
  return createPromptBuilderService({ promptRepo });
}

describe("prompt db integration", () => {
  it("seeds builtin prompt categories lazily", async () => {
    const service = await createService();

    const categories = await service.listCategories();

    expect(categories.length).toBeGreaterThan(0);
    expect(categories.every((category) => category.isBuiltin)).toBe(true);
    expect(categories.map((category) => category.order)).toEqual(
      [...categories].map((category) => category.order).sort((a, b) => a - b),
    );
  });

  it("creates groups and tokens and persists token reorder", async () => {
    const service = await createService();

    const category = await service.createCategory("Custom");
    const group = await service.createGroup(category.id, "Lighting");
    const warm = await service.createToken(group.id, "warm light");
    const rim = await service.createToken(group.id, "rim light");

    await service.reorderTokens(group.id, [rim.id, warm.id]);

    const categories = await service.listCategories();
    const savedCategory = categories.find((item) => item.id === category.id);
    const savedGroup = savedCategory?.groups.find(
      (item) => item.id === group.id,
    );

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
