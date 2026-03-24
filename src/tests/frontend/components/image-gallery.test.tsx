import React, { type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
      viewMode: "grid",
      sortBy: "recent",
      totalCount: 0,
    },
    actions: {
      onViewModeChange: vi.fn(),
      onSortChange: vi.fn(),
      onToggleFavorite: vi.fn(),
      onCopyPrompt: vi.fn(),
      onImageClick: vi.fn(),
      onReveal: vi.fn(),
      onDelete: vi.fn(),
      onChangeCategory: vi.fn(),
      onBulkChangeCategory: vi.fn(),
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

  it("calls onViewModeChange with 'compact' when the compact view button is clicked", async () => {
    const user = userEvent.setup();
    const onViewModeChange = vi.fn();

    const { container } = renderImageGallery({
      gallery: { viewMode: "grid", totalCount: 0 },
      actions: { onViewModeChange },
    });

    // View mode buttons are icon-only (no accessible name); pick by position in their container
    const viewGroup = container.querySelector(".bg-secondary.rounded-lg");
    const [, compactBtn] = within(viewGroup as HTMLElement).getAllByRole(
      "button",
    );
    await user.click(compactBtn);

    expect(onViewModeChange).toHaveBeenCalledWith("compact");
  });

  it("calls onViewModeChange with 'list' when the list view button is clicked", async () => {
    const user = userEvent.setup();
    const onViewModeChange = vi.fn();

    const { container } = renderImageGallery({
      gallery: { viewMode: "grid", totalCount: 0 },
      actions: { onViewModeChange },
    });

    const viewGroup = container.querySelector(".bg-secondary.rounded-lg");
    const [, , listBtn] = within(viewGroup as HTMLElement).getAllByRole(
      "button",
    );
    await user.click(listBtn);

    expect(onViewModeChange).toHaveBeenCalledWith("list");
  });

  it("calls onViewModeChange with 'grid' when the grid view button is clicked", async () => {
    const user = userEvent.setup();
    const onViewModeChange = vi.fn();

    const { container } = renderImageGallery({
      gallery: { viewMode: "list", totalCount: 0 },
      actions: { onViewModeChange },
    });

    const viewGroup = container.querySelector(".bg-secondary.rounded-lg");
    const [gridBtn] = within(viewGroup as HTMLElement).getAllByRole("button");
    await user.click(gridBtn);

    expect(onViewModeChange).toHaveBeenCalledWith("grid");
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

  // ── Empty and loading states ─────────────────────────────────────────────

  it("shows an empty-state message when there are folders but no images", () => {
    renderImageGallery({
      gallery: { images: [], totalCount: 0, hasFolders: true },
    });

    expect(screen.getByText("No images found")).toBeInTheDocument();
  });

  it("shows the initializing overlay when isInitializing is true", () => {
    renderImageGallery({
      gallery: { images: [], totalCount: 0, isInitializing: true },
    });

    expect(screen.getByText("Preparing Library")).toBeInTheDocument();
  });

  // ── Pagination ───────────────────────────────────────────────────────────

  it("calls onPageChange with the next page when the Next page button is clicked", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();

    renderImageGallery({
      gallery: { totalCount: 0 },
      pagination: { page: 1, totalPages: 3, onPageChange },
    });

    await user.click(screen.getByRole("button", { name: "Next page" }));

    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("calls onPageChange with the previous page when the Previous page button is clicked", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();

    renderImageGallery({
      gallery: { totalCount: 0 },
      pagination: { page: 3, totalPages: 5, onPageChange },
    });

    await user.click(screen.getByRole("button", { name: "Previous page" }));

    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("calls onPageChange with 1 when the First page button is clicked", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();

    renderImageGallery({
      gallery: { totalCount: 0 },
      pagination: { page: 4, totalPages: 5, onPageChange },
    });

    await user.click(screen.getByRole("button", { name: "First page" }));

    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("calls onPageChange with the last page when the Last page button is clicked", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();

    renderImageGallery({
      gallery: { totalCount: 0 },
      pagination: { page: 1, totalPages: 7, onPageChange },
    });

    await user.click(screen.getByRole("button", { name: "Last page" }));

    expect(onPageChange).toHaveBeenCalledWith(7);
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

  it("calls onToggleFavorite via the context menu", async () => {
    const onToggleFavorite = vi.fn();
    const image = createGalleryImage({ id: "img-fav", prompt: "moonrise" });

    renderImageGallery({
      gallery: { images: [image], totalCount: 1 },
      actions: { onToggleFavorite },
    });

    fireEvent.contextMenu(screen.getByAltText("moonrise"));
    fireEvent.click(await screen.findByText("Add to Favorites"));

    expect(onToggleFavorite).toHaveBeenCalledWith("img-fav");
  });

  it("calls onCopyPrompt via the context menu", async () => {
    const onCopyPrompt = vi.fn();
    const image = createGalleryImage({ id: "img-cp", prompt: "ocean waves" });

    renderImageGallery({
      gallery: { images: [image], totalCount: 1 },
      actions: { onCopyPrompt },
    });

    fireEvent.contextMenu(screen.getByAltText("ocean waves"));
    fireEvent.click(await screen.findByText("Copy Prompt"));

    expect(onCopyPrompt).toHaveBeenCalledWith("ocean waves");
  });

  it("calls onReveal via the context menu", async () => {
    const onReveal = vi.fn();
    const image = createGalleryImage({
      id: "img-rev",
      path: "C:\\gallery\\test.png",
      prompt: "forest clearing",
    });

    renderImageGallery({
      gallery: { images: [image], totalCount: 1 },
      actions: { onReveal },
    });

    fireEvent.contextMenu(screen.getByAltText("forest clearing"));
    fireEvent.click(await screen.findByText("Reveal Original"));

    expect(onReveal).toHaveBeenCalledWith("C:\\gallery\\test.png");
  });

  it("calls onDelete via the context menu", async () => {
    const onDelete = vi.fn();
    const image = createGalleryImage({
      id: "img-del",
      prompt: "abandoned tower",
    });

    renderImageGallery({
      gallery: { images: [image], totalCount: 1 },
      actions: { onDelete },
    });

    fireEvent.contextMenu(screen.getByAltText("abandoned tower"));
    fireEvent.click(await screen.findByText("Delete"));

    expect(onDelete).toHaveBeenCalledWith("img-del");
  });

  it("calls onChangeCategory via the context menu", async () => {
    const onChangeCategory = vi.fn();
    const image = createGalleryImage({
      id: "img-cat",
      prompt: "cherry blossoms",
    });

    renderImageGallery({
      gallery: { images: [image], totalCount: 1 },
      actions: { onChangeCategory },
    });

    fireEvent.contextMenu(screen.getByAltText("cherry blossoms"));
    fireEvent.click(await screen.findByText("Change Category"));

    expect(onChangeCategory).toHaveBeenCalledWith(image);
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
      gallery: {
        images: pageImages,
        totalCount: 3,
      },
      actions: {
        onBulkChangeCategory,
        onLoadAllSelectableImages,
      },
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
