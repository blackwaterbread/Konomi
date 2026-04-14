import type { FastifyInstance } from "fastify";
import type { Services } from "../services";
import type { NaiConfigPatch, GenerateParams } from "@core/services/nai-gen-service";

export function registerNaiRoutes(app: FastifyInstance, services: Services) {
  const { naiGenService, sender } = services;

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
    return naiGenService.generate(req.body, (dataUrl: string) => {
      sender.send("nai:generatePreview", dataUrl);
    });
  });
}
