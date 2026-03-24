import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
    editorOpen,
    onEditorOpenChange,
    onApplyAdvance,
  }: {
    token: { text: string };
    chipRef?: (node: HTMLButtonElement | null) => void;
    onTokenFocus?: () => void;
    onTokenKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
    editorOpen?: boolean;
    onEditorOpenChange?: (
      open: boolean,
      reason?: "cancel" | "apply" | "advance",
    ) => void;
    onApplyAdvance?: () => void;
  }) => (
    <>
      <button
        ref={chipRef}
        type="button"
        onFocus={onTokenFocus}
        onKeyDown={onTokenKeyDown}
        onDoubleClick={() => onEditorOpenChange?.(true)}
      >
        {token.text}
      </button>
      {editorOpen ? (
        <button
          type="button"
          onClick={() => {
            onApplyAdvance?.();
            onEditorOpenChange?.(false, "advance");
          }}
        >
          Advance {token.text}
        </button>
      ) : null}
    </>
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
        tokens: [{ id: 10, label: "sunset", order: 0, groupId: 1 }],
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

  it("matches group autocomplete by tags after typing @{", async () => {
    const groups: PromptGroup[] = [
      {
        id: 1,
        name: "landscape",
        categoryId: 1,
        order: 0,
        tokens: [{ id: 10, label: "sunset beach", order: 0, groupId: 1 }],
      },
    ];

    renderPromptInput({ groups });

    const input = screen.getByLabelText("tag, tag, tag...");

    fireEvent.change(input, { target: { value: "@{sun" } });

    expect(await screen.findByText("{landscape}")).toBeInTheDocument();
    expect(screen.getByText("sunset beach")).toBeInTheDocument();
  });

  it("routes group-chip typing back to the trailing input in block mode", async () => {
    const onChange = vi.fn();

    renderPromptInput({
      value: "first, @{landscape}, third",
      onChange,
    });

    const groupChip = screen.getByRole("button", { name: "@{landscape}" });

    fireEvent.focus(groupChip);
    fireEvent.keyDown(groupChip, { key: "s" });

    const input = screen.getByLabelText("tag, tag, tag...");
    fireEvent.change(input, { target: { value: "second" } });

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        "first, @{landscape}, third, second",
      ),
    );
  });

  it("returns to the trailing input when navigating left from the first chip in block mode", async () => {
    const onChange = vi.fn();

    renderPromptInput({
      value: "first, second",
      onChange,
    });

    const firstToken = screen.getByRole("button", { name: "first" });

    fireEvent.focus(firstToken);
    fireEvent.keyDown(firstToken, { key: "ArrowLeft" });

    const input = screen.getByLabelText("tag, tag, tag...");
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, { target: { value: "zero" } });

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith("first, second, zero"),
    );
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

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("sunset"));
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

  it("keeps the PromptInput focus target after a token popover closes with advance", async () => {
    renderPromptInput({ value: "sunset" });

    const token = screen.getByRole("button", { name: "sunset" });

    fireEvent.doubleClick(token);
    fireEvent.click(
      await screen.findByRole("button", { name: "Advance sunset" }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText("tag, tag, tag...")).toHaveFocus(),
    );
    expect(screen.getByRole("button", { name: "sunset" })).not.toHaveFocus();
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

  it("shows group autocomplete in raw mode and inserts the selected group token", async () => {
    const groups: PromptGroup[] = [
      {
        id: 1,
        name: "landscape",
        categoryId: 1,
        order: 0,
        tokens: [{ id: 10, label: "sunset beach", order: 0, groupId: 1 }],
      },
    ];

    renderPromptInput({
      value: "",
      displayMode: "raw",
      groups,
    });

    const textarea = screen.getByRole("textbox", {
      name: "tag, tag, tag...",
    }) as HTMLTextAreaElement;

    fireEvent.focus(textarea);
    fireEvent.change(textarea, {
      target: {
        value: "@{sun",
        selectionStart: 5,
        selectionEnd: 5,
      },
    });

    expect(await screen.findByText("{landscape}")).toBeInTheDocument();
    expect(screen.getByText("sunset beach")).toBeInTheDocument();

    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => expect(textarea).toHaveValue("@{landscape}"));
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

  it("does not crash when the raw-text editor scrolls", () => {
    renderPromptInput({
      value: "sparkles,\nsunset,\nstars,\nclouds,\nmoonlight",
      displayMode: "raw",
    });

    const textarea = screen.getByRole("textbox", {
      name: "tag, tag, tag...",
    }) as HTMLTextAreaElement;

    Object.defineProperty(textarea, "scrollTop", {
      configurable: true,
      value: 24,
    });
    Object.defineProperty(textarea, "scrollLeft", {
      configurable: true,
      value: 8,
    });

    expect(() => fireEvent.scroll(textarea)).not.toThrow();
  });

  it("reserves the textarea scrollbar gutter in the raw highlight overlay", async () => {
    const offsetWidthDescriptor = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "offsetWidth",
    );
    const clientWidthDescriptor = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "clientWidth",
    );

    Object.defineProperty(HTMLTextAreaElement.prototype, "offsetWidth", {
      configurable: true,
      get: () => 220,
    });
    Object.defineProperty(HTMLTextAreaElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 204,
    });

    try {
      const { container } = renderPromptInput({
        value: "fake animal ears, closed mouth, @{nami}",
        displayMode: "raw",
      });

      const overlay = container.querySelector(
        "[data-prompt-raw-overlay-content]",
      ) as HTMLDivElement | null;

      expect(overlay).not.toBeNull();
      await waitFor(() =>
        expect(overlay?.style.paddingRight).toContain("16px"),
      );
    } finally {
      if (offsetWidthDescriptor) {
        Object.defineProperty(
          HTMLTextAreaElement.prototype,
          "offsetWidth",
          offsetWidthDescriptor,
        );
      } else {
        delete (HTMLTextAreaElement.prototype as { offsetWidth?: number })
          .offsetWidth;
      }

      if (clientWidthDescriptor) {
        Object.defineProperty(
          HTMLTextAreaElement.prototype,
          "clientWidth",
          clientWidthDescriptor,
        );
      } else {
        delete (HTMLTextAreaElement.prototype as { clientWidth?: number })
          .clientWidth;
      }
    }
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

  it("renders group tokens with group-themed raw-mode highlights", () => {
    const { container } = renderPromptInput({
      value: "masterpiece, @{landscape:sunset|ocean mist}",
      displayMode: "raw",
    });

    const highlights = Array.from(
      container.querySelectorAll("[data-prompt-raw-highlight]"),
    );

    expect(highlights).toHaveLength(1);
    expect(highlights[0]).toHaveTextContent("@{landscape:sunset|ocean mist}");
    expect(highlights[0]).toHaveClass("bg-group/45");
  });

  it("renders mixed raw-mode group and emphasis highlights in source order", () => {
    const { container } = renderPromptInput({
      value:
        "@{nami}, 1.4::sparkles::, [soft light], {dramatic angle}, @{landscape:sunset|ocean mist}",
      displayMode: "raw",
    });

    const highlights = Array.from(
      container.querySelectorAll("[data-prompt-raw-highlight]"),
    );

    expect(highlights.map((highlight) => highlight.textContent)).toEqual([
      "@{nami}",
      "1.4::sparkles::",
      "[soft light]",
      "{dramatic angle}",
      "@{landscape:sunset|ocean mist}",
    ]);
    expect(highlights[0]).toHaveClass("bg-group/45");
    expect(highlights[1]).toHaveClass("bg-warning/45");
    expect(highlights[2]).toHaveClass("bg-group/38");
    expect(highlights[3]).toHaveClass("bg-primary/40");
    expect(highlights[4]).toHaveClass("bg-group/45");
  });

  it("renders destructive and info raw-mode tones for negative and low explicit weights", () => {
    const { container } = renderPromptInput({
      value: "-0.5::broken anatomy::, 0.6::washed out::",
      displayMode: "raw",
    });

    const highlights = Array.from(
      container.querySelectorAll("[data-prompt-raw-highlight]"),
    );

    expect(highlights).toHaveLength(2);
    expect(highlights[0]).toHaveTextContent("-0.5::broken anatomy::");
    expect(highlights[0]).toHaveClass("bg-destructive/40");
    expect(highlights[1]).toHaveTextContent("0.6::washed out::");
    expect(highlights[1]).toHaveClass("bg-info/40");
  });

  it("does not highlight incomplete raw-mode group references", () => {
    const { container } = renderPromptInput({
      value: "masterpiece, @{na",
      displayMode: "raw",
    });

    expect(
      container.querySelectorAll("[data-prompt-raw-highlight]"),
    ).toHaveLength(0);
    expect(
      container.querySelectorAll("[data-prompt-raw-syntax-error]"),
    ).toHaveLength(0);
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

  it("prioritizes raw-mode syntax errors over overlapping group highlights", () => {
    const { container } = renderPromptInput({
      value: "1.2::sparkles @{nami}, plain, @{landscape}",
      displayMode: "raw",
    });

    const errors = Array.from(
      container.querySelectorAll("[data-prompt-raw-syntax-error]"),
    );
    const highlights = Array.from(
      container.querySelectorAll("[data-prompt-raw-highlight]"),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toHaveTextContent(
      "1.2::sparkles @{nami}, plain, @{landscape}",
    );
    expect(highlights).toHaveLength(0);
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

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("prompt!"));
    await waitFor(() => expect(textarea).toHaveValue("prompt!"));

    fireEvent.keyDown(textarea, { key: "z", ctrlKey: true });

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("prompt"));
    await waitFor(() => expect(textarea).toHaveValue("prompt"));

    fireEvent.keyDown(textarea, { key: "z", ctrlKey: true, shiftKey: true });

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("prompt!"));
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

  // ── Chip mode: input manipulation ───────────────────────────────────────

  it("removes a chip when Backspace is pressed while the chip is focused", async () => {
    const onChange = vi.fn();

    renderPromptInput({ value: "sparkles, sunset", onChange });

    const lastChip = screen.getByRole("button", { name: "sunset" });
    fireEvent.focus(lastChip);
    fireEvent.keyDown(lastChip, { key: "Backspace" });

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("sparkles"));
    expect(
      screen.queryByRole("button", { name: "sunset" }),
    ).not.toBeInTheDocument();
  });

  it("does not remove a chip when Backspace is pressed with a non-empty draft", async () => {
    const onChange = vi.fn();

    renderPromptInput({ value: "sparkles, sunset", onChange });

    const input = screen.getByLabelText("tag, tag, tag...");

    fireEvent.change(input, { target: { value: "s" } });
    fireEvent.keyDown(input, { key: "Backspace" });

    expect(onChange).not.toHaveBeenCalledWith("sparkles");
    expect(screen.getByRole("button", { name: "sunset" })).toBeInTheDocument();
  });

  it("tokenizes pasted comma-separated text into chips", async () => {
    const onChange = vi.fn();

    renderPromptInput({ onChange });

    const input = screen.getByLabelText("tag, tag, tag...");
    input.focus();

    fireEvent.paste(input, {
      clipboardData: {
        getData: () => "rose petals, glowing eyes, soft light",
      },
    });

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        "rose petals, glowing eyes, soft light",
      ),
    );
    expect(
      screen.getByRole("button", { name: "rose petals" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "glowing eyes" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "soft light" }),
    ).toBeInTheDocument();
  });

  it("renders a wildcard chip for %{opt1|opt2} values", () => {
    renderPromptInput({ value: "sparkles, %{beach|forest}, stars" });

    expect(
      screen.getByRole("button", { name: "%{beach|forest}" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "sparkles" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "stars" })).toBeInTheDocument();
  });

  it("excludes already-present tokens from tag suggestions", async () => {
    preloadMocks.promptBuilder.suggestTags.mockResolvedValueOnce({
      suggestions: [{ tag: "sunset", count: 5 }],
      stats: { totalTags: 5, maxCount: 5, bucketThresholds: [] },
    });

    renderPromptInput({ value: "sparkles, forest" });

    const input = screen.getByLabelText("tag, tag, tag...");
    fireEvent.change(input, { target: { value: "sun" } });

    await waitFor(() =>
      expect(preloadMocks.promptBuilder.suggestTags).toHaveBeenCalledWith(
        expect.objectContaining({
          exclude: expect.arrayContaining(["sparkles", "forest"]),
        }),
      ),
    );
  });

  // ── Tag suggestion keyboard navigation ───────────────────────────────────

  it("dismisses tag suggestions when Escape is pressed", async () => {
    preloadMocks.promptBuilder.suggestTags.mockResolvedValueOnce({
      suggestions: [{ tag: "sunset", count: 5 }],
      stats: { totalTags: 5, maxCount: 5, bucketThresholds: [] },
    });

    renderPromptInput();

    const input = screen.getByLabelText("tag, tag, tag...");
    fireEvent.change(input, { target: { value: "sun" } });

    await screen.findByText("sunset");

    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByText("sunset")).not.toBeInTheDocument(),
    );
  });

  it("cycles through multiple suggestions with ArrowDown and applies with Enter", async () => {
    preloadMocks.promptBuilder.suggestTags.mockResolvedValueOnce({
      suggestions: [
        { tag: "sunset", count: 10 },
        { tag: "sunflower", count: 7 },
        { tag: "sunbeam", count: 3 },
      ],
      stats: { totalTags: 10, maxCount: 10, bucketThresholds: [] },
    });

    renderPromptInput();

    const input = screen.getByLabelText("tag, tag, tag...");
    fireEvent.change(input, { target: { value: "sun" } });

    await screen.findByText("sunset");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(
      screen.getByRole("button", { name: "sunflower" }),
    ).toBeInTheDocument();
  });

  it("selects the third suggestion when ArrowDown is pressed three times", async () => {
    preloadMocks.promptBuilder.suggestTags.mockResolvedValueOnce({
      suggestions: [
        { tag: "sunset", count: 10 },
        { tag: "sunflower", count: 7 },
        { tag: "sunbeam", count: 3 },
      ],
      stats: { totalTags: 10, maxCount: 10, bucketThresholds: [] },
    });

    renderPromptInput();

    const input = screen.getByLabelText("tag, tag, tag...");
    fireEvent.change(input, { target: { value: "sun" } });

    await screen.findByText("sunset");

    fireEvent.keyDown(input, { key: "ArrowDown" }); // sunset
    fireEvent.keyDown(input, { key: "ArrowDown" }); // sunflower
    fireEvent.keyDown(input, { key: "ArrowDown" }); // sunbeam
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByRole("button", { name: "sunbeam" })).toBeInTheDocument();
  });

  // ── Raw mode: context menu ───────────────────────────────────────────────

  it("deletes selected text through the raw-text context menu Delete action", async () => {
    const onChange = vi.fn();

    renderPromptInput({
      value: "sparkles, sunset",
      onChange,
      displayMode: "raw",
    });

    const textarea = screen.getByRole("textbox", {
      name: "tag, tag, tag...",
    }) as HTMLTextAreaElement;

    textarea.focus();
    textarea.setSelectionRange(0, 9); // "sparkles,"

    fireEvent.contextMenu(textarea);
    fireEvent.click(await screen.findByText("Delete"));

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(" sunset"));
  });

  it("shows 'Select all' in the raw-text context menu", async () => {
    renderPromptInput({
      value: "sparkles, sunset",
      displayMode: "raw",
    });

    const textarea = screen.getByRole("textbox", { name: "tag, tag, tag..." });

    fireEvent.contextMenu(textarea);

    expect(await screen.findByText("Select all")).toBeInTheDocument();
  });

  // ── Raw mode: group autocomplete keyboard ────────────────────────────────

  it("dismisses group autocomplete in raw mode when Escape is pressed", async () => {
    const groups = [
      {
        id: 1,
        name: "landscape",
        categoryId: 1,
        order: 0,
        tokens: [{ id: 10, label: "sunset", order: 0, groupId: 1 }],
      },
    ];

    renderPromptInput({ displayMode: "raw", groups });

    const textarea = screen.getByRole("textbox", {
      name: "tag, tag, tag...",
    }) as HTMLTextAreaElement;

    fireEvent.focus(textarea);
    fireEvent.change(textarea, {
      target: { value: "@{land", selectionStart: 6, selectionEnd: 6 },
    });

    await screen.findByText("{landscape}");

    fireEvent.keyDown(textarea, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByText("{landscape}")).not.toBeInTheDocument(),
    );
  });

  it("navigates group autocomplete in raw mode with ArrowDown/Up and inserts on Enter", async () => {
    const groups = [
      {
        id: 1,
        name: "landscape",
        categoryId: 1,
        order: 0,
        tokens: [{ id: 10, label: "sunset", order: 0, groupId: 1 }],
      },
      {
        id: 2,
        name: "lighting",
        categoryId: 1,
        order: 1,
        tokens: [{ id: 11, label: "dramatic light", order: 0, groupId: 2 }],
      },
    ];

    renderPromptInput({ displayMode: "raw", groups });

    const textarea = screen.getByRole("textbox", {
      name: "tag, tag, tag...",
    }) as HTMLTextAreaElement;

    fireEvent.focus(textarea);
    fireEvent.change(textarea, {
      target: { value: "@{l", selectionStart: 3, selectionEnd: 3 },
    });

    await screen.findByText("{landscape}");

    // ArrowDown to first item → Enter inserts it
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => expect(textarea).toHaveValue("@{lighting}"));
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
        target: {
          value: "0.75::artist:oda_eiichirou:,",
          selectionStart: 27,
          selectionEnd: 27,
        },
      });
      fireEvent.keyDown(textarea, { key: "Backspace" });
      fireEvent.change(textarea, {
        target: {
          value: "0.75::artist:oda_eiichirou,",
          selectionStart: 26,
          selectionEnd: 26,
        },
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
