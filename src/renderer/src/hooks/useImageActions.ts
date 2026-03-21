import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { GenerationViewHandle } from "@/components/generation-view";
import type { ImageData } from "@/components/image-card";
import { dispatchSearchInputAppendTag } from "@/lib/search-input-event";
import { createLogger } from "@/lib/logger";

const log = createLogger("renderer/useImageActions");

type SortBy = "recent" | "oldest" | "favorites" | "name";
type BuiltinCategory = "favorites" | "random" | null;
type ActivePanel = "gallery" | "generator" | "settings";

interface UseImageActionsOptions {
  images: ImageData[];
  setImages: Dispatch<SetStateAction<ImageData[]>>;
  sortBy: SortBy;
  selectedBuiltinCategory: BuiltinCategory;
  schedulePageRefresh: (delay?: number) => void;
  generationViewRef: MutableRefObject<GenerationViewHandle | null>;
  handlePanelChange: (panel: ActivePanel) => void | Promise<void>;
}

export function useImageActions({
  images,
  setImages,
  sortBy,
  selectedBuiltinCategory,
  schedulePageRefresh,
  generationViewRef,
  handlePanelChange,
}: UseImageActionsOptions) {
  const { t } = useTranslation();
  const [selectedImageSnapshot, setSelectedImage] = useState<ImageData | null>(
    null,
  );
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [categoryDialogImage, setCategoryDialogImage] =
    useState<ImageData | null>(null);
  const [bulkCategoryDialogImages, setBulkCategoryDialogImages] = useState<
    ImageData[] | null
  >(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [generatorTransitioning, setGeneratorTransitioning] = useState(false);

  const selectedImage = useMemo(() => {
    if (!selectedImageSnapshot) return null;
    return (
      images.find((image) => image.id === selectedImageSnapshot.id) ??
      selectedImageSnapshot
    );
  }, [images, selectedImageSnapshot]);

  const selectedImageId = selectedImage?.id ?? null;
  const selectedIndex = useMemo(
    () =>
      selectedImageId
        ? images.findIndex((image) => image.id === selectedImageId)
        : -1,
    [images, selectedImageId],
  );

  const prevImage = selectedIndex > 0 ? images[selectedIndex - 1] : null;
  const nextImage =
    selectedIndex < images.length - 1 ? images[selectedIndex + 1] : null;

  const handleSelectImage = useCallback((image: ImageData) => {
    setSelectedImage(image);
    setIsDetailOpen(true);
  }, []);

  const handleToggleFavorite = useCallback(
    (id: string) => {
      log.debug("Toggling favorite", { imageId: id });
      setImages((prev) => {
        const image = prev.find((entry) => entry.id === id);
        if (!image) return prev;
        const nextIsFavorite = !image.isFavorite;
        const shouldRefreshPage =
          sortBy === "favorites" || selectedBuiltinCategory === "favorites";

        window.image
          .setFavorite(parseInt(id, 10), nextIsFavorite)
          .then(() => {
            if (shouldRefreshPage) {
              schedulePageRefresh(0);
            }
          })
          .catch((error: unknown) => {
            toast.error(
              t("error.favoriteSetFailed", {
                message: error instanceof Error ? error.message : String(error),
              }),
            );
          });

        return prev.map((entry) =>
          entry.id === id ? { ...entry, isFavorite: nextIsFavorite } : entry,
        );
      });

      setSelectedImage((prev) =>
        prev?.id === id ? { ...prev, isFavorite: !prev.isFavorite } : prev,
      );
    },
    [schedulePageRefresh, selectedBuiltinCategory, setImages, sortBy, t],
  );

  const handleCopyPrompt = useCallback(
    (prompt: string) => {
      navigator.clipboard
        .writeText(prompt)
        .catch(() => toast.error(t("app.clipboardCopyFailed")));
    },
    [t],
  );

  const handleAddTagToSearch = useCallback((tag: string) => {
    const normalizedTag = tag.trim();
    if (!normalizedTag) return;
    dispatchSearchInputAppendTag({
      tag: normalizedTag,
      focusInput: false,
      suppressAutocomplete: true,
    });
  }, []);

  const handleAddTagToGenerator = useCallback(
    (tag: string) => {
      const normalizedTag = tag.trim();
      if (!normalizedTag) return;
      generationViewRef.current?.appendPromptTag(normalizedTag);
      void handlePanelChange("generator");
    },
    [generationViewRef, handlePanelChange],
  );

  const handleReveal = useCallback((path: string) => {
    window.image.revealInExplorer(path);
  }, []);

  const handleDeleteImage = useCallback((id: string) => {
    log.info("Deleting image requested", { imageId: id });
    setDeleteConfirmId(id);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (!deleteConfirmId) return;
    const image = images.find((entry) => entry.id === deleteConfirmId);
    if (image) {
      window.image.delete(image.path).catch((error: unknown) => {
        toast.error(
          t("error.imageDeleteFailed", {
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      });
      if (selectedImage?.id === deleteConfirmId) {
        setSelectedImage(null);
        setIsDetailOpen(false);
      }
      schedulePageRefresh(60);
    }
    setDeleteConfirmId(null);
  }, [deleteConfirmId, images, schedulePageRefresh, selectedImage?.id, t]);

  const handleSendToGenerator = useCallback(
    (image: ImageData) => {
      setGeneratorTransitioning(true);
      requestAnimationFrame(() => {
        generationViewRef.current?.importImage(image);
        void handlePanelChange("generator");
        requestAnimationFrame(() => {
          setGeneratorTransitioning(false);
        });
      });
    },
    [generationViewRef, handlePanelChange],
  );

  const handleSendToSource = useCallback(
    (image: ImageData) => {
      generationViewRef.current?.showSourceImage(image);
      void handlePanelChange("generator");
    },
    [generationViewRef, handlePanelChange],
  );

  const handleChangeCategory = useCallback((image: ImageData) => {
    setBulkCategoryDialogImages(null);
    setCategoryDialogImage(image);
  }, []);

  const handleBulkChangeCategory = useCallback((targets: ImageData[]) => {
    if (targets.length === 0) return;
    setCategoryDialogImage(null);
    setBulkCategoryDialogImages(targets);
  }, []);

  const handleCategoryDialogClose = useCallback(() => {
    setCategoryDialogImage(null);
    setBulkCategoryDialogImages(null);
    schedulePageRefresh(0);
  }, [schedulePageRefresh]);

  const handleDeleteDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setDeleteConfirmId(null);
    }
  }, []);

  const handlePrev = useCallback(() => {
    if (selectedIndex > 0) {
      setSelectedImage(images[selectedIndex - 1]);
    }
  }, [images, selectedIndex]);

  const handleNext = useCallback(() => {
    if (selectedIndex < images.length - 1) {
      setSelectedImage(images[selectedIndex + 1]);
    }
  }, [images, selectedIndex]);

  const imageActions = useMemo(
    () => ({
      onToggleFavorite: handleToggleFavorite,
      onCopyPrompt: handleCopyPrompt,
      onImageClick: handleSelectImage,
      onReveal: handleReveal,
      onDelete: handleDeleteImage,
      onChangeCategory: handleChangeCategory,
      onBulkChangeCategory: handleBulkChangeCategory,
      onSendToGenerator: handleSendToGenerator,
      onSendToSource: handleSendToSource,
      onAddTagToSearch: handleAddTagToSearch,
      onAddTagToGenerator: handleAddTagToGenerator,
    }),
    [
      handleAddTagToGenerator,
      handleAddTagToSearch,
      handleBulkChangeCategory,
      handleChangeCategory,
      handleCopyPrompt,
      handleDeleteImage,
      handleReveal,
      handleSelectImage,
      handleSendToGenerator,
      handleSendToSource,
      handleToggleFavorite,
    ],
  );

  return {
    imageActions,
    generatorTransitioning,
    categoryDialog: {
      image: categoryDialogImage,
      images: bulkCategoryDialogImages,
      onClose: handleCategoryDialogClose,
    },
    deleteDialog: {
      open: !!deleteConfirmId,
      onOpenChange: handleDeleteDialogOpenChange,
      onConfirm: handleConfirmDelete,
    },
    detail: {
      image: selectedImage,
      imageId: selectedImageId,
      isOpen: isDetailOpen,
      onClose: () => setIsDetailOpen(false),
      prevImage,
      nextImage,
      onPrev: handlePrev,
      onNext: handleNext,
      onSelectImage: handleSelectImage,
    },
  };
}
