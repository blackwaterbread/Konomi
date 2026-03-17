import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

export const PROMPTS_DB_FILENAME = "prompts.db";

let promptsDB: Database.Database | null = null;

function resolvePromptsDBPath(): string {
  const overridePath = (process.env.KONOMI_PROMPTS_DB_PATH ?? "").trim();
  if (overridePath) return overridePath;

  return path.join(process.env.KONOMI_USER_DATA!, PROMPTS_DB_FILENAME);
}

export function getPromptsDBPath(): string {
  return resolvePromptsDBPath();
}

export function hasPromptsDB(): boolean {
  return fs.existsSync(getPromptsDBPath());
}

export function normalizePromptTerm(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
}

export function getPromptsDB(): Database.Database {
  if (!promptsDB) {
    const dbPath = getPromptsDBPath();
    promptsDB = new Database(dbPath, {
      readonly: true,
      fileMustExist: true,
    });
    promptsDB.pragma("foreign_keys = ON");
    promptsDB.pragma("query_only = ON");
  }

  return promptsDB;
}

export function closePromptsDB(): void {
  promptsDB?.close();
  promptsDB = null;
}
