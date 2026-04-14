import type { PrismaClient } from "../../../generated/prisma/client";
import type { NaiConfigEntity } from "@core/types/repository";

export type NaiConfigRepo = ReturnType<typeof createPrismaNaiConfigRepo>;

export function createPrismaNaiConfigRepo(getDb: () => PrismaClient) {
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
