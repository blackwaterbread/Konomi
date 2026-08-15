import fs from "fs/promises";
import path from "path";
import type { FastifyInstance } from "fastify";
import type { Services } from "../services";
import { listAvailableDirectories, isUnderDataRoot } from "../lib/data-root";

export function registerFolderRoutes(app: FastifyInstance, services: Services) {
  const { folderService, duplicateService, maintenanceService, sender } =
    services;

  // List detected directories under DATA_ROOT (Docker volume mounts)
  app.get("/api/folders/available", async () => {
    return listAvailableDirectories();
  });

  app.get("/api/folders", async () => {
    return folderService.list();
  });

  app.post<{ Body: { name: string; path: string } }>(
    "/api/folders",
    async (req, reply) => {
      const { name, path } = req.body;
      if (!isUnderDataRoot(path)) {
        return reply.code(403).send({ error: "Path is not under data root" });
      }
      const folder = await folderService.create(name, path);
      return folder;
    },
  );

  app.delete<{ Params: { id: string } }>("/api/folders/:id", async (req) => {
    const id = Number(req.params.id);
    // folderService.delete handles ImageSimilarityCache + ImageSearchStat
    // cleanup internally so no per-call-site bookkeeping is needed.
    await folderService.delete(id, (done, total) =>
      sender.send("image:searchStatsProgress", { done, total }),
    );
    return null;
  });

  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    "/api/folders/:id",
    async (req) => {
      const id = Number(req.params.id);
      return folderService.rename(id, req.body.name);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/folders/:id/subdirectories",
    async (req) => {
      return folderService.getSubfolderPaths(Number(req.params.id));
    },
  );

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

  app.post<{ Body: { path: string } }>(
    "/api/folders/duplicates",
    async (req, reply) => {
      // Same gate the other path-taking routes apply. Without it this endpoint
      // walks and reports file names from any directory on the server, which is
      // the one thing the DATA_ROOT confinement exists to prevent.
      if (!req.body?.path || !isUnderDataRoot(req.body.path)) {
        return reply.code(403).send({ error: "Path is not under data root" });
      }
      return duplicateService.findDuplicates(req.body.path);
    },
  );

  app.post<{ Body: { resolutions: any[] } }>(
    "/api/folders/duplicates/resolve",
    async (req) => {
      const resolved = await duplicateService.resolve(
        req.body.resolutions,
        (done, total) =>
          sender.send("image:searchStatsProgress", { done, total }),
      );
      if (resolved.removedImageIds.length > 0) {
        sender.send("image:removed", resolved.removedImageIds);
      }
      maintenanceService.scheduleAnalysis(0);
      return null;
    },
  );
}
