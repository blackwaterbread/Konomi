import React from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { preloadEvents, preloadMocks } from "../helpers/preload-mocks";

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
    failed,
  }: {
    statusText: string;
    detailText: string;
    progressPercent?: number | null;
    fadingOut?: boolean;
    failed?: boolean;
  }) => (
    <div
      data-testid="bootstrap-splash"
      data-fading-out={String(Boolean(fadingOut))}
      data-progress={progressPercent == null ? "null" : String(progressPercent)}
      data-failed={String(Boolean(failed))}
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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

  it("reads folders and mounts the app only after the migrations finish", async () => {
    vi.useFakeTimers();
    const migrations = deferred<void>();
    preloadMocks.db.runMigrations.mockReturnValueOnce(migrations.promise);
    preloadMocks.folder.list.mockResolvedValueOnce([
      { id: 1, name: "Folder 1", path: "C:\\gallery", order: 0 },
    ]);

    const view = await renderBootstrapApp();

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await flushPromises();
    });

    expect(preloadMocks.folder.list).not.toHaveBeenCalled();
    expect(screen.queryByTestId("bootstrapped-app")).not.toBeInTheDocument();

    await act(async () => {
      migrations.resolve();
      await flushPromises();
      await flushPromises();
    });

    expect(preloadMocks.folder.list).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(180);
      await flushPromises();
    });

    expect(screen.getByTestId("bootstrapped-app")).toHaveTextContent("1");

    view.unmount();
  });

  it("stays on the splash with the error when the migrations fail", async () => {
    vi.useFakeTimers();
    preloadMocks.db.runMigrations.mockRejectedValueOnce(
      new Error("SqliteError: no such table: Image"),
    );

    const view = await renderBootstrapApp();

    await act(async () => {
      await flushPromises();
      vi.advanceTimersByTime(10_000);
      await flushPromises();
    });

    expect(preloadMocks.folder.list).not.toHaveBeenCalled();
    expect(screen.queryByTestId("bootstrapped-app")).not.toBeInTheDocument();
    const splash = screen.getByTestId("bootstrap-splash");
    expect(splash).toHaveAttribute("data-failed", "true");
    expect(splash).toHaveAttribute("data-fading-out", "false");
    expect(screen.getByTestId("bootstrap-splash-detail")).toHaveTextContent(
      "SqliteError: no such table: Image",
    );

    view.unmount();
  });

  it("ignores migration progress that lands after the migration reply", async () => {
    const migrations = deferred<void>();
    preloadMocks.db.runMigrations.mockReturnValueOnce(migrations.promise);
    const folders = deferred<[]>();
    preloadMocks.folder.list.mockReturnValueOnce(folders.promise);
    const updating = i18n.t("app.splash.status.updatingDatabase");

    const view = await renderBootstrapApp();
    const status = () => screen.getByTestId("bootstrap-splash-status");

    act(() => {
      preloadEvents.db.migrationProgress.emit({
        done: 0,
        total: 2,
        migrationName: "20990101000000_a",
      });
    });
    expect(status()).toHaveTextContent(updating);

    await act(async () => {
      migrations.resolve();
      await flushPromises();
    });
    expect(status()).not.toHaveTextContent(updating);

    act(() => {
      preloadEvents.db.migrationProgress.emit({
        done: 1,
        total: 2,
        migrationName: "20990102000000_b",
      });
    });
    expect(status()).not.toHaveTextContent(updating);
    expect(screen.getByTestId("bootstrap-splash")).toHaveAttribute(
      "data-progress",
      "0",
    );

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
