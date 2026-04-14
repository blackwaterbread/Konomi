import { useEffect } from "react";
import { matchesBinding, type Keybindings } from "@/lib/keybindings";
import type { ActivePanel } from "./useAppShellState";
import type { ImageData } from "@/components/image-card";
import type { GalleryFocusActions } from "./useGalleryFocus";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as HTMLElement;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || el.isContentEditable;
}

function focusSearchInput() {
  const input = document.querySelector<HTMLInputElement>("[data-search-input]");
  if (input) {
    input.focus();
    input.select();
  }
}

interface BrowseNavigation {
  goAll: () => void;
  goRecent: () => void;
  goFavorites: () => void;
  goRandomPick: () => void;
  refreshRandom: () => void;
}

interface UseKeyboardShortcutsOptions {
  bindings: Keybindings;
  handlePanelChange: (panel: ActivePanel) => void;
  activePanel: ActivePanel;
  onGenerate: () => void;
  browseNavigation: BrowseNavigation;
  detail: {
    isOpen: boolean;
    image: ImageData | null | undefined;
    onClose: () => void;
    onPrev: () => void;
    onNext: () => void;
  };
  imageActions: {
    onToggleFavorite: (id: string) => void;
    onCopyPrompt: (prompt: string) => void;
    onDelete: (id: string) => void;
  };
  galleryFocus: GalleryFocusActions & {
    imageCount: number;
    openFocusedImage: () => void;
  };
  imageGalleryPagination: {
    page: number;
    totalPages: number;
    onPageChange: (page: number) => void;
  };
  anyDialogOpen: boolean;
}

export function useKeyboardShortcuts({
  bindings,
  handlePanelChange,
  activePanel,
  onGenerate,
  browseNavigation,
  detail,
  imageActions,
  galleryFocus,
  imageGalleryPagination,
  anyDialogOpen,
}: UseKeyboardShortcutsOptions) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const editable = isEditableTarget(e.target);

      // 패널 전환 — 항상 동작
      if (matchesBinding(e, bindings["panel.generator"])) {
        e.preventDefault();
        handlePanelChange("generator");
        return;
      }
      if (matchesBinding(e, bindings["panel.gallery"])) {
        e.preventDefault();
        handlePanelChange("gallery");
        return;
      }
      if (matchesBinding(e, bindings["panel.tagSearch"])) {
        e.preventDefault();
        handlePanelChange("tagSearch");
        return;
      }
      if (matchesBinding(e, bindings["panel.settings"])) {
        e.preventDefault();
        handlePanelChange("settings");
        return;
      }

      // 탐색 전환 — 항상 동작
      if (matchesBinding(e, bindings["browse.all"])) {
        e.preventDefault();
        browseNavigation.goAll();
        return;
      }
      if (matchesBinding(e, bindings["browse.recent"])) {
        e.preventDefault();
        browseNavigation.goRecent();
        return;
      }
      if (matchesBinding(e, bindings["browse.favorites"])) {
        e.preventDefault();
        browseNavigation.goFavorites();
        return;
      }
      if (matchesBinding(e, bindings["browse.randomPick"])) {
        e.preventDefault();
        browseNavigation.goRandomPick();
        return;
      }
      // F5 — 생성 실행 (생성 패널에서 항상 동작)
      if (
        activePanel === "generator" &&
        matchesBinding(e, bindings["generator.generate"])
      ) {
        e.preventDefault();
        onGenerate();
        return;
      }

      // 이하는 editable 포커스 중이거나 다이얼로그 열림 시 무시
      if (editable || anyDialogOpen) return;

      // 랜덤 픽 새로고침
      if (matchesBinding(e, bindings["browse.randomRefresh"])) {
        e.preventDefault();
        browseNavigation.refreshRandom();
        return;
      }

      // 검색창 포커스
      if (
        !detail.isOpen &&
        matchesBinding(e, bindings["gallery.focusSearch"])
      ) {
        e.preventDefault();
        focusSearchInput();
        return;
      }

      // 디테일 열려 있을 때
      if (detail.isOpen && detail.image) {
        if (matchesBinding(e, bindings["detail.close"])) {
          detail.onClose();
          return;
        }
        if (matchesBinding(e, bindings["detail.prev"])) {
          e.preventDefault();
          detail.onPrev();
          return;
        }
        if (matchesBinding(e, bindings["detail.next"])) {
          e.preventDefault();
          detail.onNext();
          return;
        }
        if (matchesBinding(e, bindings["detail.favorite"])) {
          imageActions.onToggleFavorite(detail.image.id);
          return;
        }
        if (matchesBinding(e, bindings["detail.copyPrompt"])) {
          if (detail.image.prompt)
            imageActions.onCopyPrompt(detail.image.prompt);
          return;
        }
        if (matchesBinding(e, bindings["detail.delete"])) {
          imageActions.onDelete(detail.image.id);
          return;
        }
        return;
      }

      // 갤러리 포커스 내비게이션 (디테일 닫힌 상태)
      if (galleryFocus.imageCount > 0) {
        const key = e.key;
        if (key === "ArrowLeft") {
          e.preventDefault();
          galleryFocus.moveLeft();
          return;
        }
        if (key === "ArrowRight") {
          e.preventDefault();
          galleryFocus.moveRight();
          return;
        }
        if (key === "ArrowUp") {
          e.preventDefault();
          galleryFocus.moveUp();
          return;
        }
        if (key === "ArrowDown") {
          e.preventDefault();
          galleryFocus.moveDown();
          return;
        }
        if (key === "Home") {
          e.preventDefault();
          galleryFocus.moveHome();
          return;
        }
        if (key === "End") {
          e.preventDefault();
          galleryFocus.moveEnd();
          return;
        }
        if (key === "Enter") {
          e.preventDefault();
          galleryFocus.openFocusedImage();
          return;
        }
      }

      // 페이지 이동 (갤러리)
      if (matchesBinding(e, bindings["gallery.prevPage"])) {
        if (imageGalleryPagination.page > 1) {
          e.preventDefault();
          imageGalleryPagination.onPageChange(imageGalleryPagination.page - 1);
        }
        return;
      }
      if (matchesBinding(e, bindings["gallery.nextPage"])) {
        if (imageGalleryPagination.page < imageGalleryPagination.totalPages) {
          e.preventDefault();
          imageGalleryPagination.onPageChange(imageGalleryPagination.page + 1);
        }
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    bindings,
    anyDialogOpen,
    browseNavigation,
    detail,
    galleryFocus,
    handlePanelChange,
    activePanel,
    onGenerate,
    imageActions,
    imageGalleryPagination,
  ]);
}
