import type { FastifyInstance } from "fastify";
import type { Services } from "../services";

export function registerCategoryRoutes(app: FastifyInstance, services: Services) {
  const { categoryService } = services;

  app.get("/api/categories", async () => {
    return categoryService.list();
  });

  app.post<{ Body: { name: string } }>("/api/categories", async (req) => {
    return categoryService.create(req.body.name);
  });

  app.delete<{ Params: { id: string } }>("/api/categories/:id", async (req) => {
    return categoryService.delete(Number(req.params.id));
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; color?: string | null } }>(
    "/api/categories/:id",
    async (req) => {
      const id = Number(req.params.id);
      if (req.body.name !== undefined) {
        await categoryService.rename(id, req.body.name);
      }
      if (req.body.color !== undefined) {
        await categoryService.updateColor(id, req.body.color);
      }
      return null;
    },
  );

  app.post<{ Body: { imageId: number; categoryId: number } }>(
    "/api/categories/add-image",
    async (req) => {
      return categoryService.addImage(req.body.imageId, req.body.categoryId);
    },
  );

  app.post<{ Body: { imageId: number; categoryId: number } }>(
    "/api/categories/remove-image",
    async (req) => {
      return categoryService.removeImage(req.body.imageId, req.body.categoryId);
    },
  );

  app.post<{ Body: { imageIds: number[]; categoryId: number } }>(
    "/api/categories/add-images",
    async (req) => {
      return categoryService.addImages(req.body.imageIds, req.body.categoryId);
    },
  );

  app.post<{ Body: { imageIds: number[]; categoryId: number } }>(
    "/api/categories/remove-images",
    async (req) => {
      return categoryService.removeImages(req.body.imageIds, req.body.categoryId);
    },
  );

  app.post<{ Body: { categoryId: number; query: string } }>(
    "/api/categories/add-by-prompt",
    async (req) => {
      return categoryService.addImagesByPrompt(req.body.categoryId, req.body.query);
    },
  );

  app.get<{ Params: { categoryId: string } }>(
    "/api/categories/:categoryId/image-ids",
    async (req) => {
      return categoryService.getImageIds(Number(req.params.categoryId));
    },
  );

  app.get<{ Params: { imageId: string } }>(
    "/api/images/:imageId/categories",
    async (req) => {
      return categoryService.getCategoriesForImage(Number(req.params.imageId));
    },
  );

  app.post<{ Body: { imageIds: number[] } }>(
    "/api/categories/common-for-images",
    async (req) => {
      return categoryService.getCommonCategoriesForImages(req.body.imageIds);
    },
  );
}
