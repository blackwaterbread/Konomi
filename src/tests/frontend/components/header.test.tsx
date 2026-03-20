import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Header } from "@/components/header";
import { dispatchSearchInputAppendTag } from "@/lib/search-input-event";
import type { AdvancedFilter } from "@/lib/advanced-filter";
import { preloadMocks } from "../helpers/preload-mocks";

vi.mock("@/components/advanced-search-modal", () => ({
  AdvancedSearchModal: () => null,
}));

vi.mock("@/components/app-info-dialog", () => ({
  AppInfoDialog: () => null,
}));

function renderHeader(
  overrides: Partial<React.ComponentProps<typeof Header>> = {},
) {
  const props: React.ComponentProps<typeof Header> = {
    searchQuery: "",
    onSearchChange: vi.fn(),
    activePanel: "gallery",
    onPanelChange: vi.fn(),
    scanning: false,
    isAnalyzing: false,
    hashProgress: null,
    similarityProgress: null,
    scanProgress: null,
    searchStatsProgress: null,
    scanningFolderNames: new Map(),
    onCancelScan: vi.fn(),
    advancedFilters: [],
    onAdvancedFiltersChange: vi.fn(),
    availableResolutions: [],
    availableModels: [],
    onStartTour: vi.fn(),
    ...overrides,
  };

  return {
    ...render(<Header {...props} />),
    props,
  };
}

describe("Header", () => {
  beforeEach(() => {
    preloadMocks.image.suggestTags.mockResolvedValue([]);
  });

  it("suggests tags for the active token and commits the selected suggestion", async () => {
    const onSearchChange = vi.fn();

    preloadMocks.image.suggestTags.mockResolvedValue([
      { tag: "sunset", count: 12 },
      { tag: "sunrise", count: 8 },
    ]);

    renderHeader({ onSearchChange });

    const input = screen.getByPlaceholderText(
      "Search images by prompt...",
    ) as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, {
      target: { value: "cat, su", selectionStart: 7 },
    });
    input.setSelectionRange(7, 7);
    fireEvent.keyUp(input, { key: "u" });

    await waitFor(() =>
      expect(preloadMocks.image.suggestTags).toHaveBeenCalledWith({
        prefix: "su",
        limit: 8,
        exclude: ["cat"],
      }),
    );
    await waitFor(() => expect(screen.getByText("sunset")).toBeInTheDocument());

    fireEvent.keyDown(input, { key: "Enter" });

    expect(input).toHaveValue("cat, sunset");
    expect(onSearchChange).toHaveBeenCalledWith("cat, sunset");
  });

  it("appends externally requested tags into search and commits the updated query", async () => {
    const onSearchChange = vi.fn();

    renderHeader({
      searchQuery: "sunset",
      onSearchChange,
    });

    const input = screen.getByPlaceholderText(
      "Search images by prompt...",
    ) as HTMLInputElement;

    act(() => {
      dispatchSearchInputAppendTag({
        tag: "sparkles",
        focusInput: true,
        suppressAutocomplete: true,
      });
    });

    await waitFor(() => expect(input).toHaveValue("sunset, sparkles"));
    expect(input).toHaveFocus();

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSearchChange).toHaveBeenCalledWith("sunset, sparkles");
  });

  it("removes active filter chips through the chip close button", async () => {
    const user = userEvent.setup();
    const onAdvancedFiltersChange = vi.fn();
    const filters: AdvancedFilter[] = [
      { type: "resolution", width: 832, height: 1216 },
      { type: "model", value: "nai-diffusion-4-5-full" },
    ];

    renderHeader({
      advancedFilters: filters,
      onAdvancedFiltersChange,
    });

    const chip = screen.getByText("832x1216").closest("span");
    const removeButton = chip?.querySelector("button");

    expect(removeButton).not.toBeNull();
    await user.click(removeButton!);

    expect(onAdvancedFiltersChange).toHaveBeenCalledWith([
      { type: "model", value: "nai-diffusion-4-5-full" },
    ]);
  });
});
