import React, { createRef, type ComponentPropsWithoutRef } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import {
  GenerationView,
  type GenerationViewHandle,
} from "@/components/generation-view";
import { preloadEvents, preloadMocks } from "../helpers/preload-mocks";
import { createGalleryImage } from "../helpers/gallery-image";

function renderGenerationView(
  overrides: Partial<ComponentPropsWithoutRef<typeof GenerationView>> = {},
) {
  preloadMocks.nai.getConfig.mockResolvedValue({ id: 1, apiKey: "token" });
  const ref = createRef<GenerationViewHandle>();

  const props: ComponentPropsWithoutRef<typeof GenerationView> = {
    outputFolder: "C:/output",
    onOutputFolderChange: vi.fn(),
    isDarkTheme: true,
    ...overrides,
  };

  return {
    ...render(<GenerationView ref={ref} {...props} />),
    props,
    ref,
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

function getAdvancedParamsToggleButton(): HTMLButtonElement {
  const toggleButton = Array.from(document.querySelectorAll("button")).find(
    (button) => button.querySelector("svg.lucide-chevron-up"),
  );

  if (!(toggleButton instanceof HTMLButtonElement)) {
    throw new Error("Failed to find advanced params toggle button");
  }

  return toggleButton;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("GenerationView", () => {
  it("opens the metadata import modal when importing a gallery image", async () => {
    const pendingImport = createGalleryImage({
      path: "C:\\imports\\source.png",
      src: "konomi://local/C%3A%2Fimports%2Fsource.png",
      prompt: "import me",
    });

    const { ref } = renderGenerationView();

    act(() => {
      ref.current?.importImage(pendingImport);
    });

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

  it("refreshes imported seed and numeric displays on repeated metadata imports", async () => {
    const user = userEvent.setup();
    const firstImport = createGalleryImage({
      id: "image-meta-1",
      path: "C:\\imports\\meta-1.png",
      src: "konomi://local/C%3A%2Fimports%2Fmeta-1.png",
    });
    const secondImport = createGalleryImage({
      id: "image-meta-2",
      path: "C:\\imports\\meta-2.png",
      src: "konomi://local/C%3A%2Fimports%2Fmeta-2.png",
    });

    localStorage.setItem(
      "konomi-import-checks",
      JSON.stringify({
        prompt: true,
        negativePrompt: true,
        characters: false,
        charactersAppend: false,
        settings: true,
        seed: true,
      }),
    );

    preloadMocks.image.readNaiMeta
      .mockResolvedValueOnce({
        source: "nai",
        prompt: "first metadata prompt",
        negativePrompt: "",
        characterPrompts: [],
        characterNegativePrompts: [],
        characterPositions: [],
        seed: 111,
        model: "nai-diffusion-4-5-full",
        sampler: "k_euler_ancestral",
        steps: 24,
        cfgScale: 6,
        cfgRescale: 0.2,
        noiseSchedule: "karras",
        varietyPlus: false,
        width: 640,
        height: 960,
        raw: {},
      })
      .mockResolvedValueOnce({
        source: "nai",
        prompt: "second metadata prompt",
        negativePrompt: "",
        characterPrompts: [],
        characterNegativePrompts: [],
        characterPositions: [],
        seed: 222,
        model: "nai-diffusion-4-5-full",
        sampler: "k_euler_ancestral",
        steps: 30,
        cfgScale: 7,
        cfgRescale: 0.35,
        noiseSchedule: "native",
        varietyPlus: true,
        width: 768,
        height: 1024,
        raw: {},
      });

    const { ref } = renderGenerationView();

    act(() => {
      ref.current?.importImage(firstImport);
    });

    await user.click(
      await screen.findByRole("button", { name: "Import Metadata" }),
    );

    await waitFor(() =>
      expect(screen.queryByText("Image Actions")).not.toBeInTheDocument(),
    );

    const seedSummary = screen.getByPlaceholderText("-");
    const stepsSummary = screen.getByDisplayValue("24");
    const widthInput = screen.getByDisplayValue("640");

    expect(seedSummary).toHaveValue("111");
    expect(stepsSummary).toHaveValue(24);
    expect(widthInput).toHaveValue(640);

    fireEvent.mouseDown(seedSummary);
    fireEvent.change(stepsSummary, { target: { value: "999" } });
    fireEvent.change(widthInput, { target: { value: "1234" } });

    expect(seedSummary).toHaveValue("");
    expect(stepsSummary).toHaveValue(999);
    expect(widthInput).toHaveValue(1234);

    act(() => {
      ref.current?.importImage(secondImport);
    });

    await user.click(
      await screen.findByRole("button", { name: "Import Metadata" }),
    );

    await waitFor(() =>
      expect(screen.queryByText("Image Actions")).not.toBeInTheDocument(),
    );

    expect(screen.getByPlaceholderText("-")).toHaveValue("222");
    expect(screen.getByDisplayValue("30")).toHaveValue(30);
    expect(screen.getByDisplayValue("768")).toHaveValue(768);
  });

  it("refreshes expanded advanced draft controls on repeated metadata imports", async () => {
    const user = userEvent.setup();
    const firstImport = createGalleryImage({
      id: "image-advanced-1",
      path: "C:\\imports\\advanced-1.png",
      src: "konomi://local/C%3A%2Fimports%2Fadvanced-1.png",
    });
    const secondImport = createGalleryImage({
      id: "image-advanced-2",
      path: "C:\\imports\\advanced-2.png",
      src: "konomi://local/C%3A%2Fimports%2Fadvanced-2.png",
    });

    localStorage.setItem(
      "konomi-import-checks",
      JSON.stringify({
        prompt: true,
        negativePrompt: true,
        characters: false,
        charactersAppend: false,
        settings: true,
        seed: true,
      }),
    );

    preloadMocks.image.readNaiMeta
      .mockResolvedValueOnce({
        source: "nai",
        prompt: "advanced metadata prompt 1",
        negativePrompt: "",
        characterPrompts: [],
        characterNegativePrompts: [],
        characterPositions: [],
        seed: 333,
        model: "nai-diffusion-4-5-full",
        sampler: "k_euler_ancestral",
        steps: 26,
        cfgScale: 5.5,
        cfgRescale: 0.12,
        noiseSchedule: "karras",
        varietyPlus: false,
        width: 832,
        height: 1216,
        raw: {},
      })
      .mockResolvedValueOnce({
        source: "nai",
        prompt: "advanced metadata prompt 2",
        negativePrompt: "",
        characterPrompts: [],
        characterNegativePrompts: [],
        characterPositions: [],
        seed: 444,
        model: "nai-diffusion-4-5-full",
        sampler: "k_euler_ancestral",
        steps: 32,
        cfgScale: 7.5,
        cfgRescale: 0.48,
        noiseSchedule: "native",
        varietyPlus: true,
        width: 1024,
        height: 1024,
        raw: {},
      });

    const { ref } = renderGenerationView();

    act(() => {
      ref.current?.importImage(firstImport);
    });

    await user.click(
      await screen.findByRole("button", { name: "Import Metadata" }),
    );

    await waitFor(() =>
      expect(screen.queryByText("Image Actions")).not.toBeInTheDocument(),
    );

    fireEvent.click(getAdvancedParamsToggleButton());

    const detailedSeed = screen.getByPlaceholderText("Random");
    const rescaleSection = screen.getByText("Prompt Guidance Rescale")
      .parentElement?.parentElement;
    const rescaleSlider = rescaleSection?.querySelector('input[type="range"]');

    if (!(rescaleSlider instanceof HTMLInputElement)) {
      throw new Error("Failed to find prompt guidance rescale slider");
    }

    expect(detailedSeed).toHaveValue(333);
    expect(screen.getByText("0.12")).toBeInTheDocument();

    fireEvent.change(detailedSeed, { target: { value: "9999" } });
    fireEvent.change(rescaleSlider, { target: { value: "0.91" } });

    expect(detailedSeed).toHaveValue(9999);
    expect(screen.getByText("0.91")).toBeInTheDocument();

    act(() => {
      ref.current?.importImage(secondImport);
    });

    await user.click(
      await screen.findByRole("button", { name: "Import Metadata" }),
    );

    await waitFor(() =>
      expect(screen.queryByText("Image Actions")).not.toBeInTheDocument(),
    );

    expect(screen.getByPlaceholderText("Random")).toHaveValue(444);
    expect(screen.getByText("0.48")).toBeInTheDocument();
  });

  it("shows an imported source image in the reference panel", async () => {
    const pendingSourceImport = createGalleryImage({
      src: "konomi://local/C%3A%2Fgallery%2Freference.png",
      prompt: "reference prompt",
      tokens: [{ text: "reference prompt", weight: 1 }],
    });

    const { ref } = renderGenerationView();

    act(() => {
      ref.current?.showSourceImage(pendingSourceImport);
    });

    expect(await screen.findByAltText("Reference image")).toHaveAttribute(
      "src",
      pendingSourceImport.src,
    );
    expect(
      screen.getByText("Drag chips into the prompt input to add them."),
    ).toBeInTheDocument();
    expect(screen.getByText("reference prompt")).toBeInTheDocument();
  });

  it("appends prompt tags through the imperative api and returns focus to prompt mode", async () => {
    const user = userEvent.setup();
    const { ref } = renderGenerationView();

    await user.click(screen.getByRole("radio", { name: "Negative Prompt" }));
    expect(
      screen.getByRole("radio", { name: "Negative Prompt" }),
    ).toHaveAttribute("aria-checked", "true");

    act(() => {
      ref.current?.appendPromptTag("sparkles");
    });

    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Prompt" })).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
    await waitFor(() =>
      expect(screen.getByDisplayValue("sparkles")).toBeInTheDocument(),
    );
  });

  it("shows the main prompt input in raw mode by default and toggles into block mode", async () => {
    const user = userEvent.setup();
    const { ref } = renderGenerationView();

    act(() => {
      ref.current?.appendPromptTag("sparkles");
    });

    await waitFor(() =>
      expect(screen.getByDisplayValue("sparkles")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("switch", { name: "Block" }));

    expect(await screen.findByText("sparkles")).toBeInTheDocument();
  });

  it("shows a character prompt card in raw mode by default and toggles into block mode", async () => {
    const user = userEvent.setup();

    localStorage.setItem(
      "konomi-last-gen-params",
      JSON.stringify({
        prompt: "",
        negativePrompt: "",
        aiChoice: true,
        seedInput: "",
        characterPrompts: [
          {
            prompt: "char sparkles",
            negativePrompt: "",
            inputMode: "prompt",
            position: "global",
          },
        ],
      }),
    );

    renderGenerationView();

    const characterGroup = await screen.findByRole("radiogroup", {
      name: "Character 1 input mode",
    });
    const characterCard = characterGroup.closest(
      '[data-character-prompt-card="true"]',
    ) as HTMLElement | null;

    expect(characterCard).not.toBeNull();

    expect(
      await within(characterCard!).findByDisplayValue("char sparkles"),
    ).toBeInTheDocument();

    await user.click(
      within(characterCard!).getByRole("switch", { name: "Block" }),
    );

    expect(
      await within(characterCard!).findByText("char sparkles"),
    ).toBeInTheDocument();
  });

  it("opens the settings panel with a configuration-required message when api key and output folder are missing", async () => {
    preloadMocks.nai.getConfig.mockResolvedValueOnce({ id: 1, apiKey: "" });

    renderGenerationView({
      outputFolder: "",
    });

    expect(
      await screen.findByText("Configuration required"),
    ).toBeInTheDocument();
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

    const promptInput = screen.getByLabelText(
      "1girl, beautiful, masterpiece, ...",
    );

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

  it("renders live preview frames while generation is in progress", async () => {
    const user = userEvent.setup();
    let resolveGenerate: ((value: string) => void) | null = null;

    preloadMocks.nai.generate.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveGenerate = resolve;
        }),
    );
    preloadMocks.image.readNaiMeta.mockResolvedValueOnce(null);

    renderGenerationView();

    fireEvent.change(
      screen.getByLabelText("1girl, beautiful, masterpiece, ..."),
      {
        target: { value: "preview prompt" },
      },
    );

    await user.click(screen.getByRole("button", { name: "Generate" }));

    act(() => {
      preloadEvents.nai.generatePreview.emit("data:image/png;base64,preview");
    });

    expect(await screen.findByAltText("Generation preview")).toHaveAttribute(
      "src",
      "data:image/png;base64,preview",
    );

    await act(async () => {
      resolveGenerate?.("C:/output/generated.png");
      await flushMicrotasks();
    });

    await waitFor(() =>
      expect(
        screen.queryByAltText("Generation preview"),
      ).not.toBeInTheDocument(),
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

    const { ref } = renderGenerationView();

    act(() => {
      ref.current?.showSourceImage(pendingSourceImport);
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

    const { ref } = renderGenerationView();

    act(() => {
      ref.current?.importImage(pendingImport);
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

    const { ref } = renderGenerationView();

    act(() => {
      ref.current?.importImage(pendingImport);
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
