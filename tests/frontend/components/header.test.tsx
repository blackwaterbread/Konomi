import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { Header } from "@/components/header";
import i18n from "@/lib/i18n";
import { preloadEvents, preloadMocks } from "../helpers/preload-mocks";

describe("header cancellation", () => {
  it.each(["analysis", "duplicates", "metadata", "searchStats", "similarity"])(
    "lets X cancel %s without an active scan and shows cancellation pending",
    async (kind) => {
      const cancel = vi.fn().mockResolvedValue(undefined);
      render(
        <Header
          activePanel="gallery"
          onPanelChange={vi.fn()}
          scanning={false}
          isAnalyzing={kind === "analysis"}
          checkingDuplicates={kind === "duplicates"}
          onCancelScan={cancel}
        />,
      );
      act(() => {
        if (kind === "metadata")
          preloadEvents.image.rescanMetadataProgress.emit({
            done: 1,
            total: 10,
          });
        if (kind === "searchStats")
          preloadEvents.image.searchStatsProgress.emit({ done: 1, total: 10 });
        if (kind === "similarity")
          preloadEvents.image.similarityProgress.emit({ done: 1, total: 10 });
      });
      const buttons = screen.getAllByRole("button", { name: "Cancel" });
      expect(buttons).toHaveLength(2);
      await act(async () => {
        fireEvent.click(buttons[1]);
      });
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Cancelling...")).toBeInTheDocument();
      expect(buttons[0]).toBeDisabled();
      expect(buttons[1]).toBeDisabled();
    },
  );

  it("allows retry when cancellation fails", async () => {
    const cancel = vi.fn().mockRejectedValue(new Error("IPC failed"));
    render(
      <Header
        activePanel="gallery"
        onPanelChange={vi.fn()}
        isAnalyzing
        onCancelScan={cancel}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getAllByRole("button", { name: "Cancel" })[0]).toBeEnabled();
  });
});

describe("header scan progress", () => {
  const progressBar = (container: HTMLElement) =>
    container.querySelector("[style*='width']");
  const header = (scanning: boolean) => (
    <Header activePanel="gallery" onPanelChange={vi.fn()} scanning={scanning} />
  );

  it("labels a scan with its first phase until the scan reports one", () => {
    render(<Header activePanel="gallery" onPanelChange={vi.fn()} scanning />);
    expect(
      screen.getByText(i18n.t("header.progress.phase.loadingLibrary")),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(i18n.t("header.progress.working")),
    ).not.toBeInTheDocument();

    act(() => {
      preloadEvents.image.scanPhase.emit({ phase: "scanningFiles" });
    });
    expect(
      screen.getByText(i18n.t("header.progress.phase.scanningFiles")),
    ).toBeInTheDocument();
  });

  it("fills the bar when a scan ends on its settled total, then clears it", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(header(true));
    act(() => {
      preloadEvents.image.scanProgress.emit({ done: 78, total: 100 });
    });
    expect(progressBar(container)).toHaveStyle({ width: "78%" });

    // The stored count was too large: the scan settles on `total = done`, and
    // `scanning` turns false right after that last event.
    act(() => {
      preloadEvents.image.scanProgress.emit({ done: 80, total: 80 });
    });
    rerender(header(false));
    expect(progressBar(container)).toHaveStyle({ width: "100%" });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(progressBar(container)).toBeNull();

    // A scan that stops below its total (cancelled) clears at once.
    rerender(header(true));
    act(() => {
      preloadEvents.image.scanProgress.emit({ done: 40, total: 100 });
    });
    rerender(header(false));
    expect(progressBar(container)).toBeNull();

    // The next scan does not inherit a full bar.
    rerender(header(true));
    act(() => {
      preloadEvents.image.scanProgress.emit({ done: 5, total: 5 });
    });
    rerender(header(false));
    expect(progressBar(container)).toHaveStyle({ width: "100%" });
    rerender(header(true));
    expect(progressBar(container)).toBeNull();
  });

  it("does not fill the bar when a utility reset ends a scan that had reached its total", () => {
    let utilityReset = () => {};
    preloadMocks.appInfo.onUtilityReset.mockImplementation((cb: () => void) => {
      utilityReset = cb;
      return () => {};
    });
    const { container, rerender } = render(header(true));
    act(() => {
      preloadEvents.image.scanProgress.emit({ done: 5, total: 5 });
    });
    act(() => {
      utilityReset();
    });
    rerender(header(false));
    expect(progressBar(container)).toBeNull();
  });

  it("does not fill the bar again for a later scan that ends before any progress", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(header(true));
    act(() => {
      preloadEvents.image.scanProgress.emit({ done: 5, total: 5 });
    });
    rerender(header(false));
    expect(progressBar(container)).toHaveStyle({ width: "100%" });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(progressBar(container)).toBeNull();

    // Cancelled while loading the library: no progress event at all.
    rerender(header(true));
    rerender(header(false));
    expect(progressBar(container)).toBeNull();
  });

  it("lets other progress take the bar while a finished scan's bar is full", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(header(true));
    act(() => {
      preloadEvents.image.scanProgress.emit({ done: 5, total: 5 });
    });
    rerender(header(false));
    expect(progressBar(container)).toHaveStyle({ width: "100%" });

    act(() => {
      preloadEvents.image.searchStatsProgress.emit({ done: 1, total: 4 });
    });
    expect(progressBar(container)).toHaveStyle({ width: "25%" });
  });

  it("shows the processed count once done reaches the total, until the scan ends or a total is ahead again", () => {
    const { container, rerender } = render(
      <Header activePanel="gallery" onPanelChange={vi.fn()} scanning />,
    );
    act(() => {
      preloadEvents.image.scanPhase.emit({ phase: "syncing" });
      preloadEvents.image.scanProgress.emit({ done: 3, total: 5 });
    });
    expect(screen.getByText("Scanning images 3/5")).toBeInTheDocument();
    expect(screen.getByText("3/5")).toBeInTheDocument();
    expect(progressBar(container)).not.toBeNull();

    // The stored total was too small: from here on the backend keeps
    // `total = max(total, done)`, so every event has done === total.
    act(() => {
      preloadEvents.image.scanProgress.emit({ done: 5, total: 5 });
      preloadEvents.image.scanProgress.emit({ done: 7, total: 7 });
    });
    expect(screen.getByText("Scanning images 7")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.queryByText("Syncing images...")).not.toBeInTheDocument();
    expect(progressBar(container)).toBeNull();

    // Another status takes the status area over and hands it back.
    act(() => {
      preloadEvents.image.searchStatsProgress.emit({ done: 1, total: 4 });
    });
    expect(screen.getByText("Search stats 1/4")).toBeInTheDocument();
    expect(screen.queryByText("Scanning images 7")).not.toBeInTheDocument();
    expect(screen.queryByText("7")).not.toBeInTheDocument();
    act(() => {
      preloadEvents.image.searchStatsProgress.emit({ done: 4, total: 4 });
    });
    expect(screen.getByText("Scanning images 7")).toBeInTheDocument();

    // A total ahead of done brings the denominator back.
    act(() => {
      preloadEvents.image.scanProgress.emit({ done: 7, total: 9 });
    });
    expect(screen.getByText("Scanning images 7/9")).toBeInTheDocument();
    expect(screen.queryByText("Scanning images 7")).not.toBeInTheDocument();

    act(() => {
      preloadEvents.image.scanProgress.emit({ done: 9, total: 9 });
    });
    expect(screen.getByText("Scanning images 9")).toBeInTheDocument();

    rerender(
      <Header activePanel="gallery" onPanelChange={vi.fn()} scanning={false} />,
    );
    expect(screen.queryByText("Scanning images 9")).not.toBeInTheDocument();
    expect(screen.queryByText("9")).not.toBeInTheDocument();

    // The next scan starts without the previous count.
    rerender(<Header activePanel="gallery" onPanelChange={vi.fn()} scanning />);
    expect(screen.queryByText("Scanning images 9")).not.toBeInTheDocument();
    act(() => {
      preloadEvents.image.scanProgress.emit({ done: 0, total: 4 });
    });
    expect(screen.getByText("Scanning images 0/4")).toBeInTheDocument();
  });
});
