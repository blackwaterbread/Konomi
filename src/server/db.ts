import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
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

/**
 * Dev-only: if the database or expected tables are missing, create them
 * automatically. Skipped in production — operators run migrations explicitly.
 */
export async function ensureSchema(): Promise<void> {
  if (process.env.NODE_ENV === "production") return;

  const url = new URL(DATABASE_URL);
  const dbName = url.pathname.replace(/^\//, "");
  if (!dbName) {
    log.warn("DATABASE_URL has no database name, skipping ensureSchema");
    return;
  }

  // Connect without a database to create it if missing.
  const adminConn = await createConnection({
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  });
  let tablesExist = false;
  try {
    await adminConn.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    const rows = (await adminConn.query(
      "SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = ? AND table_name = 'Folder'",
      [dbName],
    )) as { c: bigint | number }[];
    tablesExist = Number(rows[0]?.c ?? 0) > 0;
  } finally {
    await adminConn.end();
  }

  if (tablesExist) return;

  log.info("Schema not found, running prisma db push");
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(__dirname, "../..");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "bunx",
      [
        "--bun",
        "prisma",
        "db",
        "push",
        "--accept-data-loss",
        "--config",
        "prisma.server.config.ts",
      ],
      {
        cwd: repoRoot,
        env: { ...process.env, DATABASE_URL },
        stdio: "inherit",
        shell: process.platform === "win32",
      },
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`prisma db push exited with code ${code}`));
    });
  });
  log.info("Schema created");
}
