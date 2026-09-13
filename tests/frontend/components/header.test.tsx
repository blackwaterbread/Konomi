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
import { preloadEvents } from "../helpers/preload-mocks";

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
