import { afterEach, describe, expect, it } from "vitest";
import { normalizePathKey } from "@core/lib/path-key";

const realPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
}

afterEach(() => {
  setPlatform(realPlatform);
});

describe("normalizePathKey", () => {
  it("folds the three ways one file can spell itself differently", () => {
    setPlatform("win32");
    const key = normalizePathKey("D:/Images/Sub/a.png");

    // Backslashes, trailing separators and casing all reach the same file.
    expect(normalizePathKey("D:\\Images\\Sub\\a.png")).toBe(key);
    expect(normalizePathKey("d:/images/sub/a.png")).toBe(key);
    expect(normalizePathKey("D:\\Images\\SUB\\a.png\\")).toBe(key);
    expect(normalizePathKey("D:\\Images\\Sub\\a.png//")).toBe(key);
  });

  it("keeps case-only differences apart off win32", () => {
    setPlatform("linux");
    expect(normalizePathKey("/images/A.png")).not.toBe(
      normalizePathKey("/images/a.png"),
    );
    // Trailing-slash folding still applies.
    expect(normalizePathKey("/images/sub/")).toBe(normalizePathKey("/images/sub"));
  });

  it("keeps a backslash in a filename apart from a separator off win32", () => {
    setPlatform("linux");
    // `\` is an ordinary filename character here, so a file really named
    // `a\b.png` is not the file `b.png` inside a directory `a`. Folding them
    // together makes the walk upsert one onto the other's row, overwriting its
    // metadata and leaving the second file without a row at all.
    expect(normalizePathKey("/images/a\\b.png")).not.toBe(
      normalizePathKey("/images/a/b.png"),
    );
    expect(normalizePathKey("/images/a\\b.png")).toBe("/images/a\\b.png");
  });

  it("does not merge sibling paths that share a prefix", () => {
    setPlatform("win32");
    expect(normalizePathKey("D:/images/sub")).not.toBe(
      normalizePathKey("D:/images/sub2"),
    );
  });

  it("leaves a drive root usable as a prefix", () => {
    setPlatform("win32");
    // Stripping the trailing separator must not turn "D:\" into a key that
    // fails to prefix everything below it — scan roots are compared this way.
    const root = normalizePathKey("D:\\");
    expect(root).toBe("d:");
    expect(normalizePathKey("D:\\images\\a.png").startsWith(root + "/")).toBe(
      true,
    );
  });
});
