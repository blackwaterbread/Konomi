import type { CategoryRepository, CategoryEntity } from "../types/repository";

export type CategoryServiceDeps = {
  categoryRepo: CategoryRepository;
};

export function createCategoryService(deps: CategoryServiceDeps) {
  const { categoryRepo } = deps;

  return {
    async list(): Promise<CategoryEntity[]> {
      return categoryRepo.findAll();
    },

    async create(name: string): Promise<CategoryEntity> {
      return categoryRepo.create(name);
    },

    async delete(id: number): Promise<void> {
      return categoryRepo.delete(id);
    },

    async rename(id: number, name: string): Promise<CategoryEntity> {
      return categoryRepo.rename(id, name);
    },

    async updateColor(
      id: number,
      color: string | null,
    ): Promise<CategoryEntity> {
      return categoryRepo.updateColor(id, color);
    },

    async addImage(imageId: number, categoryId: number): Promise<void> {
      return categoryRepo.addImage(imageId, categoryId);
    },

    async removeImage(imageId: number, categoryId: number): Promise<void> {
      return categoryRepo.removeImage(imageId, categoryId);
    },

    async addImages(imageIds: number[], categoryId: number): Promise<void> {
      return categoryRepo.addImages(imageIds, categoryId);
    },

    async removeImages(imageIds: number[], categoryId: number): Promise<void> {
      return categoryRepo.removeImages(imageIds, categoryId);
    },

    async getImageIds(categoryId: number): Promise<number[]> {
      return categoryRepo.getImageIds(categoryId);
    },

    async getCategoriesForImage(imageId: number): Promise<number[]> {
      return categoryRepo.getCategoriesForImage(imageId);
    },

    async seedBuiltins(): Promise<void> {
      return categoryRepo.seedBuiltins();
    },
  };
}

export type CategoryService = ReturnType<typeof createCategoryService>;
