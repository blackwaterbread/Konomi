import React, { type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { GenerationView } from "@/components/generation-view";
import { preloadMocks } from "../helpers/preload-mocks";
import { createGalleryImage } from "../helpers/gallery-image";

function renderGenerationView(
  overrides: Partial<ComponentProps<typeof GenerationView>> = {},
) {
  preloadMocks.nai.getConfig.mockResolvedValue({ id: 1, apiKey: "token" });

  const props: ComponentProps<typeof GenerationView> = {
    outputFolder: "C:/output",
    onOutputFolderChange: vi.fn(),
    isDarkTheme: true,
    ...overrides,
  };

  return {
    ...render(<GenerationView {...props} />),
    props,
  };
}

function getAutoGenToggleButton(): HTMLButtonElement {
  const summaryRow = screen.getByText("Count").closest("div")?.parentElement;
  const toggleButton = summaryRow?.querySelector("button");

  if (!(toggleButton instanceof HTMLButtonElement)) {
    throw new Error("Failed to find auto-generate toggle button");
  }

  return toggleButton;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("GenerationView", () => {
  it("opens the metadata import modal for a pending gallery image", async () => {
    const pendingImport = createGalleryImage({
      path: "C:\\imports\\source.png",
      src: "konomi://local/C%3A%2Fimports%2Fsource.png",
      prompt: "import me",
    });
    const onClearPendingImport = vi.fn();

    renderGenerationView({
      pendingImport,
      onClearPendingImport,
    });

    await waitFor(() =>
      expect(onClearPendingImport).toHaveBeenCalledTimes(1),
    );

    expect(screen.getByText("Image Actions")).toBeInTheDocument();
    expect(screen.getByText("source.png")).toBeInTheDocument();
    expect(screen.getByAltText("Preview")).toHaveAttribute(
      "src",
      pendingImport.src,
    );
    expect(
      screen.getByRole("button", { name: "Import Metadata" }),
    ).toBeEnabled();
  });

  it("shows a pending source image in the reference panel and clears the request", async () => {
    const pendingSourceImport = createGalleryImage({
      src: "konomi://local/C%3A%2Fgallery%2Freference.png",
      prompt: "reference prompt",
      tokens: [{ text: "reference prompt", weight: 1 }],
    });
    const onClearPendingSourceImport = vi.fn();

    renderGenerationView({
      pendingSourceImport,
      onClearPendingSourceImport,
    });

    await waitFor(() =>
      expect(onClearPendingSourceImport).toHaveBeenCalledTimes(1),
    );

    expect(await screen.findByAltText("Reference image")).toHaveAttribute(
      "src",
      pendingSourceImport.src,
    );
    expect(
      screen.getByText("Drag chips into the prompt input to add them."),
    ).toBeInTheDocument();
    expect(screen.getByText("reference prompt")).toBeInTheDocument();
  });

  it("appends requested prompt tags once and returns focus to prompt mode", async () => {
    const user = userEvent.setup();
    const { rerender, props } = renderGenerationView();

    await user.click(screen.getByRole("radio", { name: "Negative Prompt" }));
    expect(screen.getByRole("radio", { name: "Negative Prompt" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    rerender(
      <GenerationView
        {...props}
        appendPromptTagRequest={{ id: 1, tag: "sparkles" }}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Prompt" })).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
    await waitFor(() =>
      expect(screen.getAllByText("sparkles")).toHaveLength(1),
    );

    rerender(
      <GenerationView
        {...props}
        appendPromptTagRequest={{ id: 1, tag: "sparkles" }}
      />,
    );

    await waitFor(() =>
      expect(screen.getAllByText("sparkles")).toHaveLength(1),
    );
  });

  it("opens the settings panel with a configuration-required message when api key and output folder are missing", async () => {
    preloadMocks.nai.getConfig.mockResolvedValueOnce({ id: 1, apiKey: "" });

    renderGenerationView({
      outputFolder: "",
    });

    expect(await screen.findByText("Configuration required")).toBeInTheDocument();
    expect(
      screen.getByText("Please configure your API key and output folder first"),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("API Key")).toBeInTheDocument();
  });

  it("validates an api key, persists it, and reflects the logged-in state", async () => {
    const user = userEvent.setup();

    preloadMocks.nai.getConfig.mockResolvedValueOnce({ id: 1, apiKey: "" });
    preloadMocks.nai.validateApiKey.mockResolvedValueOnce({
      valid: true,
      tier: "Scroll",
    });
    preloadMocks.nai.updateConfig.mockResolvedValueOnce({
      id: 1,
      apiKey: "new-token",
    });

    renderGenerationView();

    const apiKeyInput = await screen.findByPlaceholderText("API Key");

    await user.type(apiKeyInput, "  new-token  ");
    await user.click(screen.getByRole("button", { name: "Log In" }));

    await waitFor(() =>
      expect(preloadMocks.nai.validateApiKey).toHaveBeenCalledWith("new-token"),
    );
    expect(preloadMocks.nai.updateConfig).toHaveBeenCalledWith({
      apiKey: "new-token",
    });
    expect(
      await screen.findByRole("button", { name: "Logged In" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();
  });

  it("submits the current prompt and generator defaults to the generate API", async () => {
    const user = userEvent.setup();

    preloadMocks.nai.generate.mockResolvedValueOnce("C:/output/generated.png");
    preloadMocks.image.readNaiMeta.mockResolvedValueOnce(null);

    renderGenerationView();

    const promptInput = screen.getByLabelText("1girl, beautiful, masterpiece, ...");

    fireEvent.change(promptInput, {
      target: { value: "sunset beach masterpiece" },
    });

    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() =>
      expect(preloadMocks.nai.generate).toHaveBeenCalledWith({
        prompt: "sunset beach masterpiece",
        negativePrompt: "",
        outputFolder: "C:/output",
        model: "nai-diffusion-4-5-full",
        width: 832,
        height: 1216,
        steps: 28,
        scale: 5,
        cfgRescale: 0,
        varietyPlus: false,
        sampler: "k_euler_ancestral",
        noiseSchedule: "karras",
        seed: undefined,
      }),
    );
  });

  it("requires confirmation before generating the same configuration twice", async () => {
    const user = userEvent.setup();

    preloadMocks.nai.generate.mockResolvedValue("C:/output/generated.png");
    preloadMocks.image.readNaiMeta.mockResolvedValue(null);

    renderGenerationView();

    const promptInput = screen.getByLabelText(
      "1girl, beautiful, masterpiece, ...",
    );

    fireEvent.change(promptInput, {
      target: { value: "duplicate me" },
    });

    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() =>
      expect(preloadMocks.nai.generate).toHaveBeenCalledTimes(1),
    );

    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect(
      await screen.findByText("This configuration was already generated"),
    ).toBeInTheDocument();
    expect(preloadMocks.nai.generate).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Generate anyway" }));

    await waitFor(() =>
      expect(preloadMocks.nai.generate).toHaveBeenCalledTimes(2),
    );
  });

  it("keeps auto-generate locked until the warning is acknowledged", async () => {
    const user = userEvent.setup();

    renderGenerationView();

    fireEvent.change(
      screen.getByLabelText("1girl, beautiful, masterpiece, ..."),
      {
        target: { value: "auto generate prompt" },
      },
    );

    const lockedAutoGenerateButton = screen.getByTitle(
      "You must acknowledge the auto-generate warning before using it",
    );
    expect(lockedAutoGenerateButton).toBeDisabled();

    await user.click(getAutoGenToggleButton());
    await user.click(
      screen.getByRole("button", { name: "View auto-generate warning" }),
    );

    expect(screen.getByText("I understand")).toBeInTheDocument();

    await user.click(screen.getByText("I understand"));

    const readyAutoGenerateButton = screen.getByTitle("Auto Generate");
    expect(readyAutoGenerateButton).toBeEnabled();
    expect(localStorage.getItem("konomi-auto-gen-policy-agreed")).toBe("true");
  });

  it("warns on invalid seed input and falls back to a random seed for generation", async () => {
    const user = userEvent.setup();
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.25);

    preloadMocks.nai.generate.mockResolvedValueOnce("C:/output/generated.png");
    preloadMocks.image.readNaiMeta.mockResolvedValueOnce(null);

    renderGenerationView();

    fireEvent.change(
      screen.getByLabelText("1girl, beautiful, masterpiece, ..."),
      {
        target: { value: "seed fallback prompt" },
      },
    );

    const seedInput = screen.getByPlaceholderText("-");
    fireEvent.focus(seedInput);
    fireEvent.change(seedInput, {
      target: { value: "999999999999" },
    });
    fireEvent.blur(seedInput);

    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        "Seed must be an integer between 0 and 4294967295, so it was switched to random.",
      ),
    );
    expect(preloadMocks.nai.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "seed fallback prompt",
        seed: 1073741824,
      }),
    );
    expect(screen.getByPlaceholderText("-")).toHaveValue("");

    randomSpy.mockRestore();
  });

  it("clears the active reference image from the reference panel", async () => {
    const user = userEvent.setup();
    const pendingSourceImport = createGalleryImage({
      src: "konomi://local/C%3A%2Fgallery%2Freference-clear.png",
      path: "C:\\gallery\\reference-clear.png",
      prompt: "reference clear prompt",
      tokens: [{ text: "reference clear prompt", weight: 1 }],
    });

    renderGenerationView({
      pendingSourceImport,
      onClearPendingSourceImport: vi.fn(),
    });

    expect(await screen.findByAltText("Reference image")).toHaveAttribute(
      "src",
      pendingSourceImport.src,
    );

    await user.click(screen.getByTitle("Remove reference image"));

    await waitFor(() =>
      expect(screen.queryByAltText("Reference image")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText(
        "Right-click an image in the gallery and send it as a reference image",
      ),
    ).toBeInTheDocument();
  });

  it("creates an image2image reference from a drop-import action", async () => {
    const user = userEvent.setup();
    const pendingImport = createGalleryImage({
      path: "C:\\imports\\i2i-source.png",
      src: "konomi://local/C%3A%2Fimports%2Fi2i-source.png",
    });

    preloadMocks.image.readFile.mockResolvedValueOnce(
      new Uint8Array([1, 2, 3]).buffer,
    );

    renderGenerationView({
      pendingImport,
      onClearPendingImport: vi.fn(),
    });

    expect(await screen.findByText("Image Actions")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Image2Image" }));

    await waitFor(() =>
      expect(screen.queryByText("Image Actions")).not.toBeInTheDocument(),
    );
    expect(preloadMocks.image.readFile).toHaveBeenCalledWith(
      "C:\\imports\\i2i-source.png",
    );
    expect(screen.getByText("Image2Image")).toBeInTheDocument();
    expect(screen.getByText("Strength")).toBeInTheDocument();
    expect(screen.getByText("Noise")).toBeInTheDocument();
  });

  it("creates a precise reference from a drop-import action", async () => {
    const user = userEvent.setup();
    const pendingImport = createGalleryImage({
      path: "C:\\imports\\precise-source.png",
      src: "konomi://local/C%3A%2Fimports%2Fprecise-source.png",
    });

    preloadMocks.image.readFile.mockResolvedValueOnce(
      new Uint8Array([4, 5, 6]).buffer,
    );

    renderGenerationView({
      pendingImport,
      onClearPendingImport: vi.fn(),
    });

    expect(await screen.findByText("Image Actions")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Precise Ref" }));

    await waitFor(() =>
      expect(screen.queryByText("Image Actions")).not.toBeInTheDocument(),
    );
    expect(preloadMocks.image.readFile).toHaveBeenCalledWith(
      "C:\\imports\\precise-source.png",
    );
    expect(screen.getByText("Precise Reference")).toBeInTheDocument();
    expect(screen.getByText("Fidelity")).toBeInTheDocument();
  });

  it("reuses the same fixed seed across auto-generate loop iterations", async () => {
    vi.useFakeTimers();

    localStorage.setItem("konomi-auto-gen-policy-agreed", "true");
    preloadMocks.nai.generate
      .mockResolvedValueOnce("C:/output/generated-1.png")
      .mockResolvedValueOnce("C:/output/generated-2.png");
    preloadMocks.image.readNaiMeta.mockResolvedValue(null);

    try {
      renderGenerationView();

      await act(async () => {
        await flushMicrotasks();
      });

      fireEvent.change(
        screen.getByLabelText("1girl, beautiful, masterpiece, ..."),
        {
          target: { value: "fixed seed loop" },
        },
      );

      fireEvent.click(getAutoGenToggleButton());

      const [countSlider] = screen.getAllByRole("slider");
      fireEvent.change(countSlider, { target: { value: "2" } });
      fireEvent.pointerUp(countSlider);

      fireEvent.click(screen.getByRole("button", { name: "Fixed" }));

      const seedInput = screen.getByPlaceholderText("-");
      fireEvent.focus(seedInput);
      fireEvent.change(seedInput, { target: { value: "12345" } });
      fireEvent.blur(seedInput);

      fireEvent.click(screen.getByTitle("Auto Generate"));

      await act(async () => {
        await flushMicrotasks();
      });

      expect(preloadMocks.nai.generate).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          prompt: "fixed seed loop",
          seed: 12345,
        }),
      );

      await act(async () => {
        vi.advanceTimersByTime(3000);
        await flushMicrotasks();
      });

      expect(preloadMocks.nai.generate).toHaveBeenCalledTimes(2);
      expect(preloadMocks.nai.generate).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          prompt: "fixed seed loop",
          seed: 12345,
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
