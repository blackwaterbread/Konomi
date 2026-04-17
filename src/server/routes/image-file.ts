import fs from "fs";
import path from "path";
import type { FastifyInstance } from "fastify";
import { readImageMeta, readImageMetaFromBuffer } from "@core/lib/image-meta";
import { isUnderDataRoot } from "../lib/data-root";

/**
 * Image file serving route — replaces the konomi:// protocol handler from Electron.
 * Serves image files from managed folder paths.
 */
export function registerImageFileRoutes(app: FastifyInstance) {
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_req, body, done) => {
      done(null, body);
    },
  );

  // Serve image file by absolute path (URL-encoded in query param)
  app.get<{ Querystring: { path: string } }>("/api/files/image", async (req, reply) => {
    const filePath = req.query.path;
    if (!filePath) {
      return reply.code(400).send({ error: "path query parameter required" });
    }
    if (!isUnderDataRoot(filePath)) {
      return reply.code(403).send({ error: "Path is not under data root" });
    }

    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
    } catch {
      return reply.code(404).send({ error: "File not found" });
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
    };

    const mime = mimeMap[ext] ?? "application/octet-stream";
    const stream = fs.createReadStream(filePath);
    return reply.type(mime).send(stream);
  });

  // Read image metadata
  app.get<{ Querystring: { path: string } }>("/api/files/image/meta", async (req, reply) => {
    const filePath = req.query.path;
    if (!filePath) {
      return reply.code(400).send({ error: "path query parameter required" });
    }
    if (!isUnderDataRoot(filePath)) {
      return reply.code(403).send({ error: "Path is not under data root" });
    }
    return readImageMeta(filePath);
  });

  // Read image metadata from raw bytes (drag-and-drop import)
  app.post("/api/files/image/meta/buffer", async (req, reply) => {
    const body = req.body;
    if (!Buffer.isBuffer(body)) {
      return reply
        .code(400)
        .send({ error: "request body must be application/octet-stream" });
    }
    return readImageMetaFromBuffer(body);
  });
}
