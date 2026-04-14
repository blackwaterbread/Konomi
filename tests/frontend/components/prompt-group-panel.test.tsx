import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PromptGroupPanel } from "@/components/prompt-group-panel";
import type { PromptCategory } from "@preload/index.d";
import { preloadMocks } from "../helpers/preload-mocks";

function renderPromptGroupPanel(
  overrides: Partial<React.ComponentProps<typeof PromptGroupPanel>> = {},
) {
  const onCategoriesChange = overrides.onCategoriesChange ?? vi.fn();
  const props: React.ComponentProps<typeof PromptGroupPanel> = {
    categories: [],
    onCategoriesChange,
    ...overrides,
  };

  function ControlledPromptGroupPanel() {
    const [categories, setCategories] = React.useState(props.categories);

    return (
      <PromptGroupPanel
        {...props}
        categories={categories}
        onCategoriesChange={(nextCategories) => {
          setCategories(nextCategories);
          props.onCategoriesChange(nextCategories);
        }}
      />
    );
  }

  return {
    ...render(<ControlledPromptGroupPanel />),
    props,
  };
}

describe("PromptGroupPanel", () => {
  it("shows tag suggestions in the group tag editor and applies the picked tag", async () => {
    const user = userEvent.setup();
    const categories: PromptCategory[] = [
      {
        id: 1,
        name: "Custom",
        isBuiltin: false,
        order: 0,
        groups: [],
      },
    ];

    preloadMocks.promptBuilder.suggestTags.mockResolvedValueOnce({
      suggestions: [{ tag: "sunset", count: 12 }],
      stats: { totalTags: 10, maxCount: 12, bucketThresholds: [3, 6, 9] },
    });

    renderPromptGroupPanel({ categories });

    await user.click(screen.getByText("Custom"));
    await user.click(screen.getAllByRole("button", { name: "Add group" })[0]!);

    const tagsInput = screen.getByLabelText("Group tags");
    fireEvent.focus(tagsInput);
    fireEvent.change(tagsInput, {
      target: { value: "sun", selectionStart: 3 },
    });

    await waitFor(() =>
      expect(preloadMocks.promptBuilder.suggestTags).toHaveBeenCalledWith({
        prefix: "sun",
        limit: 8,
        exclude: [],
      }),
    );

    fireEvent.mouseDown(await screen.findByRole("button", { name: /sunset/i }));

    await waitFor(() => expect(tagsInput).toHaveValue("sunset"));
  });

  it("creates a group together with its tags", async () => {
    const user = userEvent.setup();
    const categories: PromptCategory[] = [
      {
        id: 1,
        name: "Custom",
        isBuiltin: false,
        order: 0,
        groups: [],
      },
    ];

    preloadMocks.promptBuilder.createGroup.mockResolvedValueOnce({
      id: 10,
      name: "Sunset bundle",
      categoryId: 1,
      order: 0,
      tokens: [],
    });

    let nextTokenId = 100;
    preloadMocks.promptBuilder.createToken.mockImplementation(
      async (groupId: number, label: string) => ({
        id: nextTokenId++,
        label,
        order: nextTokenId - 101,
        groupId,
      }),
    );

    renderPromptGroupPanel({ categories });

    await user.click(screen.getByText("Custom"));
    await user.click(screen.getAllByRole("button", { name: "Add group" })[0]!);

    await user.type(screen.getByLabelText("Group name"), "Sunset bundle");
    await user.type(screen.getByLabelText("Group tags"), "sunset, warm light");
    await user.click(screen.getAllByRole("button", { name: "Add group" })[1]!);

    await waitFor(() =>
      expect(preloadMocks.promptBuilder.createGroup).toHaveBeenCalledWith(
        1,
        "Sunset bundle",
      ),
    );
    expect(preloadMocks.promptBuilder.createToken).toHaveBeenNthCalledWith(
      1,
      10,
      "sunset",
    );
    expect(preloadMocks.promptBuilder.createToken).toHaveBeenNthCalledWith(
      2,
      10,
      "warm light",
    );
    expect(await screen.findByText("{Sunset bundle}")).toBeInTheDocument();
    expect(screen.getByText("sunset, warm light")).toBeInTheDocument();
  });

  it("saves edited group tags by syncing create delete and reorder operations", async () => {
    const user = userEvent.setup();
    const categories: PromptCategory[] = [
      {
        id: 1,
        name: "Custom",
        isBuiltin: false,
        order: 0,
        groups: [
          {
            id: 7,
            name: "Lighting",
            categoryId: 1,
            order: 0,
            tokens: [
              { id: 20, label: "warm light", order: 0, groupId: 7 },
              { id: 21, label: "rim light", order: 1, groupId: 7 },
            ],
          },
        ],
      },
    ];

    preloadMocks.promptBuilder.renameGroup.mockResolvedValueOnce(undefined);
    preloadMocks.promptBuilder.createToken.mockResolvedValueOnce({
      id: 22,
      label: "soft glow",
      order: 2,
      groupId: 7,
    });
    preloadMocks.promptBuilder.deleteToken.mockResolvedValueOnce(undefined);
    preloadMocks.promptBuilder.reorderTokens.mockResolvedValueOnce(undefined);

    renderPromptGroupPanel({ categories });

    await user.click(screen.getByText("Custom"));
    await user.click(screen.getByRole("button", { name: "Edit group" }));

    const nameInput = screen.getByLabelText("Group name");
    const tagsInput = screen.getByLabelText("Group tags");

    await user.clear(nameInput);
    await user.type(nameInput, "Lighting Plus");
    fireEvent.change(tagsInput, { target: { value: "rim light, soft glow" } });
    await user.click(screen.getByRole("button", { name: "Save group" }));

    await waitFor(() =>
      expect(preloadMocks.promptBuilder.renameGroup).toHaveBeenCalledWith(
        7,
        "Lighting Plus",
      ),
    );
    expect(preloadMocks.promptBuilder.createToken).toHaveBeenCalledWith(
      7,
      "soft glow",
    );
    expect(preloadMocks.promptBuilder.deleteToken).toHaveBeenCalledWith(20);
    expect(preloadMocks.promptBuilder.reorderTokens).toHaveBeenCalledWith(
      7,
      [21, 22],
    );
    expect(await screen.findByText("{Lighting Plus}")).toBeInTheDocument();
    expect(screen.getByText("rim light, soft glow")).toBeInTheDocument();
  });
});
