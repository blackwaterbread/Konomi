import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { SettingsView } from "@/components/settings-view";
import { DEFAULTS, type Settings } from "@/hooks/useSettings";
import { preloadMocks } from "../helpers/preload-mocks";

function createSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULTS,
    language: "en",
    ...overrides,
  };
}

function renderSettingsView(
  overrides: Partial<React.ComponentProps<typeof SettingsView>> = {},
) {
  const props: React.ComponentProps<typeof SettingsView> = {
    settings: createSettings(),
    onUpdate: vi.fn(),
    onReset: vi.fn(),
    onClose: vi.fn(),
    onResetHashes: vi.fn().mockResolvedValue(undefined),
    onRefreshPrompts: vi.fn().mockResolvedValue(0),
    isAnalyzing: false,
    ...overrides,
  };

  return {
    ...render(<SettingsView {...props} />),
    props,
  };
}

describe("SettingsView", () => {
  it("loads ignored duplicates and database metadata on mount", async () => {
    preloadMocks.image.listIgnoredDuplicates.mockResolvedValueOnce([
      "C:\\dupe-a.png",
      "C:\\dupe-b.png",
    ]);
    preloadMocks.appInfo.getDbFileSize.mockResolvedValueOnce(2048);
    preloadMocks.appInfo.getPromptsDbSchemaVersion.mockResolvedValueOnce(4);

    renderSettingsView();

    expect(await screen.findByText("C:\\dupe-a.png")).toBeInTheDocument();
    expect(screen.getByText("C:\\dupe-b.png")).toBeInTheDocument();
    expect(screen.getByText("2 total")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("2.0 KB")).toBeInTheDocument());

    const schemaRow = screen.getByText("Tag database version").closest("div");
    expect(schemaRow).not.toBeNull();
    expect(within(schemaRow!).getByText("4")).toBeInTheDocument();
  });

  it("clears ignored duplicates and reloads the list", async () => {
    const user = userEvent.setup();

    preloadMocks.image.listIgnoredDuplicates
      .mockResolvedValueOnce(["C:\\dupe-a.png"])
      .mockResolvedValueOnce([]);

    renderSettingsView();

    expect(await screen.findByText("C:\\dupe-a.png")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear List" }));

    await waitFor(() =>
      expect(preloadMocks.image.clearIgnoredDuplicates).toHaveBeenCalledTimes(
        1,
      ),
    );
    await waitFor(() =>
      expect(screen.getByText("0 total")).toBeInTheDocument(),
    );

    expect(screen.queryByText("C:\\dupe-a.png")).not.toBeInTheDocument();
    expect(preloadMocks.image.listIgnoredDuplicates).toHaveBeenCalledTimes(2);
  });

  it("calls onRefreshPrompts and shows success toast on click", async () => {
    const user = userEvent.setup();
    const onRefreshPrompts = vi.fn().mockResolvedValue(3);

    renderSettingsView({ onRefreshPrompts });

    const section = screen.getByText("Refresh Prompt Info").closest("div")!;
    const button = within(section).getByRole("button", { name: "Refresh" });
    await user.click(button);

    await waitFor(() =>
      expect(onRefreshPrompts).toHaveBeenCalledTimes(1),
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Updated prompt info for 3 images.",
    );
  });

  it("shows info toast when no images need refreshing", async () => {
    const user = userEvent.setup();
    const onRefreshPrompts = vi.fn().mockResolvedValue(0);

    renderSettingsView({ onRefreshPrompts });

    const section = screen.getByText("Refresh Prompt Info").closest("div")!;
    await user.click(
      within(section).getByRole("button", { name: "Refresh" }),
    );

    await waitFor(() =>
      expect(onRefreshPrompts).toHaveBeenCalledTimes(1),
    );
    expect(toast.info).toHaveBeenCalledWith("No images to refresh.");
  });

  it("bootstraps advanced similarity thresholds from the basic threshold", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    renderSettingsView({
      settings: createSettings({
        similarityThreshold: 16,
        useAdvancedSimilarityThresholds: false,
        visualSimilarityThreshold: DEFAULTS.visualSimilarityThreshold,
        promptSimilarityThreshold: DEFAULTS.promptSimilarityThreshold,
      }),
      onUpdate,
    });

    await user.click(screen.getByRole("radio", { name: /Advanced Mode/i }));

    expect(onUpdate).toHaveBeenCalledWith({
      useAdvancedSimilarityThresholds: true,
      visualSimilarityThreshold: 16,
      promptSimilarityThreshold: 0.54,
    });
  });
});
