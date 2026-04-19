import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { imageUrl } from "@/lib/image-utils";

const originalAppInfo = (window as any).appInfo;

function setElectron(isElectron: boolean): void {
  (window as any).appInfo = { isElectron };
}

beforeEach(() => {
  delete (window as any).appInfo;
});

afterEach(() => {
  if (originalAppInfo === undefined) delete (window as any).appInfo;
  else (window as any).appInfo = originalAppInfo;
});

describe("imageUrl in Electron mode", () => {
  beforeEach(() => setElectron(true));

  it("builds a konomi:// URL with forward-slash-normalized, encoded path", () => {
    const url = imageUrl("C:\\Users\\me\\photo.png");
    expect(url).toBe(`konomi://local/${encodeURIComponent("C:/Users/me/photo.png")}`);
  });

  it("appends ?w=<thumbWidth> when provided", () => {
    const url = imageUrl("/abs/path.png", 400);
    expect(url).toBe(`konomi://local/${encodeURIComponent("/abs/path.png")}?w=400`);
  });

  it("encodes non-ASCII characters (e.g. Korean, parentheses)", () => {
    const url = imageUrl("C:\\이미지\\a (1).png");
    expect(url).toContain("konomi://local/");
    expect(url).toContain(encodeURIComponent("이미지"));
    expect(url).toContain(encodeURIComponent("a (1).png"));
    expect(url).not.toContain("\\");
  });
});

describe("imageUrl in Web mode", () => {
  beforeEach(() => setElectron(false));

  it("builds a REST URL with path as a query param", () => {
    const url = imageUrl("/images/photos/a.png");
    expect(url).toBe(`/api/files/image?path=${encodeURIComponent("/images/photos/a.png")}`);
  });

  it("ignores thumbWidth argument (current behavior)", () => {
    const url = imageUrl("/images/photos/a.png", 400);
    expect(url).toBe(`/api/files/image?path=${encodeURIComponent("/images/photos/a.png")}`);
    expect(url).not.toContain("w=400");
  });

  it("falls back to Web mode when window.appInfo is missing", () => {
    delete (window as any).appInfo;
    const url = imageUrl("/images/a.png");
    expect(url.startsWith("/api/files/image?path=")).toBe(true);
  });
});
