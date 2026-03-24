import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Category } from "@preload/index.d";
import i18n from "@/lib/i18n";
import { createLogger } from "@/lib/logger";

const log = createLogger("renderer/useCategories");
const CATEGORY_ORDER_STORAGE_KEY = "konomi-category-order";

function readCategoryOrder(): number[] {
  try {
    const raw = localStorage.getItem(CATEGORY_ORDER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is number => Number.isInteger(id));
  } catch {
    return [];
  }
}

function writeCategoryOrder(ids: number[]): void {
  try {
    localStorage.setItem(CATEGORY_ORDER_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // ignore storage errors
  }
}

function applyCategoryOrder(
  inputCategories: Category[],
  preferredOrder?: number[],
): Category[] {
  const builtin = inputCategories
    .filter((cat) => cat.isBuiltin)
    .sort((a, b) => a.order - b.order);
  const custom = inputCategories.filter((cat) => !cat.isBuiltin);
  const order = preferredOrder ?? readCategoryOrder();
  const customMap = new Map(custom.map((cat) => [cat.id, cat]));
  const orderedCustom: Category[] = [];

  for (const id of order) {
    const cat = customMap.get(id);
    if (!cat) continue;
    orderedCustom.push(cat);
    customMap.delete(id);
  }

  const remainingCustom = custom.filter((cat) => customMap.has(cat.id));
  const normalizedCustom = [...orderedCustom, ...remainingCustom];
  writeCategoryOrder(normalizedCustom.map((cat) => cat.id));

  return [...builtin, ...normalizedCustom];
}

function getBuiltinCategoryKind(
  category: Category | undefined,
): "favorites" | "random" | null {
  if (!category?.isBuiltin) return null;
  return category.order === 1 ? "random" : "favorites";
}

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(
    null,
  );

  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === selectedCategoryId),
    [categories, selectedCategoryId],
  );
  const selectedBuiltinCategory = useMemo(
    () => getBuiltinCategoryKind(selectedCategory),
    [selectedCategory],
  );

  useEffect(() => {
    window.category
      .list()
      .then((loaded) => setCategories(applyCategoryOrder(loaded)))
      .catch((error: unknown) =>
        toast.error(
          i18n.t("error.categoryLoadFailed", {
            message: error instanceof Error ? error.message : String(error),
          }),
        ),
      );
  }, []);

  const selectCategory = useCallback((id: number | null) => {
    log.debug("Category selected", { categoryId: id });
    setSelectedCategoryId(id);
  }, []);

  const createCategory = useCallback(async (name: string): Promise<boolean> => {
    log.info("Creating category", { name });
    try {
      const category = await window.category.create(name);
      setCategories((prev) => applyCategoryOrder([...prev, category]));
      return true;
    } catch (error: unknown) {
      toast.error(
        i18n.t("error.categoryCreateFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      return false;
    }
  }, []);

  const renameCategory = useCallback(
    async (id: number, name: string): Promise<boolean> => {
      log.info("Renaming category", { categoryId: id, name });
      try {
        const updated = await window.category.rename(id, name);
        setCategories((prev) =>
          prev.map((category) => (category.id === id ? updated : category)),
        );
        return true;
      } catch (error: unknown) {
        toast.error(
          i18n.t("error.categoryRenameFailed", {
            message: error instanceof Error ? error.message : String(error),
          }),
        );
        return false;
      }
    },
    [],
  );

  const reorderCategories = useCallback((ids: number[]) => {
    log.info("Reordering categories", { ids });
    setCategories((prev) => applyCategoryOrder(prev, ids));
  }, []);

  const deleteCategory = useCallback(async (id: number): Promise<boolean> => {
    log.info("Deleting category", { categoryId: id });
    try {
      await window.category.delete(id);
      setCategories((prev) =>
        applyCategoryOrder(prev.filter((category) => category.id !== id)),
      );
      setSelectedCategoryId((prev) => (prev === id ? null : prev));
      return true;
    } catch (error: unknown) {
      toast.error(
        i18n.t("error.categoryDeleteFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      return false;
    }
  }, []);

  const addCategoryByPrompt = useCallback(
    async (id: number, query: string): Promise<boolean> => {
      log.info("Adding category images by prompt", { categoryId: id, query });
      try {
        await window.category.addByPrompt(id, query);
        return selectedCategoryId === id;
      } catch (error: unknown) {
        toast.error(
          i18n.t("error.categoryAddImagesFailed", {
            message: error instanceof Error ? error.message : String(error),
          }),
        );
        return false;
      }
    },
    [selectedCategoryId],
  );

  return {
    categories,
    selectedCategoryId,
    selectedCategory,
    selectedBuiltinCategory,
    selectCategory,
    createCategory,
    renameCategory,
    reorderCategories,
    deleteCategory,
    addCategoryByPrompt,
  };
}
