import path from "path";
import fs from "fs";
import crypto from "crypto";
import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../../generated/prisma/client";
import { createLogger } from "@core/lib/logger";

const log = createLogger("main/db");

let client: PrismaClient | null = null;
let rawDb: Database.Database | null = null;
let migrationsDone = false;

// External DB provider override (used by konomi-server for MySQL)
let externalGetDB: (() => PrismaClient) | null = null;
let dialect: "sqlite" | "mysql" = "sqlite";

export function setDBProvider(
  provider: () => PrismaClient,
  dbDialect: "sqlite" | "mysql" = "sqlite",
): void {
  externalGetDB = provider;
  dialect = dbDialect;
}

export function getDialect(): "sqlite" | "mysql" {
  return dialect;
}

/** Returns dialect-appropriate INSERT-ignore syntax prefix */
export function insertIgnore(): string {
  return dialect === "mysql" ? "INSERT IGNORE INTO" : "INSERT OR IGNORE INTO";
}

export interface MigrationProgress {
  done: number;
  total: number;
  migrationName: string;
}

type ProgressCallback = (progress: MigrationProgress) => void;

function listMigrationDirs(migrationsPath: string): string[] | null {
  try {
    return fs
      .readdirSync(migrationsPath)
      .filter((d) => /^\d{14}/.test(d))
      .sort();
  } catch {
    return null;
  }
}

function readMigrationSql(
  migrationsPath: string,
  dir: string,
): { sql: string; checksum: string } | null {
  const sqlPath = path.join(migrationsPath, dir, "migration.sql");
  try {
    const sql = fs.readFileSync(sqlPath, "utf-8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");
    return { sql, checksum };
  } catch {
    return null;
  }
}

/**
 * Public, dialect-aware migration entry point. Async so the MariaDB path
 * can use the async `mariadb` client; the SQLite branch stays synchronous
 * because better-sqlite3 is sync and so are getDB/getRawDB. Callers should
 * always `await` this — for SQLite the await is a no-op, for MariaDB it
 * waits on the network round-trips.
 */
export async function runMigrations(
  onProgress?: ProgressCallback,
): Promise<void> {
  if (migrationsDone) return;
  if (dialect === "mysql") {
    await runMariadbMigrations(onProgress);
  } else {
    runSqliteMigrations(onProgress);
  }
}

function runSqliteMigrations(onProgress?: ProgressCallback): void {
  if (migrationsDone) return;
  const migrationsPath = process.env.KONOMI_MIGRATIONS_PATH;
  if (!migrationsPath) {
    migrationsDone = true;
    return;
  }

  const dbPath = path.join(process.env.KONOMI_USER_DATA!, "konomi.db");
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

    const dirs = listMigrationDirs(migrationsPath);
    if (!dirs) {
      migrationsDone = true;
      return;
    }

    const applied = db
      .prepare('SELECT migration_name FROM "_prisma_migrations"')
      .all() as { migration_name: string }[];
    const appliedSet = new Set(applied.map((m) => m.migration_name));

    const pending = dirs.filter((d) => !appliedSet.has(d));
    if (pending.length > 0) {
      log.info("Pending migrations", { count: pending.length });
    }
    let done = 0;

    for (const dir of pending) {
      const loaded = readMigrationSql(migrationsPath, dir);
      if (!loaded) {
        log.warn("Migration SQL file not found, skipping", {
          migration: dir,
        });
        done++;
        continue;
      }
      const { sql, checksum } = loaded;
      onProgress?.({ done, total: pending.length, migrationName: dir });
      log.info("Applying migration", { migration: dir });

      // VACUUM cannot run inside a transaction — execute such migrations
      // outside a transaction and record completion separately.
      const needsNoTxn = /^\s*VACUUM\s*;/im.test(sql);

      try {
        if (needsNoTxn) {
          db.exec(sql);
          db.prepare(
            `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count)
             VALUES (?, ?, ?, datetime('now'), 1)`,
          ).run(crypto.randomUUID(), checksum, dir);
        } else {
          const applyMigration = db.transaction(
            (
              migrationName: string,
              migrationSql: string,
              migrationChecksum: string,
            ) => {
              db.exec(migrationSql);
              db.prepare(
                `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count)
                 VALUES (?, ?, ?, datetime('now'), 1)`,
              ).run(crypto.randomUUID(), migrationChecksum, migrationName);
            },
          );
          applyMigration(dir, sql, checksum);
        }
        log.info("Migration applied", { migration: dir });
      } catch (error) {
        // 트랜잭션 실패 시 롤백됨 — _prisma_migrations에 기록되지 않으므로
        // 다음 실행 시 자동 재시도됨
        log.errorWithStack(
          "Migration failed, will retry on next launch",
          error,
          {
            migration: dir,
          },
        );
        throw error;
      }
      done++;
    }

    if (pending.length > 0) {
      onProgress?.({ done, total: pending.length, migrationName: "" });
    }
  } finally {
    db.close();
  }
  migrationsDone = true;
}

async function runMariadbMigrations(
  onProgress?: ProgressCallback,
): Promise<void> {
  const migrationsPath = process.env.KONOMI_MIGRATIONS_PATH;
  if (!migrationsPath) {
    migrationsDone = true;
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    log.warn("DATABASE_URL not set, skipping MariaDB migrations");
    migrationsDone = true;
    return;
  }

  const url = new URL(databaseUrl);
  const dbName = url.pathname.replace(/^\//, "");
  if (!dbName) {
    log.warn("DATABASE_URL has no database name, skipping migrations");
    migrationsDone = true;
    return;
  }

  // Lazy import — keeps mariadb out of the Electron bundle path.
  const { createConnection } = await import("mariadb");
  const conn = await createConnection({
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: dbName,
    multipleStatements: true,
  });

  try {
    await conn.query(
      `CREATE TABLE IF NOT EXISTS \`_prisma_migrations\` (
        id VARCHAR(36) NOT NULL PRIMARY KEY,
        checksum VARCHAR(64) NOT NULL DEFAULT '',
        finished_at DATETIME(3) NULL,
        migration_name VARCHAR(255) NOT NULL,
        logs TEXT NULL,
        rolled_back_at DATETIME(3) NULL,
        started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        applied_steps_count INT UNSIGNED NOT NULL DEFAULT 0
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );

    const dirs = listMigrationDirs(migrationsPath);
    if (!dirs) {
      migrationsDone = true;
      return;
    }

    const applied = (await conn.query(
      "SELECT migration_name FROM `_prisma_migrations`",
    )) as { migration_name: string }[];
    const appliedSet = new Set(applied.map((m) => m.migration_name));

    const pending = dirs.filter((d) => !appliedSet.has(d));
    if (pending.length > 0) {
      log.info("Pending migrations", { count: pending.length });
    }
    let done = 0;

    for (const dir of pending) {
      const loaded = readMigrationSql(migrationsPath, dir);
      if (!loaded) {
        log.warn("Migration SQL file not found, skipping", {
          migration: dir,
        });
        done++;
        continue;
      }
      const { sql, checksum } = loaded;
      onProgress?.({ done, total: pending.length, migrationName: dir });
      log.info("Applying migration", { migration: dir });

      try {
        // MariaDB DDL is auto-committed — wrapping in a transaction has no
        // effect. If a migration fails partway through, _prisma_migrations
        // is left untouched so the next boot retries the whole file. The
        // baseline uses CREATE TABLE IF NOT EXISTS, so retries are safe.
        await conn.query(sql);
        await conn.query(
          "INSERT INTO `_prisma_migrations` (id, checksum, migration_name, finished_at, applied_steps_count) VALUES (?, ?, ?, NOW(3), 1)",
          [crypto.randomUUID(), checksum, dir],
        );
        log.info("Migration applied", { migration: dir });
      } catch (error) {
        log.errorWithStack(
          "Migration failed, will retry on next launch",
          error,
          { migration: dir },
        );
        throw error;
      }
      done++;
    }

    if (pending.length > 0) {
      onProgress?.({ done, total: pending.length, migrationName: "" });
    }
  } finally {
    await conn.end();
  }
  migrationsDone = true;
}

/**
 * SQLite crash safety:
 * - better-sqlite3 defaults to DELETE journal mode → auto-rollback on next open
 * - All writes use transactions ($transaction / db.transaction) → atomic
 * - If DB is corrupted beyond journal recovery, delete konomi.db and re-scan
 *   (image files are untouched; only user metadata like favorites/categories is lost)
 */
export function getDB(): PrismaClient {
  if (externalGetDB) return externalGetDB();
  if (!client) {
    runSqliteMigrations();
    const dbPath = path.join(process.env.KONOMI_USER_DATA!, "konomi.db");
    const adapter = new PrismaBetterSqlite3({ url: dbPath });
    client = new PrismaClient({ adapter });
  }
  return client;
}

/**
 * Separate better-sqlite3 instance for cursor-based iteration (.iterate()).
 * Shares the same SQLite file as Prisma; busy_timeout ensures reads don't
 * fail while Prisma holds a write lock.
 *
 * NOT opened as readonly — on Windows, a readonly connection cannot recover
 * a hot journal left by a crash, causing SQLITE_CANTOPEN / deadlocks.
 */
export function getRawDB(): Database.Database {
  if (!rawDb) {
    runSqliteMigrations();
    const dbPath = path.join(process.env.KONOMI_USER_DATA!, "konomi.db");
    rawDb = new Database(dbPath);
    rawDb.pragma("busy_timeout = 5000");
  }
  return rawDb;
}

export async function disconnectDB(): Promise<void> {
  if (rawDb) {
    rawDb.close();
    rawDb = null;
  }
  if (!client) return;
  await client.$disconnect();
  client = null;
}
