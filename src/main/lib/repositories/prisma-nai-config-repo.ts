import type { PrismaClient } from "../../../generated/prisma/client";
import type {
  NaiConfigRepository,
  NaiConfigEntity,
} from "@core/types/repository";

export function createPrismaNaiConfigRepo(
  getDb: () => PrismaClient,
): NaiConfigRepository {
  return {
    async get(): Promise<NaiConfigEntity> {
      return getDb().naiConfig.upsert({
        where: { id: 1 },
        update: {},
        create: { id: 1 },
      });
    },

    async update(patch: { apiKey?: string }): Promise<NaiConfigEntity> {
      return getDb().naiConfig.upsert({
        where: { id: 1 },
        update: patch,
        create: { id: 1, ...patch },
      });
    },
  };
}
