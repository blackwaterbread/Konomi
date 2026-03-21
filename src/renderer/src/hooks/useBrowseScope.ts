import { useCallback, useMemo, useState } from "react";
import { useCategories } from "@/hooks/useCategories";
import { createLogger } from "@/lib/logger";

const log = createLogger("renderer/useBrowseScope");

type BrowseView = "all" | "recent";

export function useBrowseScope() {
  const [activeView, setActiveView] = useState<BrowseView>("all");
  const [randomSeed, setRandomSeed] = useState(() =>
    Math.floor(Math.random() * 0x7fffffff),
  );
  const {
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
  } = useCategories();

  const handleViewChange = useCallback(
    (view: string) => {
      setActiveView(view as BrowseView);
      selectCategory(null);
    },
    [selectCategory],
  );

  const handleRandomRefresh = useCallback(() => {
    log.info("Random pick refreshed");
    setRandomSeed((seed) => seed + 1);
  }, []);

  const queryFragment = useMemo(
    () => ({
      onlyRecent: activeView === "recent",
      customCategoryId:
        selectedCategory && !selectedCategory.isBuiltin
          ? selectedCategory.id
          : null,
      builtinCategory: selectedBuiltinCategory,
      randomSeed,
    }),
    [activeView, randomSeed, selectedBuiltinCategory, selectedCategory],
  );

  const sidebarView = useMemo(
    () => ({
      activeView,
      onViewChange: handleViewChange,
    }),
    [activeView, handleViewChange],
  );

  const sidebarCategoryState = useMemo(
    () => ({
      categories,
      selectedCategoryId,
    }),
    [categories, selectedCategoryId],
  );

  const categoryCommands = useMemo(
    () => ({
      selectCategory,
      createCategory,
      renameCategory,
      deleteCategory,
      reorderCategories,
      addCategoryByPrompt,
      refreshRandomSelection: handleRandomRefresh,
    }),
    [
      addCategoryByPrompt,
      createCategory,
      deleteCategory,
      handleRandomRefresh,
      renameCategory,
      reorderCategories,
      selectCategory,
    ],
  );

  return {
    categories,
    queryFragment,
    sidebarView,
    sidebarCategoryState,
    categoryCommands,
  };
}
