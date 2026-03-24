import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TokenChip } from "@/components/token-chip";
import { preloadMocks } from "../helpers/preload-mocks";

vi.mock("@/components/prompt-tag-suggestion-indicator", () => ({
  PromptTagSuggestionIndicator: () => <span data-testid="tag-indicator" />,
}));

describe("TokenChip", () => {
  it("can show a syntax warning from an external prompt-level override", () => {
    const { container } = render(
      <TokenChip
        token={{
          text: "artist:oda_eiichirou",
          weight: 0.75,
          raw: "0.75::artist:oda_eiichirou::",
        }}
        raw="0.75::artist:oda_eiichirou::"
        syntaxIssueKind="invalidExplicitWeight"
      />,
    );

    const chip = screen.getByRole("button", {
      name: /artist:oda_eiichirou.*x0\.75/i,
    });
    const warning = container.querySelector("[data-token-syntax-warning]");

    expect(chip).toHaveAttribute("title", "Invalid explicit emphasis syntax");
    expect(chip).toHaveClass("bg-destructive/16");
    expect(warning).toBeInTheDocument();
  });

  it("shows a warning affordance for malformed explicit emphasis syntax", () => {
    const { container } = render(
      <TokenChip
        token={{
          text: "1.2::oda_eiichirou",
          weight: 1,
          raw: "1.2::oda_eiichirou",
        }}
        raw="1.2::oda_eiichirou"
      />,
    );

    const chip = screen.getByRole("button", { name: "1.2::oda_eiichirou" });
    const warning = container.querySelector("[data-token-syntax-warning]");

    expect(chip).toHaveAttribute("title", "Invalid explicit emphasis syntax");
    expect(chip).toHaveClass("bg-destructive/16");
    expect(warning).toBeInTheDocument();
  });

  it("shows a warning affordance for malformed bracket emphasis syntax", () => {
    const { container } = render(
      <TokenChip
        token={{ text: "{oda_eiichirou", weight: 1, raw: "{oda_eiichirou" }}
        raw="{oda_eiichirou"
      />,
    );

    const chip = screen.getByRole("button", { name: "{oda_eiichirou" });
    const warning = container.querySelector("[data-token-syntax-warning]");

    expect(chip).toHaveAttribute("title", "Invalid bracket emphasis syntax");
    expect(chip).toHaveClass("bg-destructive/16");
    expect(warning).toBeInTheDocument();
  });

  it("keeps the popover open when a suggested tag is chosen with the mouse", async () => {
    const onChange = vi.fn();

    preloadMocks.promptBuilder.suggestTags.mockResolvedValueOnce({
      suggestions: [{ tag: "sunset", count: 12 }],
      stats: { totalTags: 10, maxCount: 12, bucketThresholds: [3, 6, 9] },
    });

    render(
      <TokenChip
        token={{ text: "su", weight: 1, raw: "su" }}
        raw="su"
        isEditable={true}
        onChange={onChange}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "su" }));

    const input = await screen.findByPlaceholderText("tag");
    fireEvent.change(input, { target: { value: "sun" } });

    await waitFor(() =>
      expect(preloadMocks.promptBuilder.suggestTags).toHaveBeenCalledWith({
        prefix: "sun",
        limit: 8,
        exclude: [],
      }),
    );

    fireEvent.mouseDown(await screen.findByRole("button", { name: /sunset/i }));

    await waitFor(() =>
      expect(screen.getByPlaceholderText("tag")).toHaveValue("sunset"),
    );
    expect(screen.getByText("Apply")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
