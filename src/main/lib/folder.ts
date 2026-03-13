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
    return process.platform === "win32"
      ? normalized.toLowerCase()
      : normalized;
  } catch {
    const normalized = path.normalize(resolved);
    return process.platform === "win32"
      ? normalized.toLowerCase()
      : normalized;
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
