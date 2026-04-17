import type { PrismaClient } from "../../../../generated/prisma/client";
import type { FolderEntity } from "@core/types/repository";

export type FolderRepo = ReturnType<typeof createPrismaFolderRepo>;

export function createPrismaFolderRepo(getDb: () => PrismaClient) {
  return {
    async findAll(): Promise<FolderEntity[]> {
      return getDb().folder.findMany({ orderBy: { createdAt: "asc" } });
    },

    async findById(id: number): Promise<FolderEntity | null> {
      return getDb().folder.findUnique({ where: { id } });
    },

    async create(name: string, path: string): Promise<FolderEntity> {
      const db = getDb();
      try {
        return await db.folder.create({ data: { name, path } });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        if (
          message.includes("Unique constraint failed") &&
          message.includes("path")
        ) {
          throw new Error("Folder path already registered");
        }
        throw e;
      }
    },

    async delete(id: number): Promise<void> {
      const db = getDb();
      await db.$transaction(async (tx) => {
        await tx.imageCategory.deleteMany({
          where: { image: { folderId: id } },
        });
        await tx.image.deleteMany({ where: { folderId: id } });
        await tx.folder.delete({ where: { id } });
      });
    },

    async rename(id: number, name: string): Promise<FolderEntity> {
      return getDb().folder.update({ where: { id }, data: { name } });
    },
  };
}
