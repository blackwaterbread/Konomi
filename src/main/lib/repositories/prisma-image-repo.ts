import type { PrismaClient } from "../../../generated/prisma/client";
import type {
  ImageRepository,
  ImageEntity,
  ImageSyncRow,
  ImageUpsertData,
  SearchStatSource,
} from "@core/types/repository";

export function createPrismaImageRepo(
  getDb: () => PrismaClient,
): ImageRepository {
  return {
    async findById(id: number): Promise<ImageEntity | null> {
      return getDb().image.findUnique({ where: { id } }) as Promise<ImageEntity | null>;
    },

    async findByPath(path: string): Promise<ImageEntity | null> {
      return getDb().image.findUnique({ where: { path } }) as Promise<ImageEntity | null>;
    },

    async findSyncRowsByFolderId(folderId: number): Promise<ImageSyncRow[]> {
      return getDb().image.findMany({
        where: { folderId },
        select: { id: true, path: true, fileModifiedAt: true, source: true },
      });
    },

    async upsertBatch(rows: ImageUpsertData[]): Promise<ImageEntity[]> {
      const db = getDb();
      return db.$transaction(
        rows.map((data) =>
          db.image.upsert({
            where: { path: data.path },
            update: data,
            create: data,
          }),
        ),
      ) as Promise<ImageEntity[]>;
    },

    async upsertByPath(data: ImageUpsertData): Promise<ImageEntity> {
      return getDb().image.upsert({
        where: { path: data.path },
        update: data,
        create: data,
      }) as Promise<ImageEntity>;
    },

    async deleteByIds(ids: number[]): Promise<void> {
      if (ids.length === 0) return;
      await getDb().image.deleteMany({ where: { id: { in: ids } } });
    },

    async deleteByPath(path: string): Promise<void> {
      await getDb().image.deleteMany({ where: { path } });
    },

    async setFavorite(id: number, isFavorite: boolean): Promise<void> {
      await getDb().image.update({ where: { id }, data: { isFavorite } });
    },

    async countByFolderId(folderId: number): Promise<number> {
      return getDb().image.count({ where: { folderId } });
    },

    async existsByPath(path: string): Promise<boolean> {
      const row = await getDb().image.findUnique({
        where: { path },
        select: { id: true },
      });
      return row !== null;
    },

    async updateFolderScanMeta(
      folderId: number,
      fileCount: number,
      finishedAt: Date,
    ): Promise<void> {
      await getDb().folder.update({
        where: { id: folderId },
        data: {
          lastScanFileCount: fileCount,
          lastScanFinishedAt: finishedAt,
        },
      });
    },

    async getPathsByFolderId(
      folderId: number,
    ): Promise<Array<{ id: number; path: string }>> {
      const CHUNK = 5000;
      const result: Array<{ id: number; path: string }> = [];
      let lastId = 0;
      const db = getDb();
      while (true) {
        const images = await db.image.findMany({
          where: { folderId, id: { gt: lastId } },
          select: { id: true, path: true },
          orderBy: { id: "asc" },
          take: CHUNK,
        });
        if (images.length === 0) break;
        lastId = images[images.length - 1].id;
        result.push(...images);
      }
      return result;
    },

    async sumFileSizeByFolderId(folderId: number): Promise<number> {
      const CHUNK = 5000;
      let totalBytes = 0;
      let lastId = 0;
      const db = getDb();
      while (true) {
        const images = await db.image.findMany({
          where: { folderId, id: { gt: lastId } },
          select: { id: true, fileSize: true },
          orderBy: { id: "asc" },
          take: CHUNK,
        });
        if (images.length === 0) break;
        lastId = images[images.length - 1].id;
        for (const img of images) {
          if (img.fileSize) totalBytes += img.fileSize;
        }
      }
      return totalBytes;
    },

    async findIdsByPromptContaining(query: string): Promise<number[]> {
      const images = await getDb().image.findMany({
        where: {
          OR: [
            { prompt: { contains: query } },
            { characterPrompts: { contains: query } },
          ],
        },
        select: { id: true },
      });
      return images.map((img) => img.id);
    },

    async findByFileSize(
      sizes: number[],
    ): Promise<Array<{ id: number; path: string; fileSize: number }>> {
      if (sizes.length === 0) return [];
      const db = getDb();
      const CHUNK = 500;
      const result: Array<{ id: number; path: string; fileSize: number }> = [];
      for (let i = 0; i < sizes.length; i += CHUNK) {
        const chunk = sizes.slice(i, i + CHUNK);
        const rows = await db.image.findMany({
          where: { fileSize: { in: chunk } },
          select: { id: true, path: true, fileSize: true },
        });
        result.push(...rows);
      }
      return result;
    },

    async findSearchStatSourcesByPaths(
      paths: string[],
    ): Promise<Array<{ path: string } & SearchStatSource>> {
      if (paths.length === 0) return [];
      const rows = await getDb().image.findMany({
        where: { path: { in: paths } },
        select: {
          path: true,
          width: true,
          height: true,
          model: true,
          promptTokens: true,
          negativePromptTokens: true,
          characterPromptTokens: true,
        },
      });
      return rows as Array<{ path: string } & SearchStatSource>;
    },

    async findSearchStatSourcesByIds(
      ids: number[],
    ): Promise<SearchStatSource[]> {
      if (ids.length === 0) return [];
      const rows = await getDb().image.findMany({
        where: { id: { in: ids } },
        select: {
          width: true,
          height: true,
          model: true,
          promptTokens: true,
          negativePromptTokens: true,
          characterPromptTokens: true,
        },
      });
      return rows as SearchStatSource[];
    },
  };
}
