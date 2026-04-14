import fs from "fs";
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

async function createService() {
  const { getDB } = await import("@core/lib/db");
  const { createPrismaFolderRepo } = await import(
    "@core/lib/repositories/prisma-folder-repo"
  );
  const { createPrismaImageRepo } = await import(
    "@core/lib/repositories/prisma-image-repo"
  );
  const { createFolderService } = await import(
    "@core/services/folder-service"
  );
  const folderRepo = createPrismaFolderRepo(getDB);
  const imageRepo = createPrismaImageRepo(getDB);
  return createFolderService({ folderRepo, imageRepo });
}

describe("folder db integration", () => {
  it("creates, lists, renames, and deletes folders", async () => {
    const service = await createService();

    const folderPath = path.join(ctx.userDataDir, "images");
    fs.mkdirSync(folderPath, { recursive: true });

    const created = await service.create("Images", folderPath);
    expect(created.name).toBe("Images");

    await expect(service.list()).resolves.toMatchObject([
      { id: created.id, name: "Images", path: folderPath },
    ]);

    const renamed = await service.rename(created.id, "Renamed");
    expect(renamed.name).toBe("Renamed");

    await service.delete(created.id);
    await expect(service.list()).resolves.toEqual([]);
  });

  it("rejects duplicate normalized folder paths", async () => {
    const service = await createService();

    const folderPath = path.join(ctx.userDataDir, "images");
    fs.mkdirSync(folderPath, { recursive: true });

    await service.create("Images", folderPath);
    await expect(
      service.create("Images Again", path.join(folderPath, ".")),
    ).rejects.toThrow();
  });
});
