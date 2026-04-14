import React, { type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImageGallery } from "@/components/image-gallery";
import { createGalleryImage } from "../helpers/gallery-image";

type ImageGalleryOverrides = Partial<
  Omit<
    ComponentProps<typeof ImageGallery>,
    "gallery" | "actions" | "pagination"
  >
> & {
  gallery?: Partial<ComponentProps<typeof ImageGallery>["gallery"]>;
  actions?: Partial<ComponentProps<typeof ImageGallery>["actions"]>;
  pagination?: Partial<ComponentProps<typeof ImageGallery>["pagination"]>;
};

function renderImageGallery(overrides: ImageGalleryOverrides = {}) {
  const baseProps: ComponentProps<typeof ImageGallery> = {
    gallery: {
      images: [],
      sortBy: "recent",
      totalCount: 0,
    },
    actions: {
      onSortChange: vi.fn(),
      onToggleFavorite: vi.fn(),
      onCopyPrompt: vi.fn(),
      onImageClick: vi.fn(),
      onReveal: vi.fn(),
      onDelete: vi.fn(),
      onChangeCategory: vi.fn(),
      onBulkChangeCategory: vi.fn(),
      onBulkDelete: vi.fn(),
    },
  };
  const props: ComponentProps<typeof ImageGallery> = {
    ...baseProps,
    ...overrides,
    gallery: {
      ...baseProps.gallery,
      ...overrides.gallery,
    },
    actions: {
      ...baseProps.actions,
      ...overrides.actions,
    },
    pagination: {
      ...baseProps.pagination,
      ...overrides.pagination,
    },
  };

  return {
    ...render(<ImageGallery {...props} />),
    props,
  };
}

describe("ImageGallery", () => {
  // ── Toolbar ─────────────────────────────────────────────────────────────

  it("shows a Reset button when searchQuery is set and calls onClearSearch when clicked", async () => {
    const user = userEvent.setup();
    const onClearSearch = vi.fn();

    renderImageGallery({
      gallery: { searchQuery: "sparkles", totalCount: 0 },
      actions: { onClearSearch },
    });

    const resetBtn = screen.getByRole("button", { name: "Reset" });
    expect(resetBtn).toBeInTheDocument();

    await user.click(resetBtn);

    expect(onClearSearch).toHaveBeenCalledTimes(1);
  });

  it("does not show the Reset button when searchQuery is empty", () => {
    renderImageGallery({ gallery: { searchQuery: "", totalCount: 5 } });
    expect(
      screen.queryByRole("button", { name: "Reset" }),
    ).not.toBeInTheDocument();
  });

  it("calls onSortChange when the sort dropdown is changed", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();

    // Radix Select needs hasPointerCapture on DOM elements (not in jsdom by default)
    Element.prototype.hasPointerCapture ??= () => false;

    renderImageGallery({
      gallery: { sortBy: "recent", totalCount: 0 },
      actions: { onSortChange },
    });

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Oldest" }));

    expect(onSortChange).toHaveBeenCalledWith("oldest");
  });

  // ── Selection mode ───────────────────────────────────────────────────────

  it("can exit selection mode via the Exit Selection button", async () => {
    const user = userEvent.setup();

    renderImageGallery({ gallery: { totalCount: 0 } });

    await user.click(screen.getByRole("button", { name: "Select" }));
    expect(
      screen.getByRole("button", { name: "Exit Selection" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Exit Selection" }));
    expect(
      screen.queryByRole("button", { name: "Exit Selection" }),
    ).not.toBeInTheDocument();
  });

  it("clears the selection when Clear Selection is clicked", async () => {
    const user = userEvent.setup();
    const pageImages = [createGalleryImage({ id: "img-1" })];

    renderImageGallery({ gallery: { images: pageImages, totalCount: 1 } });

    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(
      screen.getByRole("button", { name: "Select Current Page" }),
    );

    expect(screen.getByText("1 selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear Selection" }));

    await waitFor(() =>
      expect(screen.queryByText("1 selected")).not.toBeInTheDocument(),
    );
  });

  it("shows 'Deselect Current Page' toggle after selecting the current page", async () => {
    const user = userEvent.setup();
    const pageImages = [createGalleryImage({ id: "img-1" })];

    renderImageGallery({ gallery: { images: pageImages, totalCount: 1 } });

    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(
      screen.getByRole("button", { name: "Select Current Page" }),
    );

    expect(
      screen.getByRole("button", { name: "Deselect Current Page" }),
    ).toBeInTheDocument();
  });

  // ── Image card interactions ──────────────────────────────────────────────

  it("calls onImageClick when an image card is clicked", async () => {
    const user = userEvent.setup();
    const onImageClick = vi.fn();
    const image = createGalleryImage({
      id: "img-1",
      prompt: "sparkling night sky",
    });

    renderImageGallery({
      gallery: { images: [image], totalCount: 1 },
      actions: { onImageClick },
    });

    await user.click(screen.getByAltText("sparkling night sky"));

    expect(onImageClick).toHaveBeenCalledWith(image);
  });

  // ── Existing tests ───────────────────────────────────────────────────────

  it("shows the onboarding CTA when there are no folders yet", async () => {
    const user = userEvent.setup();
    const onAddFolder = vi.fn();

    renderImageGallery({
      gallery: {
        hasFolders: false,
      },
      actions: {
        onAddFolder,
      },
    });

    await user.click(screen.getByRole("button", { name: "Add Image Folder" }));

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
    const onBulkChangeCategory = vi.fn();
    const allIds = [1, 2, 3];
    const onLoadAllSelectableIds = vi.fn().mockResolvedValue(allIds);

    renderImageGallery({
      gallery: {
        images: pageImages,
        totalCount: 3,
      },
      actions: {
        onBulkChangeCategory,
        onLoadAllSelectableIds,
      },
    });

    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(
      screen.getByRole("button", { name: "Select Current Page" }),
    );
    await user.click(screen.getByRole("button", { name: "Change Category" }));

    const pageNumericIds = pageImages.map((img) => parseInt(img.id, 10));
    expect(onBulkChangeCategory).toHaveBeenLastCalledWith(pageNumericIds);

    await user.click(
      screen.getByRole("button", { name: "Select All Results (3)" }),
    );

    await waitFor(() =>
      expect(onLoadAllSelectableIds).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Deselect All Results" }),
      ).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Change Category" }));

    expect(onBulkChangeCategory).toHaveBeenLastCalledWith(allIds);
  });
});
