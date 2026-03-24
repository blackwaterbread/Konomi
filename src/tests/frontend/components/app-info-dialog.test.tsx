import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppInfoDialog } from "@/components/app-info-dialog";
import { preloadMocks } from "../helpers/preload-mocks";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe("AppInfoDialog", () => {
  it("loads app info and renders environment details when opened", async () => {
    const deferredInfo = createDeferred<{
      appName: string;
      appVersion: string;
      electronVersion: string;
      chromeVersion: string;
      nodeVersion: string;
      platform: string;
      arch: string;
    }>();

    preloadMocks.appInfo.get.mockReturnValueOnce(deferredInfo.promise);

    render(<AppInfoDialog open onOpenChange={vi.fn()} />);

    expect(preloadMocks.appInfo.get).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Loading information...")).toBeInTheDocument();
    expect(screen.getByText("Loading environment...")).toBeInTheDocument();

    deferredInfo.resolve({
      appName: "Konomi",
      appVersion: "0.2.0",
      electronVersion: "40.0.0",
      chromeVersion: "140.0.0.0",
      nodeVersion: "24.3.0",
      platform: "win32",
      arch: "x64",
    });

    await waitFor(() =>
      expect(screen.getByText(/Konomi v0\.2\.0/)).toBeInTheDocument(),
    );

    expect(
      screen.queryByText("Loading information..."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Loading environment..."),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Electron 40\.0\.0/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Open project GitHub repository",
      }),
    ).toHaveAttribute("href", "https://github.com/blackwaterbread/Konomi");
  });

  it("hands feature tour control back to the caller and opens the license dialog", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onStartTour = vi.fn();

    render(
      <AppInfoDialog
        open
        onOpenChange={onOpenChange}
        onStartTour={onStartTour}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/Konomi v0\.1\.0/)).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Feature Tour" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onStartTour).toHaveBeenCalledTimes(1);

    await user.click(
      screen.getByRole("button", { name: "Open Source Licenses" }),
    );

    expect(
      screen.getByText("Included open-source license information."),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue(/Apache 2\.0 licensed packages used by Konomi/),
    ).toBeInTheDocument();
  });

  it("falls back to placeholder environment values when app info loading fails", async () => {
    preloadMocks.appInfo.get.mockRejectedValueOnce(new Error("boom"));

    render(<AppInfoDialog open onOpenChange={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(/Konomi v-/)).toBeInTheDocument(),
    );

    expect(screen.getByText(/Electron -/)).toBeInTheDocument();
    expect(screen.getByText(/Platform -/)).toBeInTheDocument();
  });
});
