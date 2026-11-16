import fs from "fs";
import os from "os";
import path from "path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerSpa } from "../../../src/server/lib/spa";

const INDEX_HTML = "<!doctype html><title>spa</title>";

let webDistDir: string;
let app: FastifyInstance;

beforeEach(async () => {
  webDistDir = fs.mkdtempSync(path.join(os.tmpdir(), "konomi-spa-"));
  fs.writeFileSync(path.join(webDistDir, "index.html"), INDEX_HTML);
  app = Fastify({ logger: false });
  await registerSpa(app, webDistDir);
});

afterEach(async () => {
  await app.close();
  fs.rmSync(webDistDir, { recursive: true, force: true });
});

describe("registerSpa", () => {
  it("answers unknown /api and /ws paths with a JSON 404 and the rest with index.html", async () => {
    const backend = [
      ["GET", "/api/does-not-exist"],
      ["POST", "/api/does-not-exist"],
      ["GET", "/api"],
      ["GET", "/api?x=1"],
      ["POST", "/ws"],
      ["GET", "/ws/x"],
    ] as const;
    for (const [method, url] of backend) {
      const res = await app.inject({ method, url });
      expect({ method, url, status: res.statusCode }).toEqual({
        method,
        url,
        status: 404,
      });
      expect(res.headers["content-type"]).toMatch(/^application\/json/);
      expect(res.json()).toEqual({ error: "Not found" });
    }

    for (const url of [
      "/",
      "/gallery/deep/route",
      "/apis",
      "/assets/missing.js",
    ]) {
      const res = await app.inject({ method: "GET", url });
      expect({ url, status: res.statusCode }).toEqual({ url, status: 200 });
      expect(res.headers["content-type"]).toMatch(/^text\/html/);
      expect(res.body).toBe(INDEX_HTML);
    }
  });
});
