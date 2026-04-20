import { type ComponentProps, useEffect, useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImageDetail } from "@/components/image-detail";
import { createGalleryImage } from "../helpers/gallery-image";
import { setElectronMode } from "../helpers/electron-mode";

vi.mock("@/components/ui/context-menu", async () => {
  const { contextMenuMock } = await import("../helpers/context-menu-mock");
  return contextMenuMock;
});

/** Wrapper that manages similarPage state for tests that need paging interaction */
function PagedImageDetail(
  props: ComponentProps<typeof ImageDetail> & { pageSize?: number },
) {
  const { pageSize = 10, similarImages = [], ...rest } = props;
  const anchorId = rest.image?.id ?? null;
  const otherCount = similarImages.filter((img) => img.id !== anchorId).length;
  const totalPages =
    otherCount > 0 ? Math.ceil((otherCount + 1) / pageSize) : 0;

  const [page, setPage] = useState(0);
  const prevAnchorRef = useRef(anchorId);
  useEffect(() => {
    if (prevAnchorRef.current !== anchorId) {
      prevAnchorRef.current = anchorId;
      setPage(0);
    }
  }, [anchorId]);
  // Clamp page on data change
  const clampedPage = totalPages <= 1 ? 0 : Math.min(page, totalPages - 1);

  // Slice similarImages to simulate what useSimilarImages hook does
  const other = similarImages.filter((img) => img.id !== anchorId);
  const anchor = similarImages.find((img) => img.id === anchorId);
  const candidateStart = clampedPage === 0 ? 0 : clampedPage * pageSize - 1;
  const candidateEnd =
    clampedPage === 0 ? pageSize - 1 : (clampedPage + 1) * pageSize - 1;
  const pagedCandidates = other.slice(candidateStart, candidateEnd);
  const pagedImages = anchor
    ? clampedPage === 0
      ? [anchor, ...pagedCandidates]
      : pagedCandidates
    : pagedCandidates;

  return (
    <ImageDetail
      {...rest}
      similarImages={pagedImages}
      similarPage={clampedPage}
      similarTotalPages={totalPages}
      onSimilarPageChange={setPage}
    />
  );
}

function renderPagedImageDetail(
  overrides: Partial<
    ComponentProps<typeof ImageDetail> & { pageSize?: number }
  > = {},
) {
  const image = createGalleryImage({
    id: "image-1",
    path: "C:\\gallery\\image-1.png",
    src: "konomi://local/C%3A%2Fgallery%2Fimage-1.png",
  });
  const props = {
    image,
    isOpen: true,
    onClose: vi.fn(),
    onToggleFavorite: vi.fn(),
    onCopyPrompt: vi.fn(),
    onAddTagToSearch: vi.fn(),
    onAddTagToGenerator: vi.fn(),
    prevImage: null,
    nextImage: null,
    hasPrev: false,
    hasNext: false,
    onPrev: vi.fn(),
    onNext: vi.fn(),
    ...overrides,
  };

  return {
    ...render(<PagedImageDetail {...props} />),
    props,
  };
}

function getSimilarPanel(): HTMLElement {
  const panel = screen.getByText("Similar Images").parentElement;
  if (!(panel instanceof HTMLElement)) {
    throw new Error("Failed to find similar images panel");
  }
  return panel;
}

function getSimilarThumbButtons(panel: HTMLElement): HTMLButtonElement[] {
  const thumbsViewport = panel.children[1];
  if (!(thumbsViewport instanceof HTMLElement)) {
    throw new Error("Failed to find similar thumbnails viewport");
  }
  return within(thumbsViewport).getAllByRole("button") as HTMLButtonElement[];
}

function getSimilarPagerButtons(panel: HTMLElement): HTMLButtonElement[] {
  const pager = panel.children[2];
  if (!(pager instanceof HTMLElement)) {
    throw new Error("Failed to find similar pager element");
  }
  return within(pager).getAllByRole("button") as HTMLButtonElement[];
}

describe("ImageDetail similar images", () => {
  it("renders the similar images section with paging, reason badges, and click handling", async () => {
    const user = userEvent.setup();
    const currentImage = createGalleryImage({
      id: "image-1",
      path: "C:\\gallery\\image-1.png",
      src: "konomi://local/C%3A%2Fgallery%2Fimage-1.png",
    });
    const visualImage = createGalleryImage({
      id: "image-2",
      path: "C:\\gallery\\image-2.png",
      src: "konomi://local/C%3A%2Fgallery%2Fimage-2.png",
    });
    const promptImage = createGalleryImage({
      id: "image-3",
      path: "C:\\gallery\\image-3.png",
      src: "konomi://local/C%3A%2Fgallery%2Fimage-3.png",
    });
    const bothImage = createGalleryImage({
      id: "image-4",
      path: "C:\\gallery\\image-4.png",
      src: "konomi://local/C%3A%2Fgallery%2Fimage-4.png",
    });
    const onSimilarImageClick = vi.fn();

    renderPagedImageDetail({
      image: currentImage,
      similarImages: [currentImage, visualImage, promptImage, bothImage],
      similarReasons: {
        "image-2": "visual",
        "image-3": "prompt",
        "image-4": "both",
      },
      onSimilarImageClick,
      pageSize: 2,
    });

    const panel = getSimilarPanel();
    const thumbsViewport = panel.children[1] as HTMLElement;
    const pager = panel.children[2] as HTMLElement;
    const [currentThumb, visualThumb] = getSimilarThumbButtons(panel);

    expect(within(pager).getByText("1/2")).toBeInTheDocument();
    expect(within(thumbsViewport).getByText("V")).toBeInTheDocument();

    await user.click(currentThumb);
    expect(onSimilarImageClick).not.toHaveBeenCalled();

    await user.click(visualThumb);
    expect(onSimilarImageClick).toHaveBeenCalledWith(visualImage);

    const [, nextPageButton] = getSimilarPagerButtons(panel);
    await user.click(nextPageButton);

    expect(within(pager).getByText("2/2")).toBeInTheDocument();
    expect(within(thumbsViewport).getByText("P")).toBeInTheDocument();
    expect(within(thumbsViewport).getByText("B")).toBeInTheDocument();
  });

  it("resets the similar images page when the selected image changes", async () => {
    const user = userEvent.setup();
    const firstImage = createGalleryImage({
      id: "image-10",
      path: "C:\\gallery\\image-10.png",
      src: "konomi://local/C%3A%2Fgallery%2Fimage-10.png",
    });
    const secondImage = createGalleryImage({
      id: "image-11",
      path: "C:\\gallery\\image-11.png",
      src: "konomi://local/C%3A%2Fgallery%2Fimage-11.png",
    });
    const thirdImage = createGalleryImage({
      id: "image-12",
      path: "C:\\gallery\\image-12.png",
      src: "konomi://local/C%3A%2Fgallery%2Fimage-12.png",
    });
    const fourthImage = createGalleryImage({
      id: "image-13",
      path: "C:\\gallery\\image-13.png",
      src: "konomi://local/C%3A%2Fgallery%2Fimage-13.png",
    });

    const { rerender, props } = renderPagedImageDetail({
      image: firstImage,
      similarImages: [firstImage, secondImage, thirdImage, fourthImage],
      pageSize: 2,
    });

    const panel = getSimilarPanel();
    const [, nextPageButton] = getSimilarPagerButtons(panel);

    await user.click(nextPageButton);
    expect(within(panel).getByText("2/2")).toBeInTheDocument();

    rerender(
      <PagedImageDetail
        {...props}
        image={secondImage}
        similarImages={[secondImage, thirdImage, fourthImage, firstImage]}
        pageSize={2}
      />,
    );

    expect(within(panel).getByText("1/2")).toBeInTheDocument();
  });

  it("keeps showing similar thumbnails when the list shrinks for the same selected image", async () => {
    const user = userEvent.setup();
    const currentImage = createGalleryImage({
      id: "image-20",
      path: "C:\\gallery\\image-20.png",
      src: "konomi://local/C%3A%2Fgallery%2Fimage-20.png",
    });
    const secondImage = createGalleryImage({
      id: "image-21",
      path: "C:\\gallery\\image-21.png",
      src: "konomi://local/C%3A%2Fgallery%2Fimage-21.png",
    });
    const thirdImage = createGalleryImage({
      id: "image-22",
      path: "C:\\gallery\\image-22.png",
      src: "konomi://local/C%3A%2Fgallery%2Fimage-22.png",
    });
    const fourthImage = createGalleryImage({
      id: "image-23",
      path: "C:\\gallery\\image-23.png",
      src: "konomi://local/C%3A%2Fgallery%2Fimage-23.png",
    });

    const { rerender, props } = renderPagedImageDetail({
      image: currentImage,
      similarImages: [currentImage, secondImage, thirdImage, fourthImage],
      pageSize: 2,
    });

    const panel = getSimilarPanel();
    const [, nextPageButton] = getSimilarPagerButtons(panel);
    await user.click(nextPageButton);

    expect(within(panel).getByText("2/2")).toBeInTheDocument();

    rerender(
      <PagedImageDetail
        {...props}
        image={currentImage}
        similarImages={[currentImage, secondImage]}
        pageSize={2}
      />,
    );

    expect(getSimilarThumbButtons(panel)).toHaveLength(2);
    expect(within(panel).queryByText("2/2")).not.toBeInTheDocument();
  });
});

describe("ImageDetail platform branches", () => {
  it("hides Reveal Original item in browser mode", () => {
    renderPagedImageDetail();

    expect(
      screen.queryByRole("menuitem", { name: "Reveal Original" }),
    ).not.toBeInTheDocument();
  });

  it("shows Reveal Original item in electron mode when onReveal is provided", () => {
    setElectronMode(true);
    renderPagedImageDetail({ onReveal: vi.fn() });

    expect(
      screen.getByRole("menuitem", { name: "Reveal Original" }),
    ).toBeInTheDocument();
  });

  it("hides Reveal Original item in electron mode when onReveal is absent", () => {
    setElectronMode(true);
    renderPagedImageDetail();

    expect(
      screen.queryByRole("menuitem", { name: "Reveal Original" }),
    ).not.toBeInTheDocument();
  });
});
