import type { PrismaClient } from "../../../generated/prisma/client";
import type { CategoryEntity } from "@core/types/repository";

export type CategoryRepo = ReturnType<typeof createPrismaCategoryRepo>;

function normalizeImageIds(imageIds: number[]): number[] {
  return [...new Set(imageIds.filter((id) => Number.isInteger(id)))];
}

export function createPrismaCategoryRepo(getDb: () => PrismaClient) {
  return {
    async findAll(): Promise<CategoryEntity[]> {
      return getDb().category.findMany({
        orderBy: [{ isBuiltin: "desc" }, { order: "asc" }],
      });
    },

    async findById(id: number): Promise<CategoryEntity | null> {
      return getDb().category.findUnique({ where: { id } });
    },

    async create(name: string): Promise<CategoryEntity> {
      const db = getDb();
      const last = await db.category.findFirst({
        where: { isBuiltin: false },
        orderBy: { order: "desc" },
      });
      return db.category.create({
        data: { name, order: (last?.order ?? -1) + 1 },
      });
    },

    async delete(id: number): Promise<void> {
      await getDb().category.delete({ where: { id } });
    },

    async rename(id: number, name: string): Promise<CategoryEntity> {
      return getDb().category.update({ where: { id }, data: { name } });
    },

    async updateColor(
      id: number,
      color: string | null,
    ): Promise<CategoryEntity> {
      return getDb().category.update({ where: { id }, data: { color } });
    },

    async addImage(imageId: number, categoryId: number): Promise<void> {
      await getDb().imageCategory.upsert({
        where: { imageId_categoryId: { imageId, categoryId } },
        create: { imageId, categoryId },
        update: {},
      });
    },

    async removeImage(imageId: number, categoryId: number): Promise<void> {
      await getDb().imageCategory.deleteMany({
        where: { imageId, categoryId },
      });
    },

    async addImages(imageIds: number[], categoryId: number): Promise<void> {
      const uniqueIds = normalizeImageIds(imageIds);
      if (uniqueIds.length === 0) return;

      const db = getDb();
      const existing = await db.imageCategory.findMany({
        where: { categoryId, imageId: { in: uniqueIds } },
        select: { imageId: true },
      });
      const existingSet = new Set(existing.map((r) => r.imageId));
      const newData = uniqueIds
        .filter((id) => !existingSet.has(id))
        .map((imageId) => ({ imageId, categoryId }));

      if (newData.length > 0) {
        await db.imageCategory.createMany({ data: newData });
      }
    },

    async removeImages(imageIds: number[], categoryId: number): Promise<void> {
      const uniqueIds = normalizeImageIds(imageIds);
      if (uniqueIds.length === 0) return;

      await getDb().imageCategory.deleteMany({
        where: { categoryId, imageId: { in: uniqueIds } },
      });
    },

    async getImageIds(categoryId: number): Promise<number[]> {
      const rows = await getDb().imageCategory.findMany({
        where: { categoryId },
        select: { imageId: true },
      });
      return rows.map((r) => r.imageId);
    },

    async getCategoriesForImage(imageId: number): Promise<number[]> {
      const rows = await getDb().imageCategory.findMany({
        where: { imageId },
        select: { categoryId: true },
      });
      return rows.map((r) => r.categoryId);
    },

    async getCommonCategoriesForImages(
      imageIds: number[],
    ): Promise<number[]> {
      const uniqueIds = normalizeImageIds(imageIds);
      if (uniqueIds.length === 0) return [];

      const rows = await getDb().imageCategory.findMany({
        where: { imageId: { in: uniqueIds } },
        select: { categoryId: true, imageId: true },
      });

      const catToImages = new Map<number, Set<number>>();
      for (const row of rows) {
        if (!catToImages.has(row.categoryId)) {
          catToImages.set(row.categoryId, new Set());
        }
        catToImages.get(row.categoryId)!.add(row.imageId);
      }

      const result: number[] = [];
      for (const [catId, ids] of catToImages) {
        if (ids.size === uniqueIds.length) result.push(catId);
      }
      return result;
    },

    async seedBuiltins(): Promise<void> {
      const db = getDb();
      const builtins = [
        { name: "즐겨찾기", order: 0 },
        { name: "랜덤 픽", order: 1 },
      ];
      for (const { name, order } of builtins) {
        const existing = await db.category.findFirst({
          where: { isBuiltin: true, name },
        });
        if (!existing) {
          await db.category.create({
            data: { name, isBuiltin: true, order },
          });
        }
      }
    },
  };
}
