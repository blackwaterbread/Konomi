import { createConnection } from "mariadb";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../../generated/prisma-server/client";
import { createLogger } from "@core/lib/logger";

const log = createLogger("web/db");

const DATABASE_URL =
  process.env.DATABASE_URL ?? "mysql://root:mariadb@127.0.0.1:3306/konomi";

let client: PrismaClient | null = null;

export function getDB(): PrismaClient {
  if (!client) {
    const adapter = new PrismaMariaDb(DATABASE_URL);
    client = new PrismaClient({ adapter });
  }
  return client;
}

export async function disconnectDB(): Promise<void> {
  if (!client) return;
  await client.$disconnect();
  client = null;
}

// MariaDB allows broader identifiers when quoted, but we restrict to the
// standard set so backtick interpolation in `CREATE DATABASE` can't be
// abused by a malformed DATABASE_URL.
const DB_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Connect to the server without a database selected and CREATE DATABASE
 * IF NOT EXISTS. Schema/table creation is handled by the migration runner
 * (`runMigrations` from @core/lib/db) once the database exists.
 */
export async function ensureDatabase(): Promise<void> {
  const url = new URL(DATABASE_URL);
  const dbName = url.pathname.replace(/^\//, "");
  if (!dbName) {
    log.warn("DATABASE_URL has no database name, skipping ensureDatabase");
    return;
  }
  if (!DB_NAME_PATTERN.test(dbName)) {
    throw new Error(
      `Invalid database name in DATABASE_URL: ${JSON.stringify(dbName)} (allowed: A-Z, a-z, 0-9, _, -)`,
    );
  }

  const adminConn = await createConnection({
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  });
  try {
    await adminConn.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await adminConn.end();
  }
}
