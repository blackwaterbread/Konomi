import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPromptTagService,
  normalizePromptTerm,
} from "../../../src/core/services/prompt-tag-service";

const openDatabase = (filePath: string, options: { readonly: boolean; fileMustExist: boolean }) =>
  new Database(filePath, options);

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "konomi-prompts-db-test-"));
  tempDirs.push(dir);
  return dir;
}

function createPromptDb(options?: {
  meta?: Record<string, string>;
  tags?: Array<{ tag: string; count: number }>;
}): string {
  const dir = createTempDir();
  const dbPath = path.join(dir, "prompts.db");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE prompts_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE prompt_tag (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag TEXT NOT NULL,
      post_count INTEGER NOT NULL DEFAULT 0
    );
  `);

  for (const [key, value] of Object.entries(options?.meta ?? {})) {
    db.prepare(`INSERT INTO prompts_meta (key, value) VALUES (?, ?)`).run(
      key,
      value,
    );
  }
  for (const row of options?.tags ?? []) {
    db.prepare(`INSERT INTO prompt_tag (tag, post_count) VALUES (?, ?)`).run(
      row.tag,
      row.count,
    );
  }
  db.close();
  return dbPath;
}

let service: ReturnType<typeof createPromptTagService> | null = null;

describe("prompt-tag-service", () => {
  afterEach(() => {
    service?.close();
    service = null;

    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (!dir) continue;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("reads schema version metadata and returns null for missing files", () => {
    const dbPath = createPromptDb({
      meta: { schema_version: "7" },
    });
    service = createPromptTagService({ getDbPath: () => dbPath, openDatabase });

    expect(service.getSchemaVersion()).toBe(7);

    const missingService = createPromptTagService({
      getDbPath: () => path.join(path.dirname(dbPath), "missing.db"),
      openDatabase,
    });
    expect(missingService.getSchemaVersion()).toBe(null);
  });

  it("suggests normalized tags, applies exclusions, and reuses metadata stats", () => {
    const dbPath = createPromptDb({
      meta: {
        schema_version: "3",
        tag_count_total: "4",
        tag_count_max: "120",
        tag_count_bucket_thresholds: JSON.stringify([60, 80, 100, 120]),
      },
      tags: [
        { tag: "sunset_beach", count: 120 },
        { tag: "sunset city", count: 80 },
        { tag: "sunrise", count: 50 },
        { tag: "sun", count: 70 },
      ],
    });
    service = createPromptTagService({ getDbPath: () => dbPath, openDatabase });

    const result = service.suggestTags({
      prefix: " Sun ",
      limit: 2,
      exclude: ["sunset_city", "sunset city"],
    });

    expect(normalizePromptTerm(" Sunset_Beach  ")).toBe("sunset beach");
    expect(result.suggestions).toEqual([
      { tag: "sun", count: 70 },
      { tag: "sunset_beach", count: 120 },
    ]);
    expect(result.stats).toEqual({
      totalTags: 4,
      maxCount: 120,
      bucketThresholds: [60, 80, 100, 120],
    });
  });

  it("computes fallback prompt-tag stats when metadata thresholds are absent", () => {
    const dbPath = createPromptDb({
      meta: {
        schema_version: "4",
        tag_count_total: "10",
        tag_count_max: "100",
      },
      tags: [
        { tag: "tag-100", count: 100 },
        { tag: "tag-90", count: 90 },
        { tag: "tag-80", count: 80 },
        { tag: "tag-70", count: 70 },
        { tag: "tag-60", count: 60 },
        { tag: "tag-50", count: 50 },
        { tag: "tag-40", count: 40 },
        { tag: "tag-30", count: 30 },
        { tag: "tag-20", count: 20 },
        { tag: "tag-10", count: 10 },
      ],
    });
    service = createPromptTagService({ getDbPath: () => dbPath, openDatabase });

    const result = service.suggestTags({
      prefix: "tag-",
      limit: 3,
    });

    expect(result.suggestions).toEqual([
      { tag: "tag-100", count: 100 },
      { tag: "tag-90", count: 90 },
      { tag: "tag-80", count: 80 },
    ]);
    expect(result.stats).toEqual({
      totalTags: 10,
      maxCount: 100,
      bucketThresholds: [90, 100, 100, 100],
    });
  });
});
