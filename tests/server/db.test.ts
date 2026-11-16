import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Every connection either side opens is recorded here instead of reaching a
// server: `ensureDatabase` (src/server/db.ts) and core's `runMigrations` both
// go through `mariadb.createConnection`.
const connections = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("mariadb", () => ({
  createConnection: vi.fn(async (options: Record<string, unknown>) => {
    connections.push(options);
    return {
      query: vi.fn(async () => []),
      end: vi.fn(async () => {}),
    };
  }),
}));

const savedEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  KONOMI_MIGRATIONS_PATH: process.env.KONOMI_MIGRATIONS_PATH,
};
let migrationsDir: string;

beforeEach(() => {
  vi.resetModules();
  connections.length = 0;
  delete process.env.DATABASE_URL;
  migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), "konomi-migrations-"));
  process.env.KONOMI_MIGRATIONS_PATH = migrationsDir;
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(migrationsDir, { recursive: true, force: true });
});

describe("server DB without DATABASE_URL", () => {
  it("runs the migrations against the database ensureDatabase prepared", async () => {
    // The default URL points at 127.0.0.1:3306; never let it reach a real server.
    const mariadb = await import("mariadb");
    if (!vi.isMockFunction(mariadb.createConnection)) {
      throw new Error("mariadb is not mocked; refusing to connect");
    }
    const serverDb = await import("../../src/server/db");
    const coreDb = await import("@core/lib/db");
    coreDb.setDBProvider(serverDb.getDB as never, "mysql");

    await serverDb.ensureDatabase();
    await coreDb.runMigrations();

    expect(connections).toHaveLength(2);
    const [admin, migrations] = connections;
    expect(migrations).toMatchObject({
      host: admin.host,
      port: admin.port,
      user: admin.user,
      password: admin.password,
      database: "konomi",
    });
  });
});
