import type {
  PromptCategoryEntity,
  PromptGroupEntity,
  PromptTokenEntity,
} from "../types/repository";
import type { PromptRepo } from "../lib/repositories/prisma-prompt-repo";

const DEFAULT_CATEGORIES = [
  "인원",
  "등급/검열 수준",
  "작화/스타일",
  "구도",
  "장소",
  "기타 효과",
  "퀄리티 태그",
  "캐릭터 - 성별/인외",
  "캐릭터 - 특정 캐릭터",
  "캐릭터 - 나이",
  "캐릭터 - 머리/안구",
  "캐릭터 - 의상",
  "캐릭터 - 자세",
  "캐릭터 - 행위",
  "캐릭터 - 신체 부위",
  "캐릭터 - 얼굴",
  "캐릭터 - 기타 효과",
];

const DEFAULTS = DEFAULT_CATEGORIES.map((name, i) => ({ name, order: i }));

export type PromptBuilderServiceDeps = {
  promptRepo: PromptRepo;
};

export function createPromptBuilderService(deps: PromptBuilderServiceDeps) {
  const { promptRepo } = deps;

  return {
    async listCategories(): Promise<PromptCategoryEntity[]> {
      await promptRepo.seedDefaults(DEFAULTS);
      return promptRepo.listCategories();
    },

    async createCategory(name: string): Promise<PromptCategoryEntity> {
      return promptRepo.createCategory(name);
    },

    async renameCategory(id: number, name: string): Promise<void> {
      return promptRepo.renameCategory(id, name);
    },

    async deleteCategory(id: number): Promise<void> {
      return promptRepo.deleteCategory(id);
    },

    async resetCategories(): Promise<void> {
      return promptRepo.resetCategories(DEFAULTS);
    },

    async createGroup(
      categoryId: number,
      name: string,
    ): Promise<PromptGroupEntity> {
      return promptRepo.createGroup(categoryId, name);
    },

    async deleteGroup(id: number): Promise<void> {
      return promptRepo.deleteGroup(id);
    },

    async renameGroup(id: number, name: string): Promise<void> {
      return promptRepo.renameGroup(id, name);
    },

    async createToken(
      groupId: number,
      label: string,
    ): Promise<PromptTokenEntity> {
      return promptRepo.createToken(groupId, label);
    },

    async deleteToken(id: number): Promise<void> {
      return promptRepo.deleteToken(id);
    },

    async reorderGroups(
      _categoryId: number,
      ids: number[],
    ): Promise<void> {
      return promptRepo.reorderGroups(ids);
    },

    async reorderTokens(_groupId: number, ids: number[]): Promise<void> {
      return promptRepo.reorderTokens(ids);
    },
  };
}

export type PromptBuilderService = ReturnType<
  typeof createPromptBuilderService
>;
