import path from "path";
import { fileURLToPath } from "url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import { createWebSocketSender } from "./sender";
import { createServices, bootstrap, runInitialScan } from "./services";
import { createDataRootWatcher } from "./lib/data-root-watcher";
import { registerFolderRoutes } from "./routes/folder";
import { registerImageRoutes } from "./routes/image";
import { registerCategoryRoutes } from "./routes/category";
import { registerPromptRoutes } from "./routes/prompt";
import { registerNaiRoutes } from "./routes/nai";
import { registerImageFileRoutes } from "./routes/image-file";
import { createLogger } from "@core/lib/logger";
import { setDBProvider, runMigrations } from "@core/lib/db";
import { naiPool } from "@core/lib/image-infra";
import { pHashPool } from "@core/lib/phash";
import { getDB, ensureDatabase, disconnectDB } from "./db";

// Dev defaults — Electron app sets these via bridge env vars
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
process.env.KONOMI_USER_DATA ??= path.join(repoRoot, "database");
process.env.KONOMI_MIGRATIONS_PATH ??= path.join(
  repoRoot,
  "prisma",
  "migrations",
  "mariadb",
);
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
  app.setErrorHandler(
    (error: Error & { statusCode?: number }, _request, reply) => {
      log.errorWithStack(`${_request.method} ${_request.url} failed`, error);
      reply.status(error.statusCode ?? 500).send({ error: error.message });
    },
  );

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
  await ensureDatabase();
  await runMigrations((progress) => {
    log.info("Migration progress", progress);
  });
  await bootstrap(services);

  // Watch DATA_ROOT for new docker volume mounts after the initial bootstrap
  // reconciliation. Polling (60s) backs up fs.watch on NFS/SMB mounts.
  const dataRootWatcher = createDataRootWatcher(services);
  dataRootWatcher.start();

  // ── Start ────────────────────────────────
  await app.listen({ port: PORT, host: HOST });
  log.info(`Konomi Web server listening on ${HOST}:${PORT}`);

  // ── Graceful shutdown ────────────────────
  // Sequence:
  //   1. Mark shuttingDown + cancel maintenance + flip in-flight scan token
  //      (so their batch loops break out).
  //   2. Stop watcher so no new file events arrive mid-shutdown.
  //   3. Close WebSocket + Fastify so no new requests start.
  //   4. Await the initial-scan promise (and any other in-flight scan that
  //      shares scanState.cancelToken) so worker pools / DB aren't torn down
  //      while a scan is still issuing reads/writes.
  //   5. Wait for maintenance to finish draining its current batch.
  //   6. Terminate worker pools (otherwise event loop holds them open).
  //   7. Disconnect DB.
  // tini (Dockerfile) forwards SIGTERM to PID 1, so `docker stop` reaches us.
  // Set `stop_grace_period` in docker-compose to allow the drain to finish.
  //
  // Handlers are registered BEFORE runInitialScan so a signal arriving during
  // the synchronous launch window (or during the scan's first await) is
  // caught — runInitialScan's `scanState.shuttingDown` guard then short-
  // circuits before allocating a fresh cancel token.
  let initialScanPromise: Promise<void> = Promise.resolve();
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`Received ${signal}, shutting down`);
    try {
      dataRootWatcher.stop();
      services.scanState.shuttingDown = true;
      services.maintenanceService.requestShutdown();
      if (services.scanState.cancelToken) {
        services.scanState.cancelToken.cancelled = true;
      }
      services.watchService.stopAll();
      for (const socket of clients) socket.close();
      clients.clear();
      await app.close();
      // Wait for initial scan + any data-root-watcher background scan to
      // acknowledge cancellation. Without this, pHashPool.shutdown() below
      // would resolve in-flight worker tasks to null mid-scan.
      await initialScanPromise.catch(() => {
        /* logged inside runInitialScan */
      });
      await dataRootWatcher.awaitInFlight();
      await services.maintenanceService.flush();
      await Promise.allSettled([naiPool.shutdown(), pHashPool.shutdown()]);
      await disconnectDB();
    } catch (err) {
      log.errorWithStack("Shutdown error", err as Error);
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGHUP", () => void shutdown("SIGHUP"));

  // Initial scan runs asynchronously so it doesn't delay server readiness.
  // Assigned after handlers register so shutdown's await targets the real
  // promise.
  initialScanPromise = runInitialScan(services);
}

main().catch((err) => {
  log.errorWithStack("Failed to start server", err);
  process.exit(1);
});
