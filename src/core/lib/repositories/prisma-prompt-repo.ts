import type { PrismaClient } from "../../../../generated/prisma/client";
import type {
  PromptCategoryEntity,
  PromptGroupEntity,
  PromptTokenEntity,
} from "@core/types/repository";

export type PromptRepo = ReturnType<typeof createPrismaPromptRepo>;

export function createPrismaPromptRepo(getDb: () => PrismaClient) {
  return {
    async listCategories(): Promise<PromptCategoryEntity[]> {
      return getDb().promptCategory.findMany({
        orderBy: { order: "asc" },
        include: {
          groups: {
            orderBy: { order: "asc" },
            include: { tokens: { orderBy: { order: "asc" } } },
          },
        },
      });
    },

    async createCategory(name: string): Promise<PromptCategoryEntity> {
      const db = getDb();
      const last = await db.promptCategory.findFirst({
        orderBy: { order: "desc" },
      });
      return db.promptCategory.create({
        data: { name, isBuiltin: false, order: (last?.order ?? -1) + 1 },
        include: { groups: { include: { tokens: true } } },
      });
    },

    async renameCategory(id: number, name: string): Promise<void> {
      await getDb().promptCategory.update({ where: { id }, data: { name } });
    },

    async deleteCategory(id: number): Promise<void> {
      await getDb().promptCategory.delete({ where: { id } });
    },

    async resetCategories(
      defaults: Array<{ name: string; order: number }>,
    ): Promise<void> {
      const db = getDb();
      await db.promptCategory.deleteMany();
      await db.promptCategory.createMany({
        data: defaults.map((d) => ({
          name: d.name,
          isBuiltin: true,
          order: d.order,
        })),
      });
    },

    async createGroup(
      categoryId: number,
      name: string,
    ): Promise<PromptGroupEntity> {
      const db = getDb();
      const last = await db.promptGroup.findFirst({
        where: { categoryId },
        orderBy: { order: "desc" },
      });
      return db.promptGroup.create({
        data: { name, categoryId, order: (last?.order ?? -1) + 1 },
        include: { tokens: true },
      });
    },

    async deleteGroup(id: number): Promise<void> {
      await getDb().promptGroup.delete({ where: { id } });
    },

    async renameGroup(id: number, name: string): Promise<void> {
      await getDb().promptGroup.update({ where: { id }, data: { name } });
    },

    async createToken(
      groupId: number,
      label: string,
    ): Promise<PromptTokenEntity> {
      const db = getDb();
      const last = await db.promptToken.findFirst({
        where: { groupId },
        orderBy: { order: "desc" },
      });
      return db.promptToken.create({
        data: { label, groupId, order: (last?.order ?? -1) + 1 },
      });
    },

    async deleteToken(id: number): Promise<void> {
      await getDb().promptToken.delete({ where: { id } });
    },

    async reorderGroups(ids: number[]): Promise<void> {
      const db = getDb();
      await db.$transaction(
        ids.map((id, i) =>
          db.promptGroup.update({ where: { id }, data: { order: i } }),
        ),
      );
    },

    async reorderTokens(ids: number[]): Promise<void> {
      const db = getDb();
      await db.$transaction(
        ids.map((id, i) =>
          db.promptToken.update({ where: { id }, data: { order: i } }),
        ),
      );
    },

    async seedDefaults(
      defaults: Array<{ name: string; order: number }>,
    ): Promise<void> {
      const db = getDb();
      const count = await db.promptCategory.count();
      if (count > 0) return;
      await db.promptCategory.createMany({
        data: defaults.map((d) => ({
          name: d.name,
          isBuiltin: true,
          order: d.order,
        })),
      });
    },
  };
}
