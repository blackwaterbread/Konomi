import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PromptInput } from "@/components/prompt-input";
import type { PromptGroup } from "@preload/index.d";
import { preloadMocks } from "../helpers/preload-mocks";

vi.mock("@/components/token-chip", () => ({
  TokenChip: ({
    token,
    chipRef,
    onTokenFocus,
    onTokenKeyDown,
  }: {
    token: { text: string };
    chipRef?: (node: HTMLButtonElement | null) => void;
    onTokenFocus?: () => void;
    onTokenKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  }) => (
    <button
      ref={chipRef}
      type="button"
      onFocus={onTokenFocus}
      onKeyDown={onTokenKeyDown}
    >
      {token.text}
    </button>
  ),
}));

vi.mock("@/components/group-chip", () => ({
  GroupChip: ({
    token,
    chipRef,
    onTokenFocus,
    onTokenKeyDown,
  }: {
    token: { groupName: string };
    chipRef?: (node: HTMLButtonElement | null) => void;
    onTokenFocus?: () => void;
    onTokenKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  }) => (
    <button
      ref={chipRef}
      type="button"
      onFocus={onTokenFocus}
      onKeyDown={onTokenKeyDown}
    >
      @{`{${token.groupName}}`}
    </button>
  ),
}));

vi.mock("@/components/wildcard-chip", () => ({
  WildcardChip: ({
    token,
    chipRef,
    onTokenFocus,
    onTokenKeyDown,
  }: {
    token: { options?: string[] };
    chipRef?: (node: HTMLButtonElement | null) => void;
    onTokenFocus?: () => void;
    onTokenKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  }) => (
    <button
      ref={chipRef}
      type="button"
      onFocus={onTokenFocus}
      onKeyDown={onTokenKeyDown}
    >
      %{`{${token.options?.join("|") ?? ""}}`}
    </button>
  ),
}));

vi.mock("@/components/prompt-tag-suggestion-indicator", () => ({
  PromptTagSuggestionIndicator: () => <span data-testid="tag-indicator" />,
}));

function renderPromptInput(
  overrides: Partial<React.ComponentProps<typeof PromptInput>> = {},
) {
  const onChange = overrides.onChange ?? vi.fn();
  const props: React.ComponentProps<typeof PromptInput> = {
    value: "",
    onChange,
    groups: [],
    ...overrides,
  };

  function ControlledPromptInput() {
    const [value, setValue] = React.useState(props.value);

    return (
      <PromptInput
        {...props}
        value={value}
        onChange={(nextValue) => {
          setValue(nextValue);
          props.onChange(nextValue);
        }}
      />
    );
  }

  return {
    ...render(<ControlledPromptInput />),
    props,
  };
}

describe("PromptInput", () => {
  it("tokenizes comma-separated chunks into prompt tokens", async () => {
    const onChange = vi.fn();

    renderPromptInput({ onChange });

    const input = screen.getByLabelText("tag, tag, tag...");

    fireEvent.change(input, { target: { value: "sparkles," } });

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("sparkles"));
    expect(
      screen.getByRole("button", { name: "sparkles" }),
    ).toBeInTheDocument();
  });

  it("shows group autocomplete and inserts the selected group token", async () => {
    const onChange = vi.fn();
    const groups: PromptGroup[] = [
      {
        id: 1,
        name: "landscape",
        categoryId: 1,
        order: 0,
        tokens: [],
      },
    ];

    renderPromptInput({ onChange, groups });

    const input = screen.getByLabelText("tag, tag, tag...");

    fireEvent.change(input, { target: { value: "@{lan" } });
    fireEvent.mouseDown(screen.getByText("{landscape}").closest("button")!);

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith("@{landscape}"),
    );
    expect(
      screen.getByRole("button", { name: "@{landscape}" }),
    ).toBeInTheDocument();
  });

  it("loads prompt-tag suggestions for the current draft and applies the selected one", async () => {
    const onChange = vi.fn();

    preloadMocks.promptBuilder.suggestTags.mockResolvedValueOnce({
      suggestions: [{ tag: "sunset", count: 12 }],
      stats: { totalTags: 10, maxCount: 12, bucketThresholds: [3, 6, 9] },
    });

    renderPromptInput({ onChange });

    const input = screen.getByLabelText("tag, tag, tag...");

    fireEvent.change(input, { target: { value: "sun" } });

    await waitFor(() =>
      expect(preloadMocks.promptBuilder.suggestTags).toHaveBeenCalledWith({
        prefix: "sun",
        limit: 8,
        exclude: [],
      }),
    );

    fireEvent.mouseDown(screen.getByText("sunset").closest("button")!);

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith("sunset"),
    );
    expect(screen.getByRole("button", { name: "sunset" })).toBeInTheDocument();
  });

  it("renders a raw-text editor mode that edits the prompt directly", async () => {
    const onChange = vi.fn();

    renderPromptInput({
      value: "sparkles, sunset",
      onChange,
      displayMode: "raw",
    });

    const textarea = screen.getByRole("textbox", {
      name: "tag, tag, tag...",
    });

    expect(textarea).toHaveValue("sparkles, sunset");
    expect(
      screen.queryByRole("button", { name: "sparkles" }),
    ).not.toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: "raw prompt text" } });

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith("raw prompt text"),
    );
  });
});
