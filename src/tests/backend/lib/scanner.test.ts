import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  countImageFiles,
  scanImageFiles,
  withConcurrency,
} from "@core/lib/scanner";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "konomi-scanner-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("scanner", () => {
  it("finds PNG files recursively and ignores non-PNG files", async () => {
    const root = createTempDir();
    const nested = path.join(root, "nested", "deeper");
    fs.mkdirSync(nested, { recursive: true });

    const files = {
      pngA: path.join(root, "a.png"),
      pngB: path.join(nested, "b.PNG"),
      txt: path.join(root, "note.txt"),
      jpg: path.join(nested, "preview.jpg"),
    };

    fs.writeFileSync(files.pngA, "a");
    fs.writeFileSync(files.pngB, "b");
    fs.writeFileSync(files.txt, "note");
    fs.writeFileSync(files.jpg, "jpg");

    const result = await scanImageFiles(root);

    expect(result.sort()).toEqual([files.pngA, files.pngB].sort());
  });

  it("counts PNG files recursively", async () => {
    const root = createTempDir();
    fs.mkdirSync(path.join(root, "nested"), { recursive: true });
    fs.writeFileSync(path.join(root, "a.png"), "a");
    fs.writeFileSync(path.join(root, "nested", "b.png"), "b");
    fs.writeFileSync(path.join(root, "nested", "c.webp"), "c");

    await expect(countImageFiles(root)).resolves.toBe(3);
  });

  it("limits concurrent work in withConcurrency", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const processed: number[] = [];

    await withConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      processed.push(item);
      inFlight--;
    });

    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(processed.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
});
