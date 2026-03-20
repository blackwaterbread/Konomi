import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];
const requestMock = vi.fn();

vi.mock("../../../main/bridge", () => ({
  bridge: {
    request: requestMock,
  },
}));

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "konomi-path-guard-test-"));
  tempDirs.push(dir);
  return dir;
}

async function loadPathGuard() {
  vi.resetModules();
  return import("../../../main/lib/path-guard");
}

beforeEach(() => {
  requestMock.mockReset();
});

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("path-guard", () => {
  it("recognizes supported image types and content types", async () => {
    const { getImageContentType, isSupportedImagePath } = await loadPathGuard();

    expect(isSupportedImagePath("image.png")).toBe(true);
    expect(isSupportedImagePath("image.JPG")).toBe(true);
    expect(isSupportedImagePath("note.txt")).toBe(false);
    expect(getImageContentType("image.avif")).toBe("image/avif");
    expect(getImageContentType("unknown.bin")).toBe(
      "application/octet-stream",
    );
  });

  it("allows files inside managed folder roots", async () => {
    const root = createTempDir();
    const nested = path.join(root, "nested");
    const imagePath = path.join(nested, "image.png");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(imagePath, "png");
    requestMock.mockResolvedValue([{ id: 1, name: "root", path: root }]);

    const { isManagedImagePath } = await loadPathGuard();

    await expect(isManagedImagePath(imagePath)).resolves.toBe(true);
  });

  it("allows transiently registered image paths outside managed roots", async () => {
    const outside = createTempDir();
    const imagePath = path.join(outside, "generated.png");
    fs.writeFileSync(imagePath, "png");
    requestMock.mockResolvedValue([]);

    const { isManagedImagePath, registerTransientPath } = await loadPathGuard();

    await registerTransientPath(imagePath);
    await expect(isManagedImagePath(imagePath)).resolves.toBe(true);
  });
});
