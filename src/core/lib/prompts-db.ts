import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

export const PROMPTS_DB_FILENAME = "prompts.db";

function resolvePromptsDBPath(): string {
  const overridePath = (process.env.KONOMI_PROMPTS_DB_PATH ?? "").trim();
  if (overridePath) return overridePath;

  const userDataPath = (process.env.KONOMI_USER_DATA ?? "").trim();
  if (!userDataPath) {
    throw new Error("KONOMI_USER_DATA is not set for prompts.db access");
  }

  return path.join(userDataPath, PROMPTS_DB_FILENAME);
}

export function getPromptsDBPath(): string {
  return resolvePromptsDBPath();
}

export function hasPromptsDB(): boolean {
  return fs.existsSync(getPromptsDBPath());
}

export function readPromptsDBSchemaVersion(
  dbPath = getPromptsDBPath(),
): number | null {
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, {
      readonly: true,
      fileMustExist: true,
    });
    db.pragma("query_only = ON");
    const row = db
      .prepare(
        `SELECT value
         FROM prompts_meta
         WHERE key = 'schema_version'
         LIMIT 1`,
      )
      .get() as { value?: string | number } | undefined;
    const version = Number.parseInt(String(row?.value ?? ""), 10);
    return Number.isFinite(version) ? version : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}
