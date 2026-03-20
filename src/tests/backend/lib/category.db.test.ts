import path from "path";
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

async function seedImageRows() {
  const { getDB } = await import("../../../main/lib/db");
  const db = getDB();
  const folder = await db.folder.create({
    data: {
      name: "Seed Folder",
      path: path.join(ctx.userDataDir, "seed-folder"),
    },
  });

  const imageA = await db.image.create({
    data: {
      path: path.join(ctx.userDataDir, "image-a.png"),
      folderId: folder.id,
      prompt: "sunset beach",
      fileModifiedAt: new Date("2026-03-20T00:00:00.000Z"),
    },
  });
  const imageB = await db.image.create({
    data: {
      path: path.join(ctx.userDataDir, "image-b.png"),
      folderId: folder.id,
      characterPrompts: JSON.stringify(["sunset mage"]),
      fileModifiedAt: new Date("2026-03-20T00:01:00.000Z"),
    },
  });
  const imageC = await db.image.create({
    data: {
      path: path.join(ctx.userDataDir, "image-c.png"),
      folderId: folder.id,
      prompt: "city night",
      fileModifiedAt: new Date("2026-03-20T00:02:00.000Z"),
    },
  });

  return { imageA, imageB, imageC };
}

describe("category db integration", () => {
  it("adds image relations without duplicating joins and reports common categories", async () => {
    const {
      addImageToCategory,
      addImagesToCategory,
      createCategory,
      getCategoryImageIds,
      getCommonCategoryIdsForImages,
    } = await import("../../../main/lib/category");
    const { imageA, imageB, imageC } = await seedImageRows();

    const primary = await createCategory("Primary");
    const secondary = await createCategory("Secondary");

    await addImagesToCategory([imageA.id, imageA.id, imageB.id], primary.id);
    await addImageToCategory(imageA.id, secondary.id);
    await addImageToCategory(imageB.id, secondary.id);
    await addImageToCategory(imageC.id, secondary.id);

    await expect(
      getCategoryImageIds(primary.id).then((ids) => ids.sort((a, b) => a - b)),
    ).resolves.toEqual([imageA.id, imageB.id].sort((a, b) => a - b));
    await expect(
      getCommonCategoryIdsForImages([imageA.id, imageB.id]).then((ids) =>
        ids.sort((a, b) => a - b),
      ),
    ).resolves.toEqual([primary.id, secondary.id].sort((a, b) => a - b));
  });

  it("adds images by prompt without duplicating existing relations", async () => {
    const { addImagesByPrompt, createCategory, getCategoryImageIds } =
      await import("../../../main/lib/category");
    const { imageA, imageB } = await seedImageRows();

    const category = await createCategory("Prompt Matches");

    await expect(addImagesByPrompt(category.id, "sunset")).resolves.toBe(2);
    await expect(addImagesByPrompt(category.id, "sunset")).resolves.toBe(2);
    await expect(
      getCategoryImageIds(category.id).then((ids) => ids.sort((a, b) => a - b)),
    ).resolves.toEqual([imageA.id, imageB.id].sort((a, b) => a - b));
  });
});
