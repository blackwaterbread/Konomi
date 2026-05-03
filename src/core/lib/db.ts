import path from "path";
import fs from "fs";
import crypto from "crypto";
import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../../generated/prisma/client";
import { createLogger } from "@core/lib/logger";

const log = createLogger("main/db");

let client: PrismaClient | null = null;
let readClient: PrismaClient | null = null;
let rawDb: Database.Database | null = null;
let migrationsDone = false;
let walModeEnsured = false;
/**
 * Resolves once both Prisma clients have $connect()-ed and applied their
 * per-connection PRAGMAs. Repos must not run queries before this resolves
 * — `getDB()` / `getReadDB()` are sync and return the client immediately,
 * so callers either chain off this promise (utility process awaits it at
 * the top of every IPC request) or accept that the very first query may
 * race the PRAGMAs. The race is benign for `synchronous`/`busy_timeout`
 * tunings but is a safety problem for `query_only = ON` on the reader.
 */
let dbReadyPromise: Promise<void> | null = null;

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

/**
 * Switches the SQLite database file to WAL journal mode. `journal_mode` is
 * persisted in the DB header, so a one-shot temporary connection is enough
 * — subsequent connections (Prisma adapter, `getRawDB()`) inherit it.
 *
 * `wal_autocheckpoint` is per-connection (not persisted), so it's applied
 * on the actual writer connections (`getDB()` / `getRawDB()`) instead of
 * here, where the temp connection would just discard it on close.
 *
 * Sqlite-only; no-op when an external (MariaDB) provider is wired in.
 */
function ensureWalMode(): void {
  if (walModeEnsured) return;
  if (dialect !== "sqlite") {
    walModeEnsured = true;
    return;
  }
  if (!process.env.KONOMI_USER_DATA) {
    // No data dir yet (test harness, partial bootstrap). Stay un-ensured so
    // a later call after the env var is wired up still tries.
    return;
  }
  walModeEnsured = true;
  const dbPath = path.join(process.env.KONOMI_USER_DATA, "konomi.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const tmp = new Database(dbPath);
  try {
    tmp.pragma("journal_mode = WAL");
  } catch (err) {
    log.warn("Failed to enable WAL mode", { error: String(err) });
  } finally {
    tmp.close();
  }
}

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
 * - WAL journal mode (enabled by ensureWalMode) → atomic commits via the
 *   `-wal`/`-shm` sidecar files; SQLite recovers automatically on next open
 *   if a crash leaves an uncheckpointed WAL behind.
 * - synchronous = NORMAL: durable across OS crashes; only the last in-flight
 *   transaction can be lost on power loss (acceptable for an image gallery).
 * - All writes use transactions ($transaction / db.transaction) → atomic.
 * - If the DB is corrupted beyond recovery, delete konomi.db together with
 *   konomi.db-wal/-shm and re-scan; image files are untouched and only user
 *   metadata (favorites/categories) is lost.
 */
/**
 * Initialize both Prisma clients (writer + reader) and apply per-connection
 * PRAGMAs sequentially, exposing the resulting promise so callers can await
 * full readiness before issuing queries. Without this gate, a user query
 * could race ahead of `query_only = ON` on the reader and silently grab the
 * writer lock, defeating the read/write split.
 *
 * Idempotent — first call seeds the clients and the promise, subsequent
 * calls just return the existing promise.
 */
function initSqliteClients(): Promise<void> {
  if (dbReadyPromise) return dbReadyPromise;
  ensureWalMode();
  runSqliteMigrations();
  const dbPath = path.join(process.env.KONOMI_USER_DATA!, "konomi.db");

  const writerAdapter = new PrismaBetterSqlite3({ url: dbPath });
  client = new PrismaClient({ adapter: writerAdapter });

  const readerAdapter = new PrismaBetterSqlite3({ url: dbPath });
  readClient = new PrismaClient({ adapter: readerAdapter });

  const writer = client;
  const reader = readClient;

  dbReadyPromise = (async () => {
    // $connect forces adapter.connect() (which opens the underlying
    // better-sqlite3 Database) before we issue any PRAGMA. Sequential
    // awaits ensure these are queued in order on the engine and visible
    // to subsequent user queries.
    await writer.$connect();
    await reader.$connect();
    // Writer pragmas — busy_timeout covers the rare case the reader holds
    // a snapshot lock during checkpoint; wal_autocheckpoint is per-conn,
    // so it must live here (not on the throwaway temp connection).
    await writer.$executeRawUnsafe("PRAGMA synchronous = NORMAL");
    await writer.$executeRawUnsafe("PRAGMA busy_timeout = 5000");
    await writer.$executeRawUnsafe("PRAGMA wal_autocheckpoint = 1000");
    // Reader pragmas — query_only is the safety net that turns a stray
    // write into an immediate error instead of a silent lock-grab.
    await reader.$executeRawUnsafe("PRAGMA synchronous = NORMAL");
    await reader.$executeRawUnsafe("PRAGMA busy_timeout = 5000");
    await reader.$executeRawUnsafe("PRAGMA query_only = ON");
  })().catch((err) => {
    log.warn("Failed to apply Prisma SQLite pragmas", { error: String(err) });
  });

  return dbReadyPromise;
}

/**
 * Awaitable readiness gate for the SQLite clients. Resolves once both
 * Prisma clients have applied their per-connection PRAGMAs, including
 * the reader's `query_only = ON` safety net. Callers that route queries
 * through `getDB()` / `getReadDB()` should await this on first use of
 * the client to avoid racing the PRAGMAs (utility.ts awaits at the top
 * of every IPC request).
 *
 * No-op when an external (MariaDB) provider is wired in — InnoDB doesn't
 * need the SQLite-specific pragmas and the same client serves reads.
 */
export function dbReady(): Promise<void> {
  if (externalGetDB) return Promise.resolve();
  return initSqliteClients();
}

export function getDB(): PrismaClient {
  if (externalGetDB) return externalGetDB();
  if (!client) initSqliteClients();
  return client!;
}

/**
 * Reader-only PrismaClient backed by a separate better-sqlite3 connection.
 * WAL mode lets this connection observe a transactional snapshot in parallel
 * with writes on `getDB()`'s connection — the whole point of Phase 2 is to
 * stop scan-write transactions from blocking gallery reads.
 *
 * For external (MariaDB) providers we hand back the same client — InnoDB
 * MVCC already gives us concurrent readers, so a separate connection would
 * just burn a pool slot for no gain.
 */
export function getReadDB(): PrismaClient {
  if (externalGetDB) return externalGetDB();
  if (!readClient) initSqliteClients();
  return readClient!;
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
    ensureWalMode();
    runSqliteMigrations();
    const dbPath = path.join(process.env.KONOMI_USER_DATA!, "konomi.db");
    rawDb = new Database(dbPath);
    rawDb.pragma("synchronous = NORMAL");
    rawDb.pragma("busy_timeout = 5000");
    // wal_autocheckpoint is per-connection; rawDb is the only connection
    // we open synchronously, so this is the place to bound the WAL size
    // for any process that hits the raw path before initSqliteClients.
    rawDb.pragma("wal_autocheckpoint = 1000");
  }
  return rawDb;
}

export async function disconnectDB(): Promise<void> {
  // Wait for any in-flight PRAGMA application to finish so $disconnect
  // doesn't race the engine. Swallowed errors are already logged inside
  // initSqliteClients.
  if (dbReadyPromise) {
    try {
      await dbReadyPromise;
    } catch {
      /* already logged */
    }
  }
  // Disconnect Prisma first so its outstanding WAL writes are committed
  // before the truncating checkpoint runs.
  if (client) {
    try {
      await client.$disconnect();
    } catch (err) {
      log.warn("Prisma $disconnect failed", { error: String(err) });
    }
    client = null;
  }
  if (readClient) {
    try {
      await readClient.$disconnect();
    } catch (err) {
      log.warn("Prisma reader $disconnect failed", { error: String(err) });
    }
    readClient = null;
  }
  dbReadyPromise = null;
  if (rawDb) {
    if (dialect === "sqlite") {
      // Best-effort: shrink the -wal sidecar to 0 bytes and merge pending
      // commits into the main file. Skipped silently if a reader is still
      // attached or the checkpoint can't acquire the writer lock.
      try {
        rawDb.pragma("wal_checkpoint(TRUNCATE)");
      } catch (err) {
        log.warn("WAL checkpoint failed on shutdown", {
          error: String(err),
        });
      }
    }
    try {
      rawDb.close();
    } catch (err) {
      log.warn("Raw DB close failed", { error: String(err) });
    }
    rawDb = null;
  }
}
