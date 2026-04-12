import fs from "fs/promises";
import path from "path";
import type { FolderRepository, FolderEntity } from "../types/repository";

export type FolderServiceDeps = {
  folderRepo: FolderRepository;
};

async function normalizeFolderPath(folderPath: string): Promise<string> {
  const resolved = path.resolve(folderPath.trim());
  try {
    const realPath = await fs.realpath(resolved);
    const normalized = path.normalize(realPath);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  } catch {
    const normalized = path.normalize(resolved);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  }
}

export function createFolderService(deps: FolderServiceDeps) {
  const { folderRepo } = deps;

  return {
    async list(): Promise<FolderEntity[]> {
      return folderRepo.findAll();
    },

    async create(name: string, folderPath: string): Promise<FolderEntity> {
      const normalizedPath = await normalizeFolderPath(folderPath);
      const existing = await folderRepo.findAll();
      for (const folder of existing) {
        const normalizedExisting = await normalizeFolderPath(folder.path);
        if (normalizedExisting === normalizedPath) {
          throw new Error("Folder path already registered");
        }
      }
      return folderRepo.create(name, folderPath);
    },

    async delete(id: number): Promise<void> {
      return folderRepo.delete(id);
    },

    async rename(id: number, name: string): Promise<FolderEntity> {
      return folderRepo.rename(id, name);
    },

    async getById(id: number): Promise<FolderEntity | null> {
      return folderRepo.findById(id);
    },
  };
}

export type FolderService = ReturnType<typeof createFolderService>;
