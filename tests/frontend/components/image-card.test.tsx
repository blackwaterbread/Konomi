import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ImageCard } from "@/components/image-card";
import { createGalleryImage } from "../helpers/gallery-image";
import { setElectronMode } from "../helpers/electron-mode";

vi.mock("@/components/ui/context-menu", async () => {
  const { contextMenuMock } = await import("../helpers/context-menu-mock");
  return contextMenuMock;
});

function renderImageCard(overrides: Record<string, unknown> = {}) {
  const props = {
    image: createGalleryImage(),
    onToggleFavorite: vi.fn(),
    onCopyPrompt: vi.fn(),
    onClick: vi.fn(),
    onReveal: vi.fn(),
    onDelete: vi.fn(),
    onChangeCategory: vi.fn(),
    ...overrides,
  };
  return render(<ImageCard {...(props as ComponentProps<typeof ImageCard>)} />);
}

describe("ImageCard platform branches", () => {
  it("hides Reveal Original item in browser mode", () => {
    renderImageCard();

    expect(
      screen.queryByRole("button", { name: "Reveal Original" }),
    ).not.toBeInTheDocument();
  });

  it("shows Reveal Original item in electron mode", () => {
    setElectronMode(true);
    renderImageCard();

    expect(
      screen.getByRole("button", { name: "Reveal Original" }),
    ).toBeInTheDocument();
  });
});
