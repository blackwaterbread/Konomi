import React from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { preloadMocks } from "../helpers/preload-mocks";

const applyAppLanguagePreferenceMock = vi.fn();

vi.mock("@/lib/i18n", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/i18n")>("@/lib/i18n");
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
    (window.appInfo as { isElectron: boolean }).isElectron = true;
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

    const view = await renderBootstrapApp();

    expect(screen.getByTestId("bootstrap-splash")).toBeInTheDocument();

    await act(async () => {
      await flushPromises();
    });

    expect(applyAppLanguagePreferenceMock).toHaveBeenCalledWith("ko");
    expect(document.documentElement.dataset.theme).toBe("white");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    // scan is no longer called during bootstrap — it runs after App mounts
    expect(preloadMocks.image.scan).not.toHaveBeenCalled();
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

  it("shows onboarding splash messaging for an empty library", async () => {
    preloadMocks.folder.list.mockResolvedValueOnce([]);

    const view = await renderBootstrapApp();

    await act(async () => {
      await flushPromises();
    });

    // scan is no longer called during bootstrap
    expect(preloadMocks.image.scan).not.toHaveBeenCalled();

    expect(screen.getByTestId("bootstrap-splash-status")).toHaveTextContent(
      "Preparing the start screen...",
    );

    view.unmount();
  });

  it("skips the splash on the web build and mounts the app immediately", async () => {
    (window.appInfo as { isElectron: boolean }).isElectron = false;
    localStorage.setItem(
      "konomi-settings",
      JSON.stringify({ language: "ko", theme: "dark" }),
    );

    const view = await renderBootstrapApp();

    // No splash at any point; App mounts straight away (folders load themselves).
    expect(screen.queryByTestId("bootstrap-splash")).not.toBeInTheDocument();
    expect(screen.getByTestId("bootstrapped-app")).toHaveTextContent("null");
    // Theme is applied synchronously before paint, not deferred to App.
    expect(document.documentElement.dataset.theme).toBe("dark");

    await act(async () => {
      await flushPromises();
    });

    expect(screen.queryByTestId("bootstrap-splash")).not.toBeInTheDocument();
    expect(applyAppLanguagePreferenceMock).toHaveBeenCalledWith("ko");

    view.unmount();
  });
});
