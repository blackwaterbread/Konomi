import fs from "fs";
import { createLogger } from "@core/lib/logger";

const log = createLogger("prompt-tag-service");

// ── Types ──────────────────────────────────────────────────────

export interface SqliteStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteConnection {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}

export type SqliteOpener = (
  path: string,
  options: { readonly: boolean; fileMustExist: boolean },
) => SqliteConnection;

export type PromptTagSearchQuery = {
  name?: string;
  sortBy?: "name" | "count";
  order?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

export type PromptTagSearchRow = {
  tag: string;
  postCount: number;
};

export type PromptTagSearchResult = {
  rows: PromptTagSearchRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type PromptTagSuggestQuery = {
  prefix: string;
  limit?: number;
  exclude?: string[];
};

export type PromptTagSuggestion = {
  tag: string;
  count: number;
};

export type PromptTagSuggestStats = {
  totalTags: number;
  maxCount: number;
  bucketThresholds: number[];
};

export type PromptTagSuggestResult = {
  suggestions: PromptTagSuggestion[];
  stats: PromptTagSuggestStats;
};

// ── Deps ───────────────────────────────────────────────────────

export type PromptTagServiceDeps = {
  getDbPath: () => string;
  openDatabase: SqliteOpener;
};

// ── Constants ──────────────────────────────────────────────────

const DEFAULT_SUGGEST_LIMIT = 8;
const MAX_SUGGEST_LIMIT = 20;
const NORMALIZED_TAG_SQL = "LOWER(REPLACE(tag, '_', ' '))";
const TAG_COUNT_BUCKET_PERCENTILES = [0.8, 0.95, 0.99, 0.999];
const DEFAULT_SEARCH_PAGE_SIZE = 50;
const MAX_SEARCH_PAGE_SIZE = 200;

// ── Pure helpers ───────────────────────────────────────────────

export function normalizePromptTerm(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
}

function normalizeSuggestLimit(limit?: number): number {
  const numeric = Number(limit);
  if (!Number.isFinite(numeric)) return DEFAULT_SUGGEST_LIMIT;
  return Math.max(1, Math.min(MAX_SUGGEST_LIMIT, Math.floor(numeric)));
}

function normalizeExcludedTags(exclude?: string[]): string[] {
  if (!Array.isArray(exclude) || exclude.length === 0) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of exclude) {
    const normalized = normalizePromptTerm(String(value ?? ""));
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function parseNonNegativeInteger(value: unknown): number {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function parseBucketThresholds(value: unknown): number[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => parseNonNegativeInteger(entry))
      .filter(
        (entry, index, array) => index === 0 || entry >= array[index - 1],
      );
  } catch {
    return [];
  }
}

function escapeSearchLike(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

function wildcardToLike(pattern: string): string {
  const escaped = escapeSearchLike(pattern);
  return escaped.replace(/\*/g, "%");
}

// ── Factory ────────────────────────────────────────────────────

const EMPTY_STATS: PromptTagSuggestStats = {
  totalTags: 0,
  maxCount: 0,
  bucketThresholds: [],
};

export function createPromptTagService(deps: PromptTagServiceDeps) {
  const { getDbPath, openDatabase } = deps;

  let db: SqliteConnection | null = null;
  let statsCache: PromptTagSuggestStats | null = null;

  function isAvailable(): boolean {
    return fs.existsSync(getDbPath());
  }

  function getDb(): SqliteConnection {
    if (!db) {
      db = openDatabase(getDbPath(), {
        readonly: true,
        fileMustExist: true,
      });
      db.exec("PRAGMA foreign_keys = ON");
      db.exec("PRAGMA query_only = ON");
    }
    return db;
  }

  function readPostCountAtOffset(
    database: SqliteConnection,
    offset: number,
  ): number {
    const row = database
      .prepare(
        `SELECT post_count
         FROM prompt_tag
         ORDER BY post_count DESC, id ASC
         LIMIT 1 OFFSET ?`,
      )
      .get(offset) as { post_count: number } | undefined;
    return parseNonNegativeInteger(row?.post_count);
  }

  function computeBucketThresholds(
    database: SqliteConnection,
    totalTags: number,
  ): number[] {
    if (totalTags <= 0) return [];
    return TAG_COUNT_BUCKET_PERCENTILES.map((percentile) => {
      const topFraction = Math.max(0, 1 - percentile);
      const offset = Math.max(0, Math.ceil(totalTags * topFraction) - 1);
      return readPostCountAtOffset(database, offset);
    });
  }

  function getStats(): PromptTagSuggestStats {
    if (statsCache) return statsCache;
    if (!isAvailable()) {
      statsCache = EMPTY_STATS;
      return statsCache;
    }

    try {
      const database = getDb();
      const metaRows = database
        .prepare(
          `SELECT key, value
           FROM prompts_meta
           WHERE key IN ('tag_count_total', 'tag_count_max', 'tag_count_bucket_thresholds')`,
        )
        .all() as Array<{ key: string; value: string }>;
      const meta = new Map(metaRows.map((row) => [row.key, row.value]));
      const totalTags = parseNonNegativeInteger(meta.get("tag_count_total"));
      const maxCount = parseNonNegativeInteger(meta.get("tag_count_max"));
      const bucketThresholds = parseBucketThresholds(
        meta.get("tag_count_bucket_thresholds"),
      );

      if (bucketThresholds.length > 0 || (totalTags === 0 && maxCount === 0)) {
        statsCache = { totalTags, maxCount, bucketThresholds };
        return statsCache;
      }

      const summary = database
        .prepare(
          `SELECT
             COUNT(*) AS total_tags,
             COALESCE(MAX(post_count), 0) AS max_count
           FROM prompt_tag`,
        )
        .get() as { total_tags: number; max_count: number };

      statsCache = {
        totalTags: parseNonNegativeInteger(summary?.total_tags),
        maxCount: parseNonNegativeInteger(summary?.max_count),
        bucketThresholds: computeBucketThresholds(
          database,
          parseNonNegativeInteger(summary?.total_tags),
        ),
      };
      return statsCache;
    } catch (err) {
      log.errorWithStack("Failed to read prompt tag stats", err as Error);
      statsCache = EMPTY_STATS;
      return statsCache;
    }
  }

  return {
    isAvailable,

    close(): void {
      db?.close();
      db = null;
      statsCache = null;
    },

    getSchemaVersion(): number | null {
      let tempDb: SqliteConnection | null = null;
      try {
        tempDb = openDatabase(getDbPath(), {
          readonly: true,
          fileMustExist: true,
        });
        tempDb.exec("PRAGMA query_only = ON");
        const row = tempDb
          .prepare(
            `SELECT value
             FROM prompts_meta
             WHERE key = 'schema_version'
             LIMIT 1`,
          )
          .get() as { value?: string | number } | undefined;
        const version = Number.parseInt(String(row?.value ?? ""), 10);
        return Number.isFinite(version) ? version : null;
      } catch (err) {
        log.errorWithStack("Failed to read prompts.db schema version", err as Error);
        return null;
      } finally {
        tempDb?.close();
      }
    },

    suggestTags(query: PromptTagSuggestQuery): PromptTagSuggestResult {
      const stats = getStats();
      if (!isAvailable()) return { suggestions: [], stats };

      const prefix = normalizePromptTerm(query?.prefix ?? "");
      if (!prefix) return { suggestions: [], stats };

      const limit = normalizeSuggestLimit(query?.limit);
      const excluded = normalizeExcludedTags(query?.exclude);
      const excludedClause =
        excluded.length > 0
          ? ` AND ${NORMALIZED_TAG_SQL} NOT IN (${excluded.map(() => "?").join(", ")})`
          : "";

      let rows: Array<{ tag: string; count: number }>;
      try {
        const database = getDb();
        rows = database
          .prepare(
            `SELECT tag, post_count AS count
             FROM prompt_tag
             WHERE ${NORMALIZED_TAG_SQL} LIKE ?
             ${excludedClause}
             ORDER BY
               CASE WHEN ${NORMALIZED_TAG_SQL} = ? THEN 0 ELSE 1 END,
               post_count DESC,
               tag ASC
             LIMIT ?`,
          )
          .all(`${prefix}%`, ...excluded, prefix, limit) as Array<{
          tag: string;
          count: number;
        }>;
      } catch (err) {
        log.errorWithStack("suggestTags query failed", err as Error);
        return { suggestions: [], stats };
      }

      return {
        suggestions: rows.map((row) => ({
          tag: row.tag,
          count: Math.max(0, Math.floor(row.count ?? 0)),
        })),
        stats,
      };
    },

    searchTags(query: PromptTagSearchQuery): PromptTagSearchResult {
      const empty: PromptTagSearchResult = {
        rows: [],
        totalCount: 0,
        page: 1,
        pageSize: DEFAULT_SEARCH_PAGE_SIZE,
        totalPages: 0,
      };
      if (!isAvailable()) return empty;

      const name = (query.name ?? "").trim();
      const sortBy = query.sortBy === "name" ? "name" : "count";
      const order = query.order === "asc" ? "ASC" : "DESC";
      const page = Math.max(1, Math.floor(Number(query.page) || 1));
      const pageSize = Math.max(
        1,
        Math.min(
          MAX_SEARCH_PAGE_SIZE,
          Math.floor(Number(query.pageSize) || DEFAULT_SEARCH_PAGE_SIZE),
        ),
      );

      const hasWildcard = name.includes("*");
      const hasName = name.length > 0;

      let whereClause = "";
      const whereParams: string[] = [];

      if (hasName) {
        if (hasWildcard) {
          const likePattern = wildcardToLike(
            name.toLowerCase().replace(/_/g, " "),
          );
          whereClause = `WHERE ${NORMALIZED_TAG_SQL} LIKE ? ESCAPE '\\'`;
          whereParams.push(likePattern);
        } else {
          const normalized = name.toLowerCase().replace(/_/g, " ");
          whereClause = `WHERE ${NORMALIZED_TAG_SQL} LIKE ? ESCAPE '\\'`;
          whereParams.push(`%${escapeSearchLike(normalized)}%`);
        }
      }

      const orderColumn = sortBy === "name" ? "tag" : "post_count";
      const orderClause = `ORDER BY ${orderColumn} ${order}${sortBy === "count" ? ", tag ASC" : ""}`;

      try {
        const database = getDb();

        const countRow = database
          .prepare(`SELECT COUNT(*) AS cnt FROM prompt_tag ${whereClause}`)
          .get(...whereParams) as { cnt: number };
        const totalCount = countRow?.cnt ?? 0;
        const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
        const clampedPage = Math.min(page, totalPages);
        const offset = (clampedPage - 1) * pageSize;

        const rows = database
          .prepare(
            `SELECT tag, post_count AS postCount
             FROM prompt_tag
             ${whereClause}
             ${orderClause}
             LIMIT ? OFFSET ?`,
          )
          .all(...whereParams, pageSize, offset) as PromptTagSearchRow[];

        return {
          rows,
          totalCount,
          page: clampedPage,
          pageSize,
          totalPages,
        };
      } catch (err) {
        log.errorWithStack("searchTags query failed", err as Error);
        return empty;
      }
    },
  };
}

export type PromptTagService = ReturnType<typeof createPromptTagService>;
