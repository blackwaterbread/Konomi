import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function renderToggleablePromptInput(
  overrides: Partial<React.ComponentProps<typeof PromptInput>> = {},
) {
  const onChange = overrides.onChange ?? vi.fn();
  const props: React.ComponentProps<typeof PromptInput> = {
    value: "",
    onChange,
    groups: [],
    displayMode: "raw",
    ...overrides,
  };

  function ToggleablePromptInput() {
    const [value, setValue] = React.useState(props.value);
    const [displayMode, setDisplayMode] = React.useState<
      React.ComponentProps<typeof PromptInput>["displayMode"]
    >(props.displayMode);

    return (
      <>
        <button
          type="button"
          onClick={() =>
            setDisplayMode((prev) => (prev === "raw" ? "chips" : "raw"))
          }
        >
          Toggle Mode
        </button>
        <PromptInput
          {...props}
          value={value}
          displayMode={displayMode}
          onChange={(nextValue) => {
            setValue(nextValue);
            props.onChange(nextValue);
          }}
        />
      </>
    );
  }

  return {
    ...render(<ToggleablePromptInput />),
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

  it("does not auto-apply a tag suggestion on Enter before ArrowDown", async () => {
    preloadMocks.promptBuilder.suggestTags.mockResolvedValueOnce({
      suggestions: [{ tag: "sunset", count: 12 }],
      stats: { totalTags: 10, maxCount: 12, bucketThresholds: [3, 6, 9] },
    });

    renderPromptInput();

    const input = screen.getByLabelText("tag, tag, tag...");

    fireEvent.change(input, { target: { value: "sun" } });

    await screen.findByText("sunset");

    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByRole("button", { name: "sun" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "sunset" }),
    ).not.toBeInTheDocument();
  });

  it("keeps applying the first tag suggestion on Tab without ArrowDown", async () => {
    preloadMocks.promptBuilder.suggestTags.mockResolvedValueOnce({
      suggestions: [{ tag: "sunset", count: 12 }],
      stats: { totalTags: 10, maxCount: 12, bucketThresholds: [3, 6, 9] },
    });

    renderPromptInput();

    const input = screen.getByLabelText("tag, tag, tag...");

    fireEvent.change(input, { target: { value: "sun" } });

    await screen.findByText("sunset");

    fireEvent.keyDown(input, { key: "Tab" });

    expect(screen.getByRole("button", { name: "sunset" })).toBeInTheDocument();
  });

  it("applies a tag suggestion on Enter after ArrowDown", async () => {
    preloadMocks.promptBuilder.suggestTags.mockResolvedValueOnce({
      suggestions: [{ tag: "sunset", count: 12 }],
      stats: { totalTags: 10, maxCount: 12, bucketThresholds: [3, 6, 9] },
    });

    renderPromptInput();

    const input = screen.getByLabelText("tag, tag, tag...");

    fireEvent.change(input, { target: { value: "sun" } });

    await screen.findByText("sunset");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

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

  it("shows a Radix context menu for the raw-text editor", async () => {
    renderPromptInput({
      value: "sparkles, sunset",
      displayMode: "raw",
    });

    const textarea = screen.getByRole("textbox", {
      name: "tag, tag, tag...",
    });

    fireEvent.contextMenu(textarea);

    expect(await screen.findByText("Cut")).toBeInTheDocument();
    expect(screen.getByText("Copy")).toBeInTheDocument();
    expect(screen.getByText("Paste")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
    expect(screen.getByText("Select all")).toBeInTheDocument();
  });

  it("renders weighted raw-mode highlights with stronger background tones", () => {
    const { container } = renderPromptInput({
      value: "1.4::sparkles::, {sunset}, [simple background]",
      displayMode: "raw",
    });

    const highlights = Array.from(
      container.querySelectorAll("[data-prompt-raw-highlight]"),
    );

    expect(highlights).toHaveLength(3);
    expect(highlights[0]).toHaveTextContent("1.4::sparkles::");
    expect(highlights[0]).toHaveClass("bg-warning/45");
    expect(highlights[1]).toHaveTextContent("{sunset}");
    expect(highlights[1]).toHaveClass("bg-primary/40");
    expect(highlights[2]).toHaveTextContent("[simple background]");
    expect(highlights[2]).toHaveClass("bg-group/38");
  });

  it("keeps raw-mode highlight spans aligned to full multi-tag emphasis segments", () => {
    const prompt =
      "0.75::artist:oda_eiichirou, year 2023::, {oekaki, lineart}, plain";
    const { container } = renderPromptInput({
      value: prompt,
      displayMode: "raw",
    });

    const highlights = Array.from(
      container.querySelectorAll("[data-prompt-raw-highlight]"),
    );

    expect(highlights).toHaveLength(2);
    expect(highlights[0]).toHaveTextContent(
      "0.75::artist:oda_eiichirou, year 2023::",
    );
    expect(highlights[1]).toHaveTextContent("{oekaki, lineart}");
  });

  it("renders malformed emphasis syntax with destructive raw-mode feedback", () => {
    const { container } = renderPromptInput({
      value: "1.2::oda_eiichirou, {sunset, [simple background",
      displayMode: "raw",
    });

    const errors = Array.from(
      container.querySelectorAll("[data-prompt-raw-syntax-error]"),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toHaveTextContent(
      "1.2::oda_eiichirou, {sunset, [simple background",
    );
    expect(errors[0]).toHaveClass("bg-destructive/42");
  });

  it("cuts and pastes text through the raw-text context menu", async () => {
    const onChange = vi.fn();
    const clipboardWriteText = vi.mocked(navigator.clipboard.writeText);
    const clipboardReadText = vi.mocked(navigator.clipboard.readText);
    clipboardWriteText.mockClear();
    clipboardReadText.mockClear();
    clipboardReadText.mockResolvedValueOnce("stars");

    renderPromptInput({
      value: "prompt text",
      onChange,
      displayMode: "raw",
    });

    const textarea = screen.getByRole("textbox", {
      name: "tag, tag, tag...",
    }) as HTMLTextAreaElement;

    textarea.focus();
    textarea.setSelectionRange(0, 6);

    fireEvent.contextMenu(textarea);
    fireEvent.click(await screen.findByText("Cut"));

    await waitFor(() => {
      expect(clipboardWriteText).toHaveBeenLastCalledWith("prompt");
      expect(onChange).toHaveBeenLastCalledWith(" text");
    });
    await waitFor(() => expect(textarea).toHaveValue(" text"));

    textarea.focus();
    textarea.setSelectionRange(0, 0);

    fireEvent.contextMenu(textarea);
    fireEvent.click(await screen.findByText("Paste"));

    await waitFor(() => {
      expect(clipboardReadText).toHaveBeenCalled();
      expect(onChange).toHaveBeenLastCalledWith("stars text");
    });
    await waitFor(() => expect(textarea).toHaveValue("stars text"));
  });

  it("undoes and redoes raw-text edits with keyboard shortcuts", async () => {
    const onChange = vi.fn();

    renderPromptInput({
      value: "prompt",
      onChange,
      displayMode: "raw",
    });

    const textarea = screen.getByRole("textbox", {
      name: "tag, tag, tag...",
    }) as HTMLTextAreaElement;

    textarea.focus();
    textarea.setSelectionRange(6, 6);
    fireEvent.keyDown(textarea, { key: "!" });
    fireEvent.change(textarea, { target: { value: "prompt!" } });

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith("prompt!"),
    );
    await waitFor(() => expect(textarea).toHaveValue("prompt!"));

    fireEvent.keyDown(textarea, { key: "z", ctrlKey: true });

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith("prompt"),
    );
    await waitFor(() => expect(textarea).toHaveValue("prompt"));

    fireEvent.keyDown(textarea, { key: "z", ctrlKey: true, shiftKey: true });

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith("prompt!"),
    );
    await waitFor(() => expect(textarea).toHaveValue("prompt!"));
  });

  it("uses the latest raw-mode value when switching back to chips", async () => {
    renderToggleablePromptInput({
      value: "sparkles",
      displayMode: "raw",
    });

    const textarea = screen.getByRole("textbox", {
      name: "tag, tag, tag...",
    });

    act(() => {
      fireEvent.change(textarea, {
        target: { value: "sparkles, sunset, stars" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Toggle Mode" }));
    });

    expect(
      await screen.findByRole("button", { name: "stars" }),
    ).toBeInTheDocument();
  });

  it("does not keep the n-1 malformed explicit-weight token after raw undo recovery", async () => {
    renderToggleablePromptInput({
      value: "0.75::artist:oda_eiichirou::,",
      displayMode: "raw",
    });

    const textarea = screen.getByRole("textbox", {
      name: "tag, tag, tag...",
    }) as HTMLTextAreaElement;

    act(() => {
      textarea.focus();
      textarea.setSelectionRange(
        "0.75::artist:oda_eiichirou::".length,
        "0.75::artist:oda_eiichirou::".length,
      );
      fireEvent.keyDown(textarea, { key: "Backspace" });
      fireEvent.change(textarea, {
        target: { value: "0.75::artist:oda_eiichirou:,", selectionStart: 27, selectionEnd: 27 },
      });
      fireEvent.keyDown(textarea, { key: "Backspace" });
      fireEvent.change(textarea, {
        target: { value: "0.75::artist:oda_eiichirou,", selectionStart: 26, selectionEnd: 26 },
      });
    });

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Toggle Mode" }));
      fireEvent.click(screen.getByRole("button", { name: "Toggle Mode" }));
    });

    const rawAgain = screen.getByRole("textbox", {
      name: "tag, tag, tag...",
    }) as HTMLTextAreaElement;

    act(() => {
      fireEvent.keyDown(rawAgain, { key: "z", ctrlKey: true });
      fireEvent.keyDown(rawAgain, { key: "z", ctrlKey: true });
      fireEvent.click(screen.getByRole("button", { name: "Toggle Mode" }));
    });

    expect(
      await screen.findByRole("button", { name: "artist:oda_eiichirou" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "artist:oda_eiichirou:" }),
    ).not.toBeInTheDocument();
  });
});
