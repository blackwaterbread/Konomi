import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { FastifyInstance } from "fastify";
import { readImageMeta, readImageMetaFromBuffer } from "@core/lib/image-meta";
import { encodeJpeg, resizePng } from "@core/lib/konomi-image";
import { resizeWebp } from "@core/lib/webp-alpha";
import { isUnderDataRoot } from "../lib/data-root";

const THUMB_JPEG_QUALITY = 92;

function getThumbCacheDir(): string {
  const userData = process.env.KONOMI_USER_DATA;
  if (!userData) throw new Error("KONOMI_USER_DATA is not set");
  const dir = path.join(userData, "thumb-cache");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

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

  const thumbCacheDir = getThumbCacheDir();

  // Serve image file by absolute path (URL-encoded in query param)
  // Optional ?w=<maxWidth> downscales PNG/WebP to a JPEG thumbnail.
  app.get<{ Querystring: { path: string; w?: string } }>("/api/files/image", async (req, reply) => {
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

    const maxWidth = parseInt(req.query.w ?? "", 10);
    if (maxWidth > 0 && (ext === ".png" || ext === ".webp")) {
      try {
        const stat = await fs.promises.stat(filePath);
        const hash = crypto
          .createHash("md5")
          .update(`${filePath}\0${maxWidth}\0${stat.mtimeMs}`)
          .digest("hex");
        const cachePath = path.join(thumbCacheDir, `${hash}.jpg`);

        try {
          const cacheStat = await fs.promises.stat(cachePath);
          if (cacheStat.size > 0) {
            return reply
              .type("image/jpeg")
              .send(fs.createReadStream(cachePath));
          }
        } catch {
          // Cache miss — generate thumbnail
        }

        const buf = await fs.promises.readFile(filePath);
        const result = ext === ".webp"
          ? resizeWebp(buf, maxWidth)
          : resizePng(buf, maxWidth);
        if (result) {
          const jpeg = encodeJpeg(
            result.data,
            result.width,
            result.height,
            THUMB_JPEG_QUALITY,
          );
          if (jpeg) {
            fs.promises.writeFile(cachePath, jpeg).catch(() => {});
            return reply.type("image/jpeg").send(jpeg);
          }
        }
      } catch {
        // Fall through to original file
      }
    }

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
