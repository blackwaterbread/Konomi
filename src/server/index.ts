import path from "path";
import { fileURLToPath } from "url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import { createWebSocketSender } from "./sender";
import { createServices, bootstrap, runInitialScan } from "./services";
import { registerFolderRoutes } from "./routes/folder";
import { registerImageRoutes } from "./routes/image";
import { registerCategoryRoutes } from "./routes/category";
import { registerPromptRoutes } from "./routes/prompt";
import { registerNaiRoutes } from "./routes/nai";
import { registerImageFileRoutes } from "./routes/image-file";
import { createLogger } from "@core/lib/logger";
import { setDBProvider } from "@core/lib/db";
import { getDB, ensureSchema } from "./db";

// Dev defaults — Electron app sets these via bridge env vars
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
process.env.KONOMI_USER_DATA ??= path.join(repoRoot, "database");
process.env.KONOMI_MIGRATIONS_PATH ??= path.join(repoRoot, "prisma", "migrations", "sqlite");
process.env.KONOMI_PREBUILDS_PATH ??= path.join(repoRoot, "prebuilds");

// Inject MySQL PrismaClient into core modules
setDBProvider(getDB as any, "mysql");

const log = createLogger("web/server");
const PORT = Number(process.env.KONOMI_PORT) || 3000;
const HOST = process.env.KONOMI_HOST || "0.0.0.0";

async function main() {
  const app = Fastify({ logger: false });

  // ── WebSocket ────────────────────────────
  await app.register(websocket);

  const clients = new Set<WebSocket>();

  app.get("/ws", { websocket: true }, (socket) => {
    clients.add(socket);
    socket.on("close", () => clients.delete(socket));
  });

  // ── Services ─────────────────────────────
  const sender = createWebSocketSender(() => clients);
  const services = createServices(sender);

  // ── Error logging ────────────────────────
  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    log.errorWithStack(`${_request.method} ${_request.url} failed`, error);
    reply.status(error.statusCode ?? 500).send({ error: error.message });
  });

  // ── Routes ───────────────────────────────
  registerFolderRoutes(app, services);
  registerImageRoutes(app, services);
  registerCategoryRoutes(app, services);
  registerPromptRoutes(app, services);
  registerNaiRoutes(app, services);
  registerImageFileRoutes(app);

  // ── SPA static files ─────────────────────
  const webDistDir = path.join(repoRoot, "src", "web", "dist");
  await app.register(fastifyStatic, {
    root: webDistDir,
    wildcard: false,
  });
  // SPA fallback: non-API routes → index.html
  app.setNotFoundHandler((_req, reply) => {
    reply.sendFile("index.html", webDistDir);
  });

  // ── Bootstrap ────────────────────────────
  await ensureSchema();
  await bootstrap(services);

  // ── Start ────────────────────────────────
  await app.listen({ port: PORT, host: HOST });
  log.info(`Konomi Web server listening on ${HOST}:${PORT}`);

  // Initial scan runs asynchronously so it doesn't delay server readiness.
  void runInitialScan(services);

  // ── Graceful shutdown ────────────────────
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`Received ${signal}, shutting down`);
    try {
      services.watchService.stopAll();
      for (const socket of clients) socket.close();
      clients.clear();
      await app.close();
    } catch (err) {
      log.errorWithStack("Shutdown error", err as Error);
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGHUP", () => void shutdown("SIGHUP"));
}

main().catch((err) => {
  log.errorWithStack("Failed to start server", err);
  process.exit(1);
});
