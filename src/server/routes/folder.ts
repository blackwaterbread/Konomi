import type { FastifyInstance } from "fastify";
import type { Services } from "../services";

export function registerFolderRoutes(app: FastifyInstance, services: Services) {
  const { folderService, watchService, duplicateService, imageService, sender } = services;

  app.get("/api/folders", async () => {
    return folderService.list();
  });

  app.post<{ Body: { name: string; path: string } }>("/api/folders", async (req) => {
    const { name, path } = req.body;
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
