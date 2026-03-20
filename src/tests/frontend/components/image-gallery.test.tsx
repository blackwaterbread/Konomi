import React, { type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImageGallery } from "@/components/image-gallery";
import { createGalleryImage } from "../helpers/gallery-image";

function renderImageGallery(
  overrides: Partial<ComponentProps<typeof ImageGallery>> = {},
) {
  const props: ComponentProps<typeof ImageGallery> = {
    images: [],
    viewMode: "grid",
    onViewModeChange: vi.fn(),
    sortBy: "recent",
    onSortChange: vi.fn(),
    onToggleFavorite: vi.fn(),
    onCopyPrompt: vi.fn(),
    onImageClick: vi.fn(),
    onReveal: vi.fn(),
    onDelete: vi.fn(),
    onChangeCategory: vi.fn(),
    onBulkChangeCategory: vi.fn(),
    totalCount: 0,
    ...overrides,
  };

  return {
    ...render(<ImageGallery {...props} />),
    props,
  };
}

describe("ImageGallery", () => {
  it("shows the onboarding CTA when there are no folders yet", async () => {
    const user = userEvent.setup();
    const onAddFolder = vi.fn();

    renderImageGallery({
      hasFolders: false,
      onAddFolder,
    });

    await user.click(
      screen.getByRole("button", { name: "Add Image Folder" }),
    );

    expect(onAddFolder).toHaveBeenCalledTimes(1);
  });

  it("supports current-page selection and full-result bulk category actions", async () => {
    const user = userEvent.setup();
    const pageImages = [
      createGalleryImage({
        id: "image-1",
        path: "C:\\gallery\\image-1.png",
        prompt: "first prompt",
      }),
      createGalleryImage({
        id: "image-2",
        path: "C:\\gallery\\image-2.png",
        src: "konomi://local/C%3A%2Fgallery%2Fimage-2.png",
        prompt: "second prompt",
      }),
    ];
    const allImages = [
      ...pageImages,
      createGalleryImage({
        id: "image-3",
        path: "C:\\gallery\\image-3.png",
        src: "konomi://local/C%3A%2Fgallery%2Fimage-3.png",
        prompt: "third prompt",
      }),
    ];
    const onBulkChangeCategory = vi.fn();
    const onLoadAllSelectableImages = vi.fn().mockResolvedValue(allImages);

    renderImageGallery({
      images: pageImages,
      totalCount: 3,
      onBulkChangeCategory,
      onLoadAllSelectableImages,
    });

    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(
      screen.getByRole("button", { name: "Select Current Page" }),
    );
    await user.click(screen.getByRole("button", { name: "Change Category" }));

    expect(onBulkChangeCategory).toHaveBeenLastCalledWith(pageImages);

    await user.click(
      screen.getByRole("button", { name: "Select All Results (3)" }),
    );

    await waitFor(() =>
      expect(onLoadAllSelectableImages).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Deselect All Results" }),
      ).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Change Category" }));

    expect(onBulkChangeCategory).toHaveBeenLastCalledWith(allImages);
  });
});
