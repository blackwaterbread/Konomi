import type { PrismaClient } from "../../../../generated/prisma/client";
import type { FolderEntity } from "@core/types/repository";
import { resolveAccessors, type RepoDbAccessors } from "./db-accessors";

export type FolderRepo = ReturnType<typeof createPrismaFolderRepo>;

export function createPrismaFolderRepo(
  arg: (() => PrismaClient) | RepoDbAccessors,
) {
  const { read, write } = resolveAccessors(arg);
  return {
    async findAll(): Promise<FolderEntity[]> {
      return read().folder.findMany({ orderBy: { createdAt: "asc" } });
    },

    async findById(id: number): Promise<FolderEntity | null> {
      return read().folder.findUnique({ where: { id } });
    },

    async create(name: string, path: string): Promise<FolderEntity> {
      const db = write();
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
      const db = write();
      await db.$transaction(async (tx) => {
        await tx.imageCategory.deleteMany({
          where: { image: { folderId: id } },
        });
        await tx.image.deleteMany({ where: { folderId: id } });
        await tx.folder.delete({ where: { id } });
      });
    },

    async rename(id: number, name: string): Promise<FolderEntity> {
      return write().folder.update({ where: { id }, data: { name } });
    },
  };
}
