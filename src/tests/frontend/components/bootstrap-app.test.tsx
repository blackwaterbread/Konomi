import React from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { preloadEvents, preloadMocks } from "../helpers/preload-mocks";

const applyAppLanguagePreferenceMock = vi.fn();

vi.mock("@/lib/i18n", async () => {
  const actual = await vi.importActual<typeof import("@/lib/i18n")>(
    "@/lib/i18n",
  );
  return {
    ...actual,
    applyAppLanguagePreference: (...args: unknown[]) =>
      applyAppLanguagePreferenceMock(...args),
  };
});

vi.mock("@/App", () => ({
  default: ({ initialFolderCount }: { initialFolderCount: number | null }) => (
    <div data-testid="bootstrapped-app">
      {initialFolderCount === null ? "null" : String(initialFolderCount)}
    </div>
  ),
}));

vi.mock("@/components/app-splash", () => ({
  AppSplash: ({
    statusText,
    detailText,
    progressPercent,
    fadingOut,
  }: {
    statusText: string;
    detailText: string;
    progressPercent?: number | null;
    fadingOut?: boolean;
  }) => (
    <div
      data-testid="bootstrap-splash"
      data-fading-out={String(Boolean(fadingOut))}
      data-progress={progressPercent == null ? "null" : String(progressPercent)}
    >
      <div data-testid="bootstrap-splash-status">{statusText}</div>
      <div data-testid="bootstrap-splash-detail">{detailText}</div>
    </div>
  ),
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function renderBootstrapApp() {
  vi.resetModules();
  const { BootstrapApp } = await import("@/bootstrap-app");
  return render(<BootstrapApp />);
}

describe("BootstrapApp", () => {
  beforeEach(() => {
    vi.useRealTimers();
    applyAppLanguagePreferenceMock.mockReset().mockResolvedValue("en");
    delete document.documentElement.dataset.theme;
    document.documentElement.classList.remove("dark");
  });

  it("applies stored preferences and waits for the splash minimum before mounting the app", async () => {
    vi.useFakeTimers();

    localStorage.setItem(
      "konomi-settings",
      JSON.stringify({ language: "ko", theme: "white" }),
    );
    preloadMocks.folder.list.mockResolvedValueOnce([
      { id: 1, name: "Folder 1", path: "C:\\gallery", order: 0 },
    ]);
    preloadMocks.image.scan.mockResolvedValueOnce(undefined);

    const view = await renderBootstrapApp();

    expect(screen.getByTestId("bootstrap-splash")).toBeInTheDocument();

    await act(async () => {
      await flushPromises();
    });

    expect(applyAppLanguagePreferenceMock).toHaveBeenCalledWith("ko");
    expect(document.documentElement.dataset.theme).toBe("white");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(preloadMocks.image.scan).toHaveBeenCalledWith({
      detectDuplicates: true,
      orderedFolderIds: undefined,
    });
    expect(screen.queryByTestId("bootstrapped-app")).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1899);
      await flushPromises();
    });

    expect(screen.queryByTestId("bootstrapped-app")).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await flushPromises();
    });

    expect(screen.getByTestId("bootstrapped-app")).toHaveTextContent("1");
    expect(screen.getByTestId("bootstrap-splash")).toHaveAttribute(
      "data-fading-out",
      "true",
    );

    await act(async () => {
      vi.advanceTimersByTime(240);
      await flushPromises();
    });

    expect(screen.queryByTestId("bootstrap-splash")).not.toBeInTheDocument();

    view.unmount();
  });

  it("uses ordered folder ids and onboarding splash messaging for an empty library", async () => {
    const scanDeferred = createDeferred<void>();

    localStorage.setItem("konomi-folder-order", JSON.stringify([3, 1]));
    preloadMocks.folder.list.mockResolvedValueOnce([]);
    preloadMocks.image.scan.mockReturnValueOnce(scanDeferred.promise);

    const view = await renderBootstrapApp();

    await act(async () => {
      await flushPromises();
    });

    expect(preloadMocks.image.scan).toHaveBeenCalledWith({
      detectDuplicates: true,
      orderedFolderIds: [3, 1],
    });
    expect(screen.getByTestId("bootstrap-splash-status")).toHaveTextContent(
      "Preparing the start screen so you can add a folder right away.",
    );
    expect(screen.getByTestId("bootstrap-splash-detail")).toHaveTextContent(
      "Preparing the start screen.",
    );

    scanDeferred.resolve();
    await act(async () => {
      await flushPromises();
    });

    view.unmount();
  });

  it("reflects scan progress events in the splash detail text", async () => {
    const scanDeferred = createDeferred<void>();

    preloadMocks.folder.list.mockResolvedValueOnce([
      { id: 1, name: "Folder 1", path: "C:\\gallery", order: 0 },
    ]);
    preloadMocks.image.scan.mockReturnValueOnce(scanDeferred.promise);

    const view = await renderBootstrapApp();

    await act(async () => {
      await flushPromises();
    });

    act(() => {
      preloadEvents.image.scanFolder.emit({
        folderId: 1,
        folderName: "Folder A",
        active: true,
      });
      preloadEvents.image.scanProgress.emit({
        done: 2,
        total: 4,
      });
    });

    expect(screen.getByTestId("bootstrap-splash-detail")).toHaveTextContent(
      "Checking Folder A 2/4",
    );
    expect(screen.getByTestId("bootstrap-splash")).toHaveAttribute(
      "data-progress",
      "50",
    );

    scanDeferred.resolve();
    await act(async () => {
      await flushPromises();
    });

    view.unmount();
  });
});
