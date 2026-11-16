import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../../generated/prisma/client";

// No MariaDB here, so the MariaDB-dialect SQL runs against an in-memory SQLite
// table that compares keys the way the server's utf8mb4_unicode_ci primary key
// does — case and accents folded — with the two MySQL-only constructs the
// store emits rewritten to their SQLite equivalents.
function collationKey(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function createMariaDbStandIn() {
  const db = new Database(":memory:");
  db.function("ci", { deterministic: true }, collationKey);
  db.exec(`CREATE TABLE ImageSearchStat (
    kind TEXT NOT NULL, \`key\` TEXT NOT NULL, width INTEGER, height INTEGER,
    model TEXT, count INTEGER NOT NULL DEFAULT 0,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  db.exec("CREATE UNIQUE INDEX stat_pk ON ImageSearchStat (kind, ci(`key`))");
  db.exec(`CREATE TABLE Image (
    id INTEGER PRIMARY KEY, width INTEGER NOT NULL, height INTEGER NOT NULL,
    model TEXT NOT NULL, promptTokens TEXT NOT NULL,
    negativePromptTokens TEXT NOT NULL, characterPromptTokens TEXT NOT NULL)`);

  const toSqlite = (sql: string) =>
    sql
      .replace(/ON DUPLICATE KEY UPDATE/g, "ON CONFLICT DO UPDATE SET")
      .replace(/\bVALUES\((\w+)\)/g, "excluded.$1")
      .replace(/`key` = \?/g, "ci(`key`) = ci(?)");
  const client = {
    imageSearchStat: { findFirst: async () => null },
    image: {
      findMany: async ({ skip, take }: { skip: number; take: number }) =>
        db
          .prepare(
            "SELECT promptTokens, negativePromptTokens, characterPromptTokens FROM Image ORDER BY id LIMIT ? OFFSET ?",
          )
          .all(take, skip),
    },
    $queryRawUnsafe: async (sql: string, ...params: unknown[]) =>
      db.prepare(toSqlite(sql)).all(...params),
    $executeRawUnsafe: async (sql: string, ...params: unknown[]) =>
      db.prepare(toSqlite(sql)).run(...params).changes,
    $transaction: async (work: (tx: unknown) => Promise<unknown>) =>
      work(client),
  };
  return { db, client: client as unknown as PrismaClient };
}

let standIn: ReturnType<typeof createMariaDbStandIn>;

async function loadStore() {
  vi.resetModules();
  const { setDBProvider } = await import("@core/lib/db");
  setDBProvider(() => standIn.client, "mysql");
  return import("@core/lib/search-stats-store");
}

const tokens = (...texts: string[]) =>
  JSON.stringify(texts.map((text) => ({ text, weight: 1 })));

beforeEach(() => {
  standIn = createMariaDbStandIn();
});

afterEach(() => {
  standIn.db.close();
});

describe("search stats on the MariaDB dialect", () => {
  it("rebuilds tag keys the key collation treats as one into one row", async () => {
    const insert = standIn.db.prepare(
      "INSERT INTO Image (width, height, model, promptTokens, negativePromptTokens, characterPromptTokens) VALUES (832, 1216, 'nai', ?, '[]', '[]')",
    );
    insert.run(tokens("pokémon", "smile"));
    insert.run(tokens("pokemon"));
    const store = await loadStore();

    await store.rebuildImageSearchPresetStats();

    expect(
      standIn.db
        .prepare(
          "SELECT `key`, count FROM ImageSearchStat WHERE kind = 'tag' ORDER BY `key`",
        )
        .all(),
    ).toEqual([
      { key: "pokémon", count: 2 },
      { key: "smile", count: 1 },
    ]);
  });

  it("applies every decrement whose key the key collation folds onto one row", async () => {
    standIn.db.exec(
      "INSERT INTO ImageSearchStat (kind, `key`, model, count) VALUES ('model', 'NAI v4', 'NAI v4', 5)",
    );
    const store = await loadStore();
    const decrement = (key: string) => ({
      kind: "model" as const,
      key,
      width: null,
      height: null,
      model: key,
      delta: -1,
    });

    await store.applyImageSearchStatDeltas([
      decrement("NAI v4"),
      decrement("nai v4"),
    ]);

    expect(
      standIn.db.prepare("SELECT `key`, count FROM ImageSearchStat").all(),
    ).toEqual([{ key: "NAI v4", count: 3 }]);
  });
});
