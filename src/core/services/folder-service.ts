import fs from "fs/promises";
import path from "path";
import type {
  FolderRepository,
  FolderEntity,
  ImageRepository,
} from "../types/repository";

export type FolderServiceDeps = {
  folderRepo: FolderRepository;
  imageRepo: ImageRepository;
};

export type FolderStats = {
  path: string;
  imageCount: number;
  createdAt: Date;
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
  const { folderRepo, imageRepo } = deps;

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

    async getSubfolderPaths(folderId: number): Promise<string[]> {
      const folder = await folderRepo.findById(folderId);
      if (!folder) return [];

      const sep = process.platform === "win32" ? "\\" : "/";
      const folderNorm =
        process.platform === "win32"
          ? folder.path.toLowerCase()
          : folder.path;
      const prefix = folderNorm.endsWith(sep) ? folderNorm : folderNorm + sep;

      const images = await imageRepo.getPathsByFolderId(folderId);
      const subfolderSet = new Set<string>();
      for (const img of images) {
        const imgNorm =
          process.platform === "win32" ? img.path.toLowerCase() : img.path;
        if (!imgNorm.startsWith(prefix)) continue;
        const rel = imgNorm.slice(prefix.length);
        const firstSep = rel.indexOf(sep);
        if (firstSep === -1) continue;
        subfolderSet.add(prefix + rel.slice(0, firstSep));
      }

      return [...subfolderSet].sort();
    },

    async getStats(id: number): Promise<FolderStats | null> {
      const folder = await folderRepo.findById(id);
      if (!folder) return null;

      return {
        path: folder.path,
        imageCount: await imageRepo.countByFolderId(id),
        createdAt: folder.createdAt,
      };
    },

    async getSize(id: number): Promise<number> {
      return imageRepo.sumFileSizeByFolderId(id);
    },
  };
}

export type FolderService = ReturnType<typeof createFolderService>;
