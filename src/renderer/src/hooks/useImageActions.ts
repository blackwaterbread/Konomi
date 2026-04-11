import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function useImageActions({
  images,
  setImages,
  sortBy,
  selectedBuiltinCategory,
  schedulePageRefresh,
  generationViewRef,
  handlePanelChange,
  page,
  totalPages,
  onPageChange,
}: UseImageActionsOptions) {
  const { t } = useTranslation();
  const [selectedImageSnapshot, setSelectedImage] = useState<ImageData | null>(
    null,
  );
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [categoryDialogImage, setCategoryDialogImage] =
    useState<ImageData | null>(null);
  const [bulkCategoryDialogIds, setBulkCategoryDialogIds] = useState<
    number[] | null
  >(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [bulkDeleteIds, setBulkDeleteIds] = useState<number[] | null>(null);
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

  // Pending selection after cross-page navigation: "first" or "last"
  const pendingSelectRef = useRef<"first" | "last" | null>(null);

  useEffect(() => {
    if (pendingSelectRef.current && images.length > 0) {
      const target =
        pendingSelectRef.current === "first"
          ? images[0]
          : images[images.length - 1];
      pendingSelectRef.current = null;
      setSelectedImage(target);
    }
  }, [images]);

  const hasPrev = selectedIndex > 0 || page > 1;
  const hasNext = selectedIndex < images.length - 1 || page < totalPages;

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
      setImages((prev) =>
        selectedBuiltinCategory === "random"
          ? prev.map((entry) =>
              entry.id === deleteConfirmId
                ? { ...entry, deleted: true }
                : entry,
            )
          : prev.filter((entry) => entry.id !== deleteConfirmId),
      );
      schedulePageRefresh(1500);
    }
    setDeleteConfirmId(null);
  }, [deleteConfirmId, images, schedulePageRefresh, selectedBuiltinCategory, selectedImage?.id, setImages, t]);

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
    setBulkCategoryDialogIds(null);
    setCategoryDialogImage(image);
  }, []);

  const handleBulkChangeCategory = useCallback((ids: number[]) => {
    if (ids.length === 0) return;
    setCategoryDialogImage(null);
    setBulkCategoryDialogIds(ids);
  }, []);

  const handleRescanMetadata = useCallback(
    (path: string) => {
      window.image.rescanImageMetadata([path]).then(
        (count) => {
          if (count > 0) {
            schedulePageRefresh(0);
          }
        },
        (error: unknown) => {
          log.error("rescanMetadata failed", error);
        },
      );
    },
    [schedulePageRefresh],
  );

  const handleBulkRescanMetadata = useCallback(
    (ids: number[]) => {
      if (ids.length === 0) return;
      window.image.listByIds(ids).then(
        (rows) => {
          const paths = rows.map((r: { path: string }) => r.path);
          window.image.rescanImageMetadata(paths).then(
            (count) => {
              if (count > 0) {
                toast.success(
                  t("settings.metadataRescan.success", { count }),
                );
                schedulePageRefresh(0);
              } else {
                toast.info(t("settings.metadataRescan.noChanges"));
              }
            },
            (error: unknown) => {
              log.error("bulkRescanMetadata failed", error);
            },
          );
        },
        (error: unknown) => {
          log.error("bulkRescanMetadata listByIds failed", error);
        },
      );
    },
    [schedulePageRefresh, t],
  );

  const handleBulkDelete = useCallback((ids: number[]) => {
    if (ids.length === 0) return;
    setBulkDeleteIds(ids);
  }, []);

  const handleConfirmBulkDelete = useCallback(() => {
    if (!bulkDeleteIds || bulkDeleteIds.length === 0) return;
    const idSet = new Set(bulkDeleteIds.map(String));
    setBulkDeleteIds(null);

    const deleteIds = bulkDeleteIds;
    window.image.bulkDelete(deleteIds).then(
      ({ failed }) => {
        if (failed > 0) {
          toast.error(
            t("error.bulkDeletePartialFail", {
              failed,
              total: deleteIds.length,
            }),
          );
        }
      },
      (error: unknown) => {
        toast.error(
          t("error.bulkDeletePartialFail", {
            failed: deleteIds.length,
            total: deleteIds.length,
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      },
    );

    if (selectedImage && idSet.has(selectedImage.id)) {
      setSelectedImage(null);
      setIsDetailOpen(false);
    }
    setImages((prev) =>
      selectedBuiltinCategory === "random"
        ? prev.map((entry) =>
            idSet.has(entry.id) ? { ...entry, deleted: true } : entry,
          )
        : prev.filter((entry) => !idSet.has(entry.id)),
    );
    schedulePageRefresh(1500);
  }, [bulkDeleteIds, schedulePageRefresh, selectedBuiltinCategory, selectedImage, setImages, t]);

  const handleBulkDeleteDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setBulkDeleteIds(null);
    }
  }, []);

  const handleCategoryDialogClose = useCallback(() => {
    setCategoryDialogImage(null);
    setBulkCategoryDialogIds(null);
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
    } else if (page > 1) {
      pendingSelectRef.current = "last";
      onPageChange(page - 1);
    }
  }, [images, selectedIndex, page, onPageChange]);

  const handleNext = useCallback(() => {
    if (selectedIndex < images.length - 1) {
      setSelectedImage(images[selectedIndex + 1]);
    } else if (page < totalPages) {
      pendingSelectRef.current = "first";
      onPageChange(page + 1);
    }
  }, [images, selectedIndex, page, totalPages, onPageChange]);

  const imageActions = useMemo(
    () => ({
      onToggleFavorite: handleToggleFavorite,
      onCopyPrompt: handleCopyPrompt,
      onImageClick: handleSelectImage,
      onReveal: handleReveal,
      onDelete: handleDeleteImage,
      onChangeCategory: handleChangeCategory,
      onBulkChangeCategory: handleBulkChangeCategory,
      onBulkDelete: handleBulkDelete,
      onRescanMetadata: handleRescanMetadata,
      onBulkRescanMetadata: handleBulkRescanMetadata,
      onSendToGenerator: handleSendToGenerator,
      onSendToSource: handleSendToSource,
      onAddTagToSearch: handleAddTagToSearch,
      onAddTagToGenerator: handleAddTagToGenerator,
    }),
    [
      handleAddTagToGenerator,
      handleAddTagToSearch,
      handleBulkChangeCategory,
      handleBulkDelete,
      handleBulkRescanMetadata,
      handleChangeCategory,
      handleRescanMetadata,
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
      bulkImageIds: bulkCategoryDialogIds,
      onClose: handleCategoryDialogClose,
    },
    deleteDialog: {
      open: !!deleteConfirmId,
      onOpenChange: handleDeleteDialogOpenChange,
      onConfirm: handleConfirmDelete,
    },
    bulkDeleteDialog: {
      open: !!bulkDeleteIds,
      count: bulkDeleteIds?.length ?? 0,
      onOpenChange: handleBulkDeleteDialogOpenChange,
      onConfirm: handleConfirmBulkDelete,
    },
    detail: {
      image: selectedImage,
      imageId: selectedImageId,
      isOpen: isDetailOpen,
      onClose: () => setIsDetailOpen(false),
      prevImage,
      nextImage,
      hasPrev,
      hasNext,
      onPrev: handlePrev,
      onNext: handleNext,
      onSelectImage: handleSelectImage,
    },
  };
}
