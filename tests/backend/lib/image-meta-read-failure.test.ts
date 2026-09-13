import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readImageMeta, readImageMetaForScan } from "@core/lib/image-meta";

afterEach(() => vi.restoreAllMocks());

describe("metadata read failures", () => {
  it.each(["png", "webp"])(
    "distinguishes %s I/O failures from missing metadata",
    (ext) => {
      const error = Object.assign(new Error("temporarily unreadable"), {
        code: "EACCES",
      });
      vi.spyOn(
        fs,
        ext === "png" ? "openSync" : "readFileSync",
      ).mockImplementation(() => {
        throw error;
      });
      expect(readImageMetaForScan(`locked.${ext}`)).toBeUndefined();
      // Existing UI callers retain their nullable API.
      expect(readImageMeta(`locked.${ext}`)).toBeNull();
    },
  );

  it("returns null when a readable image contains no metadata", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "konomi-meta-"));
    const filePath = path.join(directory, "readable.webp");
    try {
      fs.writeFileSync(
        filePath,
        Buffer.from(
          "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",
          "base64",
        ),
      );
      expect(readImageMetaForScan(filePath)).toBeNull();
    } finally {
      fs.unlinkSync(filePath);
      fs.rmdirSync(directory);
    }
  });
});
