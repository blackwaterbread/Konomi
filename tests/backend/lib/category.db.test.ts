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
  const { getDB } = await import("@core/lib/db");
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

async function createService() {
  const { getDB } = await import("@core/lib/db");
  const { createPrismaCategoryRepo } = await import(
    "@core/lib/repositories/prisma-category-repo"
  );
  const { createPrismaImageRepo } = await import(
    "@core/lib/repositories/prisma-image-repo"
  );
  const { createCategoryService } = await import(
    "@core/services/category-service"
  );
  const categoryRepo = createPrismaCategoryRepo(getDB);
  const imageRepo = createPrismaImageRepo(getDB);
  return createCategoryService({ categoryRepo, imageRepo });
}

describe("category db integration", () => {
  it("adds image relations without duplicating joins and reports common categories", async () => {
    const service = await createService();
    const { imageA, imageB, imageC } = await seedImageRows();

    const primary = await service.create("Primary");
    const secondary = await service.create("Secondary");

    await service.addImages([imageA.id, imageA.id, imageB.id], primary.id);
    await service.addImage(imageA.id, secondary.id);
    await service.addImage(imageB.id, secondary.id);
    await service.addImage(imageC.id, secondary.id);

    await expect(
      service.getImageIds(primary.id).then((ids) => ids.sort((a, b) => a - b)),
    ).resolves.toEqual([imageA.id, imageB.id].sort((a, b) => a - b));
    await expect(
      service
        .getCommonCategoriesForImages([imageA.id, imageB.id])
        .then((ids) => ids.sort((a, b) => a - b)),
    ).resolves.toEqual([primary.id, secondary.id].sort((a, b) => a - b));
  });

  it("adds images by prompt without duplicating existing relations", async () => {
    const service = await createService();
    const { imageA, imageB } = await seedImageRows();

    const category = await service.create("Prompt Matches");

    await expect(
      service.addImagesByPrompt(category.id, "sunset"),
    ).resolves.toBe(2);
    await expect(
      service.addImagesByPrompt(category.id, "sunset"),
    ).resolves.toBe(2);
    await expect(
      service
        .getImageIds(category.id)
        .then((ids) => ids.sort((a, b) => a - b)),
    ).resolves.toEqual([imageA.id, imageB.id].sort((a, b) => a - b));
  });
});
