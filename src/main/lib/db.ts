import path from "path";
import fs from "fs";
import crypto from "crypto";
import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../generated/prisma/client";

let client: PrismaClient | null = null;

function runMigrations(dbPath: string): void {
  const migrationsPath = process.env.KONOMI_MIGRATIONS_PATH;
  if (!migrationsPath) return;

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
            id TEXT PRIMARY KEY,
            checksum TEXT NOT NULL DEFAULT '',
            finished_at DATETIME,
            migration_name TEXT NOT NULL,
            logs TEXT,
            rolled_back_at DATETIME,
            started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            applied_steps_count INTEGER NOT NULL DEFAULT 0
        )`);

    let dirs: string[];
    try {
      dirs = fs
        .readdirSync(migrationsPath)
        .filter((d) => /^\d{14}/.test(d))
        .sort();
    } catch {
      return;
    }

    const applied = db
      .prepare('SELECT migration_name FROM "_prisma_migrations"')
      .all() as { migration_name: string }[];
    const appliedSet = new Set(applied.map((m) => m.migration_name));

    for (const dir of dirs) {
      if (appliedSet.has(dir)) continue;
      const sqlPath = path.join(migrationsPath, dir, "migration.sql");
      let sql: string;
      try {
        sql = fs.readFileSync(sqlPath, "utf-8");
      } catch {
        continue;
      }
      const checksum = crypto.createHash("sha256").update(sql).digest("hex");
      const applyMigration = db.transaction(
        (migrationName: string, migrationSql: string, migrationChecksum: string) => {
          db.exec(migrationSql);
          db.prepare(
            `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count)
             VALUES (?, ?, ?, datetime('now'), 1)`,
          ).run(crypto.randomUUID(), migrationChecksum, migrationName);
        },
      );
      applyMigration(dir, sql, checksum);
    }
  } finally {
    db.close();
  }
}

export function getDB(): PrismaClient {
  if (!client) {
    const isDev = process.env.NODE_ENV === "development";
    const dbPath = isDev
      ? path.join(process.cwd(), "dev.db")
      : path.join(process.env.KONOMI_USER_DATA!, "konomi.db");
    if (!isDev) runMigrations(dbPath);
    const adapter = new PrismaBetterSqlite3({ url: dbPath });
    client = new PrismaClient({ adapter });
  }
  return client;
}
