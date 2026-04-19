import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../../generated/prisma/client";

async function loadDb() {
  vi.resetModules();
  return import("../../../src/core/lib/db");
}

beforeEach(() => {
  vi.resetModules();
});

describe("db dialect", () => {
  it("defaults to sqlite when no provider is set", async () => {
    const db = await loadDb();
    expect(db.getDialect()).toBe("sqlite");
    expect(db.insertIgnore()).toBe("INSERT OR IGNORE INTO");
  });

  it("switches to mysql syntax after setDBProvider(..., 'mysql')", async () => {
    const db = await loadDb();
    const fake = {} as PrismaClient;
    db.setDBProvider(() => fake, "mysql");
    expect(db.getDialect()).toBe("mysql");
    expect(db.insertIgnore()).toBe("INSERT IGNORE INTO");
  });

  it("getDB() returns the injected client when a provider is set", async () => {
    const db = await loadDb();
    const fake = { $tag: "fake" } as unknown as PrismaClient;
    db.setDBProvider(() => fake, "mysql");
    expect(db.getDB()).toBe(fake);
  });

  it("treats omitted dialect arg as sqlite", async () => {
    const db = await loadDb();
    const fake = {} as PrismaClient;
    db.setDBProvider(() => fake);
    expect(db.getDialect()).toBe("sqlite");
    expect(db.insertIgnore()).toBe("INSERT OR IGNORE INTO");
  });

  it("isolates module state between resetModules calls", async () => {
    const first = await loadDb();
    first.setDBProvider(() => ({}) as PrismaClient, "mysql");
    expect(first.getDialect()).toBe("mysql");

    const second = await loadDb();
    expect(second.getDialect()).toBe("sqlite");
  });
});
