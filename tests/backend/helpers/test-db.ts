import fs from "fs";
import os from "os";
import path from "path";
import { vi } from "vitest";

export type IsolatedDbTestContext = {
  userDataDir: string;
  cleanup: () => Promise<void>;
};

export async function setupIsolatedDbTest(): Promise<IsolatedDbTestContext> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "konomi-db-test-"));

  process.env.KONOMI_USER_DATA = userDataDir;
  process.env.KONOMI_MIGRATIONS_PATH = path.resolve(
    process.cwd(),
    "prisma/migrations/sqlite",
  );
  vi.resetModules();

  return {
    userDataDir,
    cleanup: async () => {
      try {
        const { disconnectDB } = await import("@core/lib/db");
        await disconnectDB();
      } finally {
        vi.resetModules();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    },
  };
}
