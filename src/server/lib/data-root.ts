import fs from "fs/promises";
import path from "path";
import { createLogger } from "@core/lib/logger";

const log = createLogger("web/data-root");

export const DATA_ROOT = process.env.KONOMI_DATA_ROOT || "/images";

export interface DetectedDirectory {
  name: string;
  path: string;
}

/**
 * Scan 1-depth subdirectories under DATA_ROOT.
 * In a Docker setup the user mounts volumes into this path:
 *   -v /mnt/nas/photos:/images/photos
 *   -v /home/user/art:/images/art
 */
export async function listAvailableDirectories(): Promise<DetectedDirectory[]> {
  try {
    const entries = await fs.readdir(DATA_ROOT, { withFileTypes: true });
    const dirs: DetectedDirectory[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      dirs.push({
        name: entry.name,
        path: path.join(DATA_ROOT, entry.name),
      });
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name));
    return dirs;
  } catch (err: any) {
    if (err.code === "ENOENT") {
      log.warn(`DATA_ROOT does not exist: ${DATA_ROOT}`);
      return [];
    }
    throw err;
  }
}

/**
 * Check whether DATA_ROOT itself exists. Used to distinguish "user removed all
 * volumes" from "DATA_ROOT misconfigured / not mounted" — the latter must not
 * trigger destructive reconciliation.
 */
export async function dataRootExists(): Promise<boolean> {
  try {
    await fs.access(DATA_ROOT);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether a path is under DATA_ROOT.
 */
export function isUnderDataRoot(target: string): boolean {
  const resolved = path.resolve(target);
  const root = path.resolve(DATA_ROOT);
  const rel = path.relative(root, resolved);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
