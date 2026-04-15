import type { FastifyInstance } from "fastify";
import type { Services } from "../services";

export function registerPromptRoutes(app: FastifyInstance, services: Services) {
  const { promptBuilderService, promptTagService } = services;

  // ── Categories ───────────────────────────
  app.get("/api/prompt/categories", async () => {
    return promptBuilderService.listCategories();
  });

  app.post<{ Body: { name: string } }>("/api/prompt/categories", async (req) => {
    return promptBuilderService.createCategory(req.body.name);
  });

  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    "/api/prompt/categories/:id",
    async (req) => {
      return promptBuilderService.renameCategory(Number(req.params.id), req.body.name);
    },
  );

  app.delete<{ Params: { id: string } }>("/api/prompt/categories/:id", async (req) => {
    return promptBuilderService.deleteCategory(Number(req.params.id));
  });

  app.post("/api/prompt/categories/reset", async () => {
    return promptBuilderService.resetCategories();
  });

  // ── Groups ───────────────────────────────
  app.post<{ Body: { categoryId: number; name: string } }>("/api/prompt/groups", async (req) => {
    return promptBuilderService.createGroup(req.body.categoryId, req.body.name);
  });

  app.delete<{ Params: { id: string } }>("/api/prompt/groups/:id", async (req) => {
    return promptBuilderService.deleteGroup(Number(req.params.id));
  });

  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    "/api/prompt/groups/:id",
    async (req) => {
      return promptBuilderService.renameGroup(Number(req.params.id), req.body.name);
    },
  );

  app.post<{ Body: { categoryId: number; ids: number[] } }>(
    "/api/prompt/groups/reorder",
    async (req) => {
      return promptBuilderService.reorderGroups(req.body.categoryId, req.body.ids);
    },
  );

  // ── Tokens ───────────────────────────────
  app.post<{ Body: { groupId: number; label: string } }>("/api/prompt/tokens", async (req) => {
    return promptBuilderService.createToken(req.body.groupId, req.body.label);
  });

  app.delete<{ Params: { id: string } }>("/api/prompt/tokens/:id", async (req) => {
    return promptBuilderService.deleteToken(Number(req.params.id));
  });

  app.post<{ Body: { groupId: number; ids: number[] } }>(
    "/api/prompt/tokens/reorder",
    async (req) => {
      return promptBuilderService.reorderTokens(req.body.groupId, req.body.ids);
    },
  );

  // ── Tag suggestions ──────────────────────
  app.post<{ Body: { prefix: string; limit?: number; exclude?: string[] } }>(
    "/api/prompt/suggest-tags",
    async (req) => {
      return promptTagService.suggestTags(req.body);
    },
  );

  app.post<{
    Body: { name?: string; sortBy?: "name" | "count"; order?: "asc" | "desc"; page?: number; pageSize?: number };
  }>("/api/prompt/search-tags", async (req) => {
    return promptTagService.searchTags(req.body ?? {});
  });
}
