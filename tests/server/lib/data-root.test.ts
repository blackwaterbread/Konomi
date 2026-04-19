import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];
const originalDataRoot = process.env.KONOMI_DATA_ROOT;

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "konomi-data-root-test-"));
  tempDirs.push(dir);
  return dir;
}

async function loadDataRoot(dataRoot: string) {
  process.env.KONOMI_DATA_ROOT = dataRoot;
  vi.resetModules();
  return import("../../../src/server/lib/data-root");
}

beforeEach(() => {
  delete process.env.KONOMI_DATA_ROOT;
});

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (originalDataRoot === undefined) delete process.env.KONOMI_DATA_ROOT;
  else process.env.KONOMI_DATA_ROOT = originalDataRoot;
});

describe("isUnderDataRoot", () => {
  it("accepts DATA_ROOT itself", async () => {
    const root = createTempDir();
    const { isUnderDataRoot } = await loadDataRoot(root);
    expect(isUnderDataRoot(root)).toBe(true);
  });

  it("accepts paths nested inside DATA_ROOT", async () => {
    const root = createTempDir();
    const { isUnderDataRoot } = await loadDataRoot(root);
    expect(isUnderDataRoot(path.join(root, "photos", "a.png"))).toBe(true);
  });

  it("rejects sibling paths outside DATA_ROOT", async () => {
    const root = createTempDir();
    const sibling = createTempDir();
    const { isUnderDataRoot } = await loadDataRoot(root);
    expect(isUnderDataRoot(path.join(sibling, "a.png"))).toBe(false);
  });

  it("rejects path traversal via ..", async () => {
    const root = createTempDir();
    const { isUnderDataRoot } = await loadDataRoot(root);
    const traversal = path.join(root, "..", "escape.png");
    expect(isUnderDataRoot(traversal)).toBe(false);
  });
});

describe("listAvailableDirectories", () => {
  it("returns only 1-depth subdirectories, sorted", async () => {
    const root = createTempDir();
    fs.mkdirSync(path.join(root, "banana"));
    fs.mkdirSync(path.join(root, "apple"));
    fs.mkdirSync(path.join(root, "apple", "nested"));
    fs.writeFileSync(path.join(root, "note.txt"), "file");

    const { listAvailableDirectories } = await loadDataRoot(root);
    const result = await listAvailableDirectories();

    expect(result.map((d) => d.name)).toEqual(["apple", "banana"]);
    expect(result[0].path).toBe(path.join(root, "apple"));
  });

  it("skips hidden directories (starting with .)", async () => {
    const root = createTempDir();
    fs.mkdirSync(path.join(root, ".hidden"));
    fs.mkdirSync(path.join(root, "visible"));

    const { listAvailableDirectories } = await loadDataRoot(root);
    const result = await listAvailableDirectories();

    expect(result.map((d) => d.name)).toEqual(["visible"]);
  });

  it("returns empty array when DATA_ROOT does not exist", async () => {
    const missing = path.join(os.tmpdir(), `konomi-missing-${Date.now()}`);
    const { listAvailableDirectories } = await loadDataRoot(missing);
    await expect(listAvailableDirectories()).resolves.toEqual([]);
  });
});

describe("dataRootExists", () => {
  it("returns true when DATA_ROOT exists", async () => {
    const root = createTempDir();
    const { dataRootExists } = await loadDataRoot(root);
    await expect(dataRootExists()).resolves.toBe(true);
  });

  it("returns false when DATA_ROOT is missing", async () => {
    const missing = path.join(os.tmpdir(), `konomi-missing-${Date.now()}`);
    const { dataRootExists } = await loadDataRoot(missing);
    await expect(dataRootExists()).resolves.toBe(false);
  });
});
