import fs from "fs/promises";
import path from "path";
import type { FastifyInstance } from "fastify";
import type { Services } from "../services";
import { listAvailableDirectories, isUnderDataRoot } from "../lib/data-root";

export function registerFolderRoutes(app: FastifyInstance, services: Services) {
  const { folderService, watchService, duplicateService, imageService, sender } = services;

  // List detected directories under DATA_ROOT (Docker volume mounts)
  app.get("/api/folders/available", async () => {
    return listAvailableDirectories();
  });

  app.get("/api/folders", async () => {
    return folderService.list();
  });

  app.post<{ Body: { name: string; path: string } }>("/api/folders", async (req, reply) => {
    const { name, path } = req.body;
    if (!isUnderDataRoot(path)) {
      return reply.code(403).send({ error: "Path is not under data root" });
    }
    const folder = await folderService.create(name, path);
    watchService.watchFolder(folder.id, folder.path);
    return folder;
  });

  app.delete<{ Params: { id: string } }>("/api/folders/:id", async (req) => {
    const id = Number(req.params.id);
    watchService.stopFolder(id);
    const folderImageIds = await imageService.listIdsByFolderId(id);
    await folderService.delete(id);
    // TODO: deferred similarity cache + search stats cleanup (same as utility.ts)
    return null;
  });

  app.patch<{ Params: { id: string }; Body: { name: string } }>("/api/folders/:id", async (req) => {
    const id = Number(req.params.id);
    return folderService.rename(id, req.body.name);
  });

  app.get<{ Params: { id: string } }>("/api/folders/:id/subdirectories", async (req) => {
    return folderService.getSubfolderPaths(Number(req.params.id));
  });

  app.get<{ Querystring: { path: string } }>(
    "/api/folders/subdirectories",
    async (req, reply) => {
      const folderPath = req.query.path;
      if (!folderPath) {
        return reply.code(400).send({ error: "path query parameter required" });
      }
      if (!isUnderDataRoot(folderPath)) {
        return reply.code(403).send({ error: "Path is not under data root" });
      }
      try {
        const entries = await fs.readdir(folderPath, { withFileTypes: true });
        return entries
          .filter((e) => e.isDirectory())
          .map((e) => ({
            name: e.name,
            path: path.join(folderPath, e.name),
          }));
      } catch {
        return [];
      }
    },
  );

  app.get<{ Params: { id: string } }>("/api/folders/:id/stats", async (req) => {
    return folderService.getStats(Number(req.params.id));
  });

  app.get<{ Params: { id: string } }>("/api/folders/:id/size", async (req) => {
    return folderService.getSize(Number(req.params.id));
  });

  app.post<{ Body: { path: string } }>("/api/folders/duplicates", async (req) => {
    return duplicateService.findDuplicates(req.body.path);
  });

  app.post<{ Body: { resolutions: any[] } }>("/api/folders/duplicates/resolve", async (req) => {
    watchService.setScanActive(true);
    try {
      const resolved = await duplicateService.resolve(
        req.body.resolutions,
        (done, total) => sender.send("image:searchStatsProgress", { done, total }),
      );
      if (resolved.removedImageIds.length > 0) {
        sender.send("image:removed", resolved.removedImageIds);
      }
      watchService.applyResolvedDuplicates({
        touchedIncomingPaths: resolved.touchedIncomingPaths,
        retainedIncomingPaths: resolved.retainedIncomingPaths,
      });
      return null;
    } finally {
      watchService.setScanActive(false);
    }
  });
}
