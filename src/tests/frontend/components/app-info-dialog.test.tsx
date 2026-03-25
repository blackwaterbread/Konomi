import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppInfoDialog } from "@/components/app-info-dialog";

describe("AppInfoDialog", () => {
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
});
