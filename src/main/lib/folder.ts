import fs from "fs/promises";
import path from "path";
import { getDB } from "./db";

export type FolderRow = {
  id: number;
  name: string;
  path: string;
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

export async function getFolders(): Promise<FolderRow[]> {
  return getDB().folder.findMany({ orderBy: { createdAt: "asc" } });
}

export async function createFolder(
  name: string,
  path: string,
): Promise<FolderRow> {
  const db = getDB();
  const normalizedPath = await normalizeFolderPath(path);
  const existingFolders = await db.folder.findMany({
    select: { id: true, name: true, path: true, createdAt: true },
  });
  for (const folder of existingFolders) {
    const normalizedExistingPath = await normalizeFolderPath(folder.path);
    if (normalizedExistingPath === normalizedPath) {
      throw new Error("이미 추가된 폴더 경로입니다.");
    }
  }

  try {
    return await db.folder.create({ data: { name, path } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    if (
      message.includes("Unique constraint failed") &&
      message.includes("path")
    ) {
      throw new Error("이미 추가된 폴더 경로입니다.");
    }
    throw e;
  }
}

export async function deleteFolder(id: number): Promise<void> {
  await getDB().folder.delete({ where: { id } });
}

export async function renameFolder(
  id: number,
  name: string,
): Promise<FolderRow> {
  return getDB().folder.update({ where: { id }, data: { name } });
}

export async function getSubfolderPaths(folderId: number): Promise<string[]> {
  const db = getDB();
  const folder = await db.folder.findUnique({ where: { id: folderId } });
  if (!folder) return [];

  const sep = process.platform === "win32" ? "\\" : "/";
  const folderNorm =
    process.platform === "win32" ? folder.path.toLowerCase() : folder.path;
  const prefix = folderNorm.endsWith(sep) ? folderNorm : folderNorm + sep;

  const CHUNK = 5000;
  const subfolderSet = new Set<string>();
  let lastId = 0;
  while (true) {
    const images = await db.image.findMany({
      where: { folderId, id: { gt: lastId } },
      select: { id: true, path: true },
      orderBy: { id: "asc" },
      take: CHUNK,
    });
    if (images.length === 0) break;
    lastId = images[images.length - 1].id;
    for (const img of images) {
      const imgNorm =
        process.platform === "win32" ? img.path.toLowerCase() : img.path;
      if (!imgNorm.startsWith(prefix)) continue;
      const rel = imgNorm.slice(prefix.length);
      const firstSep = rel.indexOf(sep);
      if (firstSep === -1) continue; // image is directly in folder root
      subfolderSet.add(prefix + rel.slice(0, firstSep));
    }
  }

  return [...subfolderSet].sort();
}

export type FolderStats = {
  path: string;
  imageCount: number;
  createdAt: Date;
};

export async function getFolderStats(id: number): Promise<FolderStats | null> {
  const db = getDB();
  const folder = await db.folder.findUnique({ where: { id } });
  if (!folder) return null;

  return {
    path: folder.path,
    imageCount: await db.image.count({ where: { folderId: id } }),
    createdAt: folder.createdAt,
  };
}

export async function getFolderSize(id: number): Promise<number> {
  const db = getDB();
  const CHUNK = 5000;
  let totalBytes = 0;
  let lastId = 0;
  while (true) {
    const images = await db.image.findMany({
      where: { folderId: id, id: { gt: lastId } },
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
}
