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

describe("folder db integration", () => {
  it("creates, lists, renames, and deletes folders", async () => {
    const { createFolder, deleteFolder, getFolders, renameFolder } =
      await import("../../../main/lib/folder");

    const folderPath = path.join(ctx.userDataDir, "images");
    fs.mkdirSync(folderPath, { recursive: true });

    const created = await createFolder("Images", folderPath);
    expect(created.name).toBe("Images");

    await expect(getFolders()).resolves.toMatchObject([
      { id: created.id, name: "Images", path: folderPath },
    ]);

    const renamed = await renameFolder(created.id, "Renamed");
    expect(renamed.name).toBe("Renamed");

    await deleteFolder(created.id);
    await expect(getFolders()).resolves.toEqual([]);
  });

  it("rejects duplicate normalized folder paths", async () => {
    const { createFolder } = await import("../../../main/lib/folder");

    const folderPath = path.join(ctx.userDataDir, "images");
    fs.mkdirSync(folderPath, { recursive: true });

    await createFolder("Images", folderPath);
    await expect(
      createFolder("Images Again", path.join(folderPath, ".")),
    ).rejects.toThrow();
  });
});
