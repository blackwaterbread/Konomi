import type { PrismaClient } from "../../../../generated/prisma/client";
import type { NaiConfigEntity } from "@core/types/repository";
import { resolveAccessors, type RepoDbAccessors } from "./db-accessors";

export type NaiConfigRepo = ReturnType<typeof createPrismaNaiConfigRepo>;

export function createPrismaNaiConfigRepo(
  arg: (() => PrismaClient) | RepoDbAccessors,
) {
  const { write } = resolveAccessors(arg);
  return {
    async get(): Promise<NaiConfigEntity> {
      return write().naiConfig.upsert({
        where: { id: 1 },
        update: {},
        create: { id: 1 },
      });
    },

    async update(patch: { apiKey?: string }): Promise<NaiConfigEntity> {
      return write().naiConfig.upsert({
        where: { id: 1 },
        update: patch,
        create: { id: 1, ...patch },
      });
    },
  };
}
