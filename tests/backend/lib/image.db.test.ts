import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setupIsolatedDbTest,
  type IsolatedDbTestContext,
} from "../helpers/test-db";

vi.mock("worker_threads", () => {
  class FakeWorker {
    on(): this {
      return this;
    }

    postMessage(): void {
      // `image.db.test.ts` never drives the worker-backed scan path.
    }
  }

  return {
    Worker: FakeWorker,
  };
});

let ctx: IsolatedDbTestContext;

beforeEach(async () => {
  ctx = await setupIsolatedDbTest();
});

afterEach(async () => {
  await ctx.cleanup();
});

async function seedImageQueryData() {
  const { getDB } = await import("@core/lib/db");
  const db = getDB();
  const tokens = (values: string[]) =>
    JSON.stringify(values.map((text) => ({ text, weight: 1 })));

  const folder = await db.folder.create({
    data: {
      name: "Images",
      path: path.join(ctx.userDataDir, "images"),
    },
  });

  const imageA = await db.image.create({
    data: {
      path: path.join(ctx.userDataDir, "sunset-a.png"),
      folderId: folder.id,
      prompt: "sunset beach",
      promptTokens: tokens(["sunset_beach", "golden hour"]),
      model: "model-a",
      width: 832,
      height: 1216,
      isFavorite: false,
      fileModifiedAt: new Date("2026-03-20T00:00:00.000Z"),
    },
  });
  const imageB = await db.image.create({
    data: {
      path: path.join(ctx.userDataDir, "sunset-b.png"),
      folderId: folder.id,
      prompt: "sunset city",
      promptTokens: tokens(["sunset_city", "city lights"]),
      model: "model-b",
      width: 1024,
      height: 1024,
      isFavorite: true,
      fileModifiedAt: new Date("2026-03-20T00:10:00.000Z"),
    },
  });
  const imageC = await db.image.create({
    data: {
      path: path.join(ctx.userDataDir, "forest.png"),
      folderId: folder.id,
      prompt: "forest trail",
      promptTokens: tokens(["forest trail", "golden hour"]),
      model: "model-a",
      width: 832,
      height: 1216,
      isFavorite: true,
      fileModifiedAt: new Date("2026-03-20T00:20:00.000Z"),
    },
  });

  const category = await db.category.create({
    data: { name: "Landscape", order: 0 },
  });
  await db.imageCategory.create({
    data: { imageId: imageA.id, categoryId: category.id },
  });

  return { folder, imageA, imageB, imageC, category };
}

async function seedExistingDuplicateData(content = "same-binary") {
  const { getDB } = await import("@core/lib/db");
  const db = getDB();

  const folderPath = path.join(ctx.userDataDir, "duplicate-folder");
  fs.mkdirSync(folderPath, { recursive: true });

  const folder = await db.folder.create({
    data: {
      name: "Duplicates",
      path: folderPath,
    },
  });

  const existingPath = path.join(folderPath, "existing.png");
  fs.writeFileSync(existingPath, content);
  const stat = fs.statSync(existingPath);

  const existingImage = await db.image.create({
    data: {
      path: existingPath,
      folderId: folder.id,
      fileSize: stat.size,
      fileModifiedAt: stat.mtime,
    },
  });

  return { db, folder, folderPath, existingImage, existingPath, content };
}

describe("image db integration", () => {
  it("filters paged image queries by search, model, resolution, and category", async () => {
    const { getDB } = await import("@core/lib/db");
    const { createPrismaImageRepo } = await import(
      "@core/lib/repositories/prisma-image-repo"
    );
    const imageRepo = createPrismaImageRepo(getDB);
    const { folder, imageA, category } = await seedImageQueryData();

    const result = await imageRepo.listPage({
      folderIds: [folder.id],
      searchQuery: "sunset",
      modelFilters: ["model-a"],
      resolutionFilters: [{ width: 832, height: 1216 }],
      customCategoryId: category.id,
      page: 1,
      pageSize: 10,
    });

    expect(result.totalCount).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.rows.map((row) => row.id)).toEqual([imageA.id]);
  });

  it("supports favorites queries and preserves requested id ordering", async () => {
    const { getDB } = await import("@core/lib/db");
    const { createPrismaImageRepo } = await import(
      "@core/lib/repositories/prisma-image-repo"
    );
    const imageRepo = createPrismaImageRepo(getDB);
    const { folder, imageA, imageB, imageC } = await seedImageQueryData();

    await imageRepo.setFavorite(imageA.id, true);

    const favorites = await imageRepo.listPage({
      folderIds: [folder.id],
      builtinCategory: "favorites",
      sortBy: "favorites",
      page: 1,
      pageSize: 10,
    });

    expect(favorites.rows.map((row) => row.id)).toEqual([
      imageC.id,
      imageB.id,
      imageA.id,
    ]);

    await expect(
      imageRepo.listByIds([imageB.id, imageA.id, imageC.id]),
    ).resolves.toMatchObject([
      { id: imageB.id },
      { id: imageA.id },
      { id: imageC.id },
    ]);
  });

  it("rebuilds search preset stats and suggests normalized tags", async () => {
    const { getImageSearchPresetStats, suggestImageSearchTags } =
      await import("@core/lib/search-stats-store");
    await seedImageQueryData();

    const stats = await getImageSearchPresetStats();
    const tagSuggestions = await suggestImageSearchTags({
      prefix: "sun",
      exclude: ["sunset city"],
    });

    expect(stats.availableResolutions).toEqual([
      { width: 832, height: 1216 },
      { width: 1024, height: 1024 },
    ]);
    expect(stats.availableModels).toEqual(["model-a", "model-b"]);
    expect(tagSuggestions).toEqual([{ tag: "sunset_beach", count: 1 }]);
  });

  it("maintains search stat tables incrementally across add, replace, and remove operations", async () => {
    const {
      applyImageSearchStatsMutation,
      decrementImageSearchStatsForRows,
      getImageSearchPresetStats,
      suggestImageSearchTags,
    } = await import("@core/lib/search-stats-store");

    const sourceA = {
      width: 832,
      height: 1216,
      model: "model-a",
      promptTokens: JSON.stringify([{ text: "golden hour", weight: 1 }]),
      negativePromptTokens: "[]",
      characterPromptTokens: "[]",
    };
    const sourceB = {
      width: 1024,
      height: 1024,
      model: "model-b",
      promptTokens: JSON.stringify([{ text: "sunset_beach", weight: 1 }]),
      negativePromptTokens: JSON.stringify([{ text: "lowres", weight: 1 }]),
      characterPromptTokens: "[]",
    };

    await applyImageSearchStatsMutation(null, sourceA);
    await expect(getImageSearchPresetStats()).resolves.toEqual({
      availableResolutions: [{ width: 832, height: 1216 }],
      availableModels: ["model-a"],
    });
    await expect(suggestImageSearchTags({ prefix: "gol" })).resolves.toEqual([
      { tag: "golden hour", count: 1 },
    ]);

    await applyImageSearchStatsMutation(sourceA, sourceB);
    await expect(getImageSearchPresetStats()).resolves.toEqual({
      availableResolutions: [{ width: 1024, height: 1024 }],
      availableModels: ["model-b"],
    });
    await expect(suggestImageSearchTags({ prefix: "gol" })).resolves.toEqual(
      [],
    );
    await expect(suggestImageSearchTags({ prefix: "sun" })).resolves.toEqual([
      { tag: "sunset_beach", count: 1 },
    ]);

    await decrementImageSearchStatsForRows([sourceB]);
    await expect(getImageSearchPresetStats()).resolves.toEqual({
      availableResolutions: [],
      availableModels: [],
    });
    await expect(suggestImageSearchTags({ prefix: "sun" })).resolves.toEqual(
      [],
    );
  });

  it("finds folder duplicate groups while excluding ignored incoming paths", async () => {
    const { getDB } = await import("@core/lib/db");
    const { createPrismaImageRepo } = await import(
      "@core/lib/repositories/prisma-image-repo"
    );
    const { createDuplicateService } = await import(
      "@core/services/duplicate-service"
    );
    const { fileHash } = await import("@core/lib/image-infra");
    const imageRepo = createPrismaImageRepo(getDB);
    const ignoredPaths = new Set<string>();
    const duplicateService = createDuplicateService({
      imageRepo,
      hashFile: fileHash,
      ignoredDuplicates: {
        ensureLoaded: async () => {},
        isIgnored: async (p) => ignoredPaths.has(p),
        register: async (paths) => { for (const p of paths) ignoredPaths.add(p); },
        forget: async (p) => { ignoredPaths.delete(p); },
        list: async () => [...ignoredPaths],
        clear: async () => { const n = ignoredPaths.size; ignoredPaths.clear(); return n; },
      },
    });
    const { existingImage, existingPath, content } =
      await seedExistingDuplicateData();

    const incomingDir = path.join(ctx.userDataDir, "incoming-folder");
    fs.mkdirSync(incomingDir, { recursive: true });
    const incomingA = path.join(incomingDir, "incoming-a.png");
    const incomingB = path.join(incomingDir, "incoming-b.png");
    const ignoredIncoming = path.join(incomingDir, "ignored.png");
    const different = path.join(incomingDir, "different.png");
    fs.writeFileSync(incomingA, content);
    fs.writeFileSync(incomingB, content);
    fs.writeFileSync(ignoredIncoming, content);
    fs.writeFileSync(different, "different-binary");

    await duplicateService.ensureIgnoredLoaded();
    ignoredPaths.add(ignoredIncoming);

    const groups = await duplicateService.findDuplicates(incomingDir);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.existingEntries).toMatchObject([
      { imageId: existingImage.id, path: existingPath },
    ]);
    expect(
      groups[0]?.incomingEntries.map((entry) => entry.path).sort(),
    ).toEqual([incomingA, incomingB].sort());
  });

  it("hashes nothing when a rescan only re-walks files the library already holds", async () => {
    const { getDB } = await import("@core/lib/db");
    const { createPrismaImageRepo } = await import(
      "@core/lib/repositories/prisma-image-repo"
    );
    const { createDuplicateService } = await import(
      "@core/services/duplicate-service"
    );
    const { fileHash } = await import("@core/lib/image-infra");
    const hashed: string[] = [];
    const duplicateService = createDuplicateService({
      imageRepo: createPrismaImageRepo(getDB),
      hashFile: async (p) => {
        hashed.push(p);
        return fileHash(p);
      },
      ignoredDuplicates: {
        ensureLoaded: async () => {},
        isIgnored: async () => false,
        register: async () => {},
        forget: async () => {},
        list: async () => [],
        clear: async () => 0,
      },
    });
    const { db, folder, folderPath, content } =
      await seedExistingDuplicateData();

    // A second indexed file with identical bytes: same size bucket, so before
    // indexed files were dropped every one of them was a hash candidate.
    const twinPath = path.join(folderPath, "twin.png");
    fs.writeFileSync(twinPath, content);
    const twinStat = fs.statSync(twinPath);
    await db.image.create({
      data: {
        path: twinPath,
        folderId: folder.id,
        fileSize: twinStat.size,
        fileModifiedAt: twinStat.mtime,
      },
    });

    const groups = await duplicateService.findDuplicates(folderPath);

    // Both files are already in the library, so neither is "incoming" — the
    // rescan pre-check must reach that conclusion from the size query alone.
    expect(groups).toEqual([]);
    expect(hashed).toEqual([]);
  });

  it.runIf(process.platform === "win32")(
    "does not report an indexed file as a duplicate of itself when the scan path casing differs",
    async () => {
      const { getDB } = await import("@core/lib/db");
      const { createPrismaImageRepo } = await import(
        "@core/lib/repositories/prisma-image-repo"
      );
      const { createDuplicateService } = await import(
        "@core/services/duplicate-service"
      );
      const { fileHash } = await import("@core/lib/image-infra");
      const ignoredPaths = new Set<string>();
      const duplicateService = createDuplicateService({
        imageRepo: createPrismaImageRepo(getDB),
        hashFile: fileHash,
        ignoredDuplicates: {
          ensureLoaded: async () => {},
          isIgnored: async (p) => ignoredPaths.has(p),
          register: async (paths) => { for (const p of paths) ignoredPaths.add(p); },
          forget: async (p) => { ignoredPaths.delete(p); },
          list: async () => [...ignoredPaths],
          clear: async () => { const n = ignoredPaths.size; ignoredPaths.clear(); return n; },
        },
      });
      const { folderPath } = await seedExistingDuplicateData();

      // Subfolder paths shown in the sidebar are lower-cased on win32, so the
      // walk reaches the same physical file under a different-cased path than
      // the stored row. Treating that as a duplicate would delete the file.
      const groups = await duplicateService.findDuplicates(
        folderPath.toLowerCase(),
      );

      expect(groups).toEqual([]);
    },
  );

  it.runIf(process.platform === "win32")(
    "keeps an ignored duplicate ignored when a rescan reaches it under different casing",
    async () => {
      const { getDB } = await import("@core/lib/db");
      const {
        registerIgnoredDuplicatePaths,
        isIgnoredDuplicatePath,
        listIgnoredDuplicatePaths,
        forgetIgnoredDuplicatePath,
      } = await import("@core/lib/image-infra");

      const stored = path.join(ctx.userDataDir, "Library", "Mixed", "dup.png");
      await registerIgnoredDuplicatePaths([stored]);

      // A subtree-scoped rescan walks a lower-cased root, so the same physical
      // file arrives under a different-cased path. Missing it here resurfaces
      // the duplicate the user already dismissed — one Apply away from an
      // unlink of a file they chose to keep.
      await expect(isIgnoredDuplicatePath(stored.toLowerCase())).resolves.toBe(
        true,
      );

      // The folded variant is the same entry, so it must not add a second row.
      await registerIgnoredDuplicatePaths([stored.toLowerCase()]);
      await expect(listIgnoredDuplicatePaths()).resolves.toEqual([stored]);

      // Forgetting through the folded path must delete the row that was
      // actually stored, not the casing the caller happened to pass.
      await forgetIgnoredDuplicatePath(stored.toLowerCase());
      await expect(isIgnoredDuplicatePath(stored)).resolves.toBe(false);
      await expect(
        getDB().ignoredDuplicatePath.findMany({ select: { path: true } }),
      ).resolves.toEqual([]);
    },
  );

  it.runIf(process.platform === "win32")(
    "forgets every stored spelling of one ignored file",
    async () => {
      const { getDB } = await import("@core/lib/db");
      const {
        isIgnoredDuplicatePath,
        listIgnoredDuplicatePaths,
        forgetIgnoredDuplicatePath,
        clearIgnoredDuplicatePaths,
      } = await import("@core/lib/image-infra");

      // Rows written before the fold landed: two files, each stored under two
      // spellings. Leaving either spelling behind reloads the entry on the
      // next process start.
      const dir = path.join(ctx.userDataDir, "Library", "Mixed");
      const first = path.join(dir, "dup.png");
      const second = path.join(dir, "Other.png");
      await getDB().ignoredDuplicatePath.createMany({
        data: [first, second].flatMap((p) => [
          { path: p },
          { path: p.toLowerCase() },
        ]),
      });

      // Reported per file, not per stored spelling.
      await expect(listIgnoredDuplicatePaths()).resolves.toHaveLength(2);

      await forgetIgnoredDuplicatePath(first);
      await expect(isIgnoredDuplicatePath(first)).resolves.toBe(false);
      const left = await getDB().ignoredDuplicatePath.findMany({
        select: { path: true },
      });
      expect(left.map((r) => r.path).sort()).toEqual(
        [second, second.toLowerCase()].sort(),
      );

      // The count answers "how many ignored duplicates were cleared?", so it
      // matches the listing rather than the row count behind it.
      await expect(clearIgnoredDuplicatePaths()).resolves.toBe(1);
    },
  );

  it("resolves duplicates by keeping existing files", async () => {
    const { getDB } = await import("@core/lib/db");
    const { createPrismaImageRepo } = await import(
      "@core/lib/repositories/prisma-image-repo"
    );
    const { createDuplicateService } = await import(
      "@core/services/duplicate-service"
    );
    const { fileHash } = await import("@core/lib/image-infra");
    const imageRepo = createPrismaImageRepo(getDB);
    const ignoredPaths = new Set<string>();
    const duplicateService = createDuplicateService({
      imageRepo,
      hashFile: fileHash,
      ignoredDuplicates: {
        ensureLoaded: async () => {},
        isIgnored: async (p) => ignoredPaths.has(p),
        register: async (paths) => { for (const p of paths) ignoredPaths.add(p); },
        forget: async (p) => { ignoredPaths.delete(p); },
        list: async () => [...ignoredPaths],
        clear: async () => { const n = ignoredPaths.size; ignoredPaths.clear(); return n; },
      },
    });
    const { existingImage, existingPath, folderPath, content } =
      await seedExistingDuplicateData();

    const incomingA = path.join(folderPath, "incoming-a.png");
    const incomingB = path.join(folderPath, "incoming-b.png");
    fs.writeFileSync(incomingA, content);
    fs.writeFileSync(incomingB, content);

    const result = await duplicateService.resolve([
      {
        id: "dup-1",
        hash: "hash",
        keep: "existing",
        existingEntries: [{ imageId: existingImage.id, path: existingPath }],
        incomingPaths: [incomingA, incomingB],
      },
    ]);

    expect(result.removedImageIds).toEqual([]);
    expect(result.retainedIncomingPaths).toEqual([]);
    expect(result.touchedIncomingPaths.sort()).toEqual(
      [incomingA, incomingB].sort(),
    );
    expect(fs.existsSync(existingPath)).toBe(true);
    expect(fs.existsSync(incomingA)).toBe(false);
    expect(fs.existsSync(incomingB)).toBe(false);
    await expect(
      getDB().image.findUnique({ where: { id: existingImage.id } }),
    ).resolves.not.toBeNull();
  });

  it("resolves duplicates by keeping incoming files and removing existing rows", async () => {
    const { getDB } = await import("@core/lib/db");
    const { createPrismaImageRepo } = await import(
      "@core/lib/repositories/prisma-image-repo"
    );
    const { createDuplicateService } = await import(
      "@core/services/duplicate-service"
    );
    const { fileHash } = await import("@core/lib/image-infra");
    const imageRepo = createPrismaImageRepo(getDB);
    const ignoredPaths = new Set<string>();
    const duplicateService = createDuplicateService({
      imageRepo,
      hashFile: fileHash,
      ignoredDuplicates: {
        ensureLoaded: async () => {},
        isIgnored: async (p) => ignoredPaths.has(p),
        register: async (paths) => { for (const p of paths) ignoredPaths.add(p); },
        forget: async (p) => { ignoredPaths.delete(p); },
        list: async () => [...ignoredPaths].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
        clear: async () => { const n = ignoredPaths.size; ignoredPaths.clear(); return n; },
      },
    });
    const { existingImage, existingPath, folderPath, content } =
      await seedExistingDuplicateData();

    const incomingA = path.join(folderPath, "a-incoming.png");
    const incomingB = path.join(folderPath, "b-incoming.png");
    fs.writeFileSync(incomingA, content);
    fs.writeFileSync(incomingB, content);
    ignoredPaths.add(incomingA);
    ignoredPaths.add(incomingB);

    const result = await duplicateService.resolve([
      {
        id: "dup-2",
        hash: "hash",
        keep: "incoming",
        existingEntries: [{ imageId: existingImage.id, path: existingPath }],
        incomingPaths: [incomingB, incomingA],
      },
    ]);

    expect(result.removedImageIds).toEqual([existingImage.id]);
    expect(result.retainedIncomingPaths).toEqual([incomingA]);
    expect(result.touchedIncomingPaths.sort()).toEqual(
      [incomingA, incomingB].sort(),
    );
    expect(fs.existsSync(existingPath)).toBe(false);
    expect(fs.existsSync(incomingA)).toBe(true);
    expect(fs.existsSync(incomingB)).toBe(false);
    await expect(
      getDB().image.findUnique({ where: { id: existingImage.id } }),
    ).resolves.toBeNull();
    await expect(duplicateService.listIgnored()).resolves.toEqual([]);
  });

  it("resolves duplicates by ignoring incoming files without deleting them", async () => {
    const { getDB } = await import("@core/lib/db");
    const { createPrismaImageRepo } = await import(
      "@core/lib/repositories/prisma-image-repo"
    );
    const { createDuplicateService } = await import(
      "@core/services/duplicate-service"
    );
    const { fileHash } = await import("@core/lib/image-infra");
    const imageRepo = createPrismaImageRepo(getDB);
    const ignoredPaths = new Set<string>();
    const duplicateService = createDuplicateService({
      imageRepo,
      hashFile: fileHash,
      ignoredDuplicates: {
        ensureLoaded: async () => {},
        isIgnored: async (p) => ignoredPaths.has(p),
        register: async (paths) => { for (const p of paths) ignoredPaths.add(p); },
        forget: async (p) => { ignoredPaths.delete(p); },
        list: async () => [...ignoredPaths],
        clear: async () => { const n = ignoredPaths.size; ignoredPaths.clear(); return n; },
      },
    });
    const { existingImage, existingPath, folderPath, content } =
      await seedExistingDuplicateData();

    const incomingPath = path.join(folderPath, "ignored-incoming.png");
    fs.writeFileSync(incomingPath, content);

    const result = await duplicateService.resolve([
      {
        id: "dup-3",
        hash: "hash",
        keep: "ignore",
        existingEntries: [{ imageId: existingImage.id, path: existingPath }],
        incomingPaths: [incomingPath],
      },
    ]);

    expect(result.removedImageIds).toEqual([]);
    expect(result.retainedIncomingPaths).toEqual([]);
    expect(result.touchedIncomingPaths).toEqual([incomingPath]);
    expect(fs.existsSync(existingPath)).toBe(true);
    expect(fs.existsSync(incomingPath)).toBe(true);
    await expect(duplicateService.isIgnored(incomingPath)).resolves.toBe(true);
    await expect(duplicateService.listIgnored()).resolves.toEqual([incomingPath]);
  });
});
