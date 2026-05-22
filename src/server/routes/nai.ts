import type { FastifyInstance } from "fastify";
import type { Services } from "../services";
import type { NaiConfigPatch, GenerateParams } from "@core/services/nai-gen-service";
import { createLogger } from "@core/lib/logger";

const log = createLogger("web/routes/nai");

export function registerNaiRoutes(app: FastifyInstance, services: Services) {
  const { naiGenService, imageService, maintenanceService, sender } = services;

  app.post<{ Body: string }>("/api/nai/validate-api-key", async (req) => {
    return naiGenService.validateApiKey(req.body);
  });

  app.get("/api/nai/subscription", async () => {
    return naiGenService.getSubscriptionInfo();
  });

  app.get("/api/nai/config", async () => {
    return naiGenService.getConfig();
  });

  app.patch<{ Body: NaiConfigPatch }>("/api/nai/config", async (req) => {
    return naiGenService.updateConfig(req.body);
  });

  app.post<{ Body: GenerateParams }>("/api/nai/generate", async (req) => {
    const outPath = await naiGenService.generate(req.body, (dataUrl: string) => {
      sender.send("nai:generatePreview", dataUrl);
    });
    // Watcher-free direct registration: surface the generated image to all
    // connected clients via image:batch if its path falls inside a
    // registered folder root.
    try {
      const image = await imageService.registerExternalPath(outPath);
      if (image) {
        sender.send("image:batch", [{ ...image, isNew: true }]);
        maintenanceService.scheduleAnalysis();
      }
    } catch (err) {
      log.errorWithStack("registerExternalPath failed", err as Error);
    }
    return outPath;
  });
}
