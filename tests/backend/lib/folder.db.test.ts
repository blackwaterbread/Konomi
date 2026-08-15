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

  describe("getSubfolderPaths", () => {
    async function seedImages(folderId: number, paths: string[]) {
      const { getDB } = await import("@core/lib/db");
      for (const p of paths) {
        await getDB().image.create({
          data: {
            path: p,
            folderId,
            prompt: "",
            negativePrompt: "",
            characterPrompts: "[]",
            source: "nai",
            model: "",
            seed: "",
            width: 0,
            height: 0,
            sampler: "",
            steps: 0,
            cfgScale: 0,
            cfgRescale: 0,
            noiseSchedule: "",
            varietyPlus: false,
            fileSize: 1,
            fileModifiedAt: new Date(),
          },
        });
      }
    }

    // The returned path is walked, prefix-matched against `Image.path`, and
    // compared with scan events. A folded spelling names no directory, and
    // every one of those consumers then needs its own compensation for it.
    it("reports the on-disk spelling, not a folded one", async () => {
      const service = await createService();
      const folderPath = path.join(ctx.userDataDir, "Library");
      fs.mkdirSync(folderPath, { recursive: true });
      const folder = await service.create("Library", folderPath);

      await seedImages(folder.id, [
        path.join(folderPath, "MixedCase", "a.png"),
        path.join(folderPath, "MixedCase", "Deeper", "b.png"),
      ]);

      await expect(service.getSubfolderPaths(folder.id)).resolves.toEqual([
        { path: path.join(folderPath, "MixedCase"), depth: 1 },
        { path: path.join(folderPath, "MixedCase", "Deeper"), depth: 2 },
      ]);
    });

    it.runIf(process.platform === "win32")(
      "collapses rows that spell one directory differently",
      async () => {
        const service = await createService();
        const folderPath = path.join(ctx.userDataDir, "Library");
        fs.mkdirSync(folderPath, { recursive: true });
        const folder = await service.create("Library", folderPath);

        // A case-only rename can leave the library holding both spellings.
        await seedImages(folder.id, [
          path.join(folderPath, "Sub", "a.png"),
          path.join(folderPath, "sub", "b.png"),
        ]);

        const subfolders = await service.getSubfolderPaths(folder.id);
        expect(subfolders).toHaveLength(1);
        expect(subfolders[0].depth).toBe(1);
      },
    );
  });
});
