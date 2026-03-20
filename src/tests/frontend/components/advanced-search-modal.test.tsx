import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AdvancedSearchModal } from "@/components/advanced-search-modal";
import type { AdvancedFilter } from "@/lib/advanced-filter";

function renderAdvancedSearchModal(
  overrides: Partial<React.ComponentProps<typeof AdvancedSearchModal>> = {},
) {
  const props: React.ComponentProps<typeof AdvancedSearchModal> = {
    open: true,
    onClose: vi.fn(),
    activeFilters: [],
    onFiltersChange: vi.fn(),
    availableResolutions: [],
    availableModels: [],
    ...overrides,
  };

  return {
    ...render(<AdvancedSearchModal {...props} />),
    props,
  };
}

describe("AdvancedSearchModal", () => {
  it("toggles preset resolution filters on and off", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    const filter: AdvancedFilter = {
      type: "resolution",
      width: 832,
      height: 1216,
    };

    const { rerender, props } = renderAdvancedSearchModal({
      activeFilters: [],
      onFiltersChange,
      availableResolutions: [{ width: 832, height: 1216 }],
    });

    await user.click(screen.getByRole("button", { name: "832x1216" }));

    expect(onFiltersChange).toHaveBeenCalledWith([filter]);

    rerender(
      <AdvancedSearchModal
        {...props}
        activeFilters={[filter]}
        onFiltersChange={onFiltersChange}
        availableResolutions={[{ width: 832, height: 1216 }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "832x1216" }));

    expect(onFiltersChange).toHaveBeenLastCalledWith([]);
  });

  it("adds a manual resolution filter and clears the inputs", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();

    renderAdvancedSearchModal({
      onFiltersChange,
    });

    const widthInput = screen.getByPlaceholderText("Width");
    const heightInput = screen.getByPlaceholderText("Height");

    await user.type(widthInput, "1024");
    await user.type(heightInput, "1536");
    await user.click(screen.getAllByRole("button", { name: "Add" })[0]);

    expect(onFiltersChange).toHaveBeenCalledWith([
      { type: "resolution", width: 1024, height: 1536 },
    ]);
    expect(widthInput).toHaveValue(null);
    expect(heightInput).toHaveValue(null);
  });

  it("adds a suggested model filter from the autocomplete list", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();

    renderAdvancedSearchModal({
      onFiltersChange,
      availableModels: [
        "nai-diffusion-4-5-full",
        "nai-diffusion-4-5-curated",
      ],
    });

    const modelInput = screen.getByPlaceholderText("Enter model name");

    await user.type(modelInput, "cur");
    await user.click(
      screen.getAllByRole("button", { name: "nai-diffusion-4-5-curated" })[1],
    );
    await user.click(screen.getAllByRole("button", { name: "Add" })[1]);

    expect(onFiltersChange).toHaveBeenCalledWith([
      { type: "model", value: "nai-diffusion-4-5-curated" },
    ]);
    expect(modelInput).toHaveValue("");
  });
});
