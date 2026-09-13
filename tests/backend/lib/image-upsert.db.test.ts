import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageUpsertData } from "@core/types/repository";
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

async function setup() {
  const { getDB, getReadDB, dbReady } = await import("@core/lib/db");
  const { createPrismaImageRepo } =
    await import("@core/lib/repositories/prisma-image-repo");
  const db = getDB();
  await dbReady();
  const folder = await db.folder.create({
    data: { name: "bulk", path: ctx.userDataDir },
  });
  const repo = createPrismaImageRepo({ read: getReadDB, write: getDB });
  const row = (index: number): ImageUpsertData => ({
    path: path.join(ctx.userDataDir, `${index}.png`),
    folderId: folder.id,
    prompt: `한글 ' ? ); DROP TABLE Image; -- ${index}`,
    negativePrompt: "negative",
    characterPrompts: "[]",
    promptTokens: "[]",
    negativePromptTokens: "[]",
    characterPromptTokens: "[]",
    source: "nai",
    model: "test",
    seed: "12345678901234567890",
    width: 832,
    height: 1216,
    sampler: "test",
    steps: 28,
    cfgScale: 6.5,
    cfgRescale: 0.3,
    noiseSchedule: "karras",
    varietyPlus: true,
    fileSize: 123,
    fileModifiedAt: new Date("2026-09-13T01:02:03.456Z"),
  });
  return { db, repo, row };
}

describe("bulk image upserts", () => {
  it("generates bound MariaDB upserts and orders results using DB path matches", async () => {
    const { repo, row } = await setup();
    const saved = await repo.upsertBatch([row(1), row(2)]);
    const dbModule = await import("@core/lib/db");
    const { createPrismaImageRepo } =
      await import("@core/lib/repositories/prisma-image-repo");
    const execute = vi.fn().mockResolvedValue(2);
    const query = vi.fn().mockResolvedValue([
      { ordinal: 0, id: saved[1].id },
      { ordinal: 1, id: saved[0].id },
    ]);
    const tx = {
      $executeRawUnsafe: execute,
      $queryRawUnsafe: query,
      image: { findMany: vi.fn().mockResolvedValue(saved) },
    };
    const fakeDb = { $transaction: vi.fn(async (callback) => callback(tx)) };
    vi.spyOn(dbModule, "getDialect").mockReturnValue("mysql");
    const mysqlRepo = createPrismaImageRepo(() => fakeDb as never);
    // Let the simulated DB collation resolve uppercase spellings to saved rows.
    const input = [row(2), row(1)].map((r) => ({
      ...r,
      path: r.path.toUpperCase(),
    }));
    expect(await mysqlRepo.upsertBatch(input)).toEqual([saved[1], saved[0]]);
    const [sql, ...parameters] = execute.mock.calls[0];
    expect(sql).toContain("ON DUPLICATE KEY UPDATE");
    expect(sql).toContain("`prompt` = VALUES(`prompt`)");
    expect(sql).not.toContain(input[0].prompt);
    expect(parameters).toContain(input[0].prompt);
    expect(parameters).toContain(input[0].fileModifiedAt);
    expect(sql).not.toMatch(/isFavorite|pHash|createdAt/);
    expect(query.mock.calls[0].slice(1)).toEqual([
      0,
      input[0].path,
      1,
      input[1].path,
    ]);
  });

  it("round-trips metadata across chunks in input order and reads its own writes", async () => {
    const { repo, row } = await setup();
    const input = Array.from({ length: 70 }, (_, i) => row(70 - i));
    const result = await repo.upsertBatch(input);
    expect(result).toHaveLength(input.length);
    result.forEach((saved, index) => {
      expect(saved).toMatchObject(input[index]);
      expect(saved.createdAt).toBeInstanceOf(Date);
      expect(saved.isFavorite).toBe(false);
      expect(saved.pHash).toBe("");
    });
    expect(new Set(result.map((saved) => saved.id)).size).toBe(70);
  });

  it("updates metadata while preserving identity, favorites, hashes and categories", async () => {
    const { db, repo, row } = await setup();
    const [before] = await repo.upsertBatch([row(1)]);
    await db.image.update({
      where: { id: before.id },
      data: { isFavorite: true, pHash: "hash" },
    });
    const category = await db.category.create({
      data: { name: "keep", order: 0 },
    });
    await db.imageCategory.create({
      data: { imageId: before.id, categoryId: category.id },
    });
    const update = {
      ...row(1),
      prompt: "updated",
      varietyPlus: false,
      fileModifiedAt: new Date("2026-09-14T12:34:56.789Z"),
    };
    const [after, added] = await repo.upsertBatch([update, row(2)]);
    expect(after).toMatchObject({
      ...update,
      id: before.id,
      createdAt: before.createdAt,
      isFavorite: true,
      pHash: "hash",
    });
    expect(added.path).toBe(row(2).path);
    expect(await db.imageCategory.findMany()).toEqual([
      { imageId: before.id, categoryId: category.id },
    ]);
  });

  it("rolls back earlier chunks when a later foreign key fails", async () => {
    const { db, repo, row } = await setup();
    const [before] = await repo.upsertBatch([row(0)]);
    const input = Array.from({ length: 40 }, (_, i) => ({
      ...row(i),
      prompt: "changed",
    }));
    input[39].folderId = -1;
    await expect(repo.upsertBatch(input)).rejects.toThrow();
    expect(await db.image.findMany()).toEqual([before]);
  });

  it("performs one bulk write for a scan batch instead of per-image upserts", async () => {
    const { db, repo, row } = await setup();
    const original = db.$transaction.bind(db);
    const writes = vi.fn();
    const upserts = vi.fn();
    vi.spyOn(db, "$transaction").mockImplementation((async (
      callback,
      options,
    ) => {
      return original(
        async (tx) =>
          callback(
            new Proxy(tx, {
              get(target, key) {
                if (key === "$executeRawUnsafe")
                  return (...args: Parameters<typeof tx.$executeRawUnsafe>) => {
                    writes();
                    return target.$executeRawUnsafe(...args);
                  };
                if (key === "image")
                  return new Proxy(target.image, {
                    get(model, method) {
                      if (method === "upsert")
                        return (...args: Parameters<typeof model.upsert>) => {
                          upserts();
                          return model.upsert(...args);
                        };
                      return Reflect.get(model, method);
                    },
                  });
                return Reflect.get(target, key);
              },
            }),
          ),
        options,
      );
    }) as typeof db.$transaction);
    await expect(repo.upsertBatch([])).resolves.toEqual([]);
    expect(writes).not.toHaveBeenCalled();
    await repo.upsertBatch(Array.from({ length: 20 }, (_, i) => row(i)));
    expect(writes).toHaveBeenCalledOnce();
    expect(upserts).not.toHaveBeenCalled();
  });
});
