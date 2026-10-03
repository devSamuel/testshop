import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReconcileResult } from "../../../api/types";
import { jsonResponse, renderWithProviders } from "../../../test/render";
import { ReconcileCard } from "./ReconcileCard";

function stubReconcile(result: ReconcileResult) {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(result))),
  );
}

const finished: ReconcileResult = {
  examined: 3,
  paid: 2,
  failed: 0,
  expired: 1,
  waiting: 0,
  skipped: false,
};

describe("ReconcileCard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the counts of a finished run", async () => {
    stubReconcile(finished);
    renderWithProviders(<ReconcileCard />);
    await userEvent.setup().click(screen.getByRole("button", { name: /run reconciler now/i }));
    expect(await screen.findByText("Examined")).toBeInTheDocument();
    expect(screen.queryByText(/only one runs at a time/i)).not.toBeInTheDocument();
  });

  it("explains a skipped run instead of reporting zero orders examined", async () => {
    stubReconcile({ ...finished, examined: 0, paid: 0, expired: 0, skipped: true });
    renderWithProviders(<ReconcileCard />);
    await userEvent.setup().click(screen.getByRole("button", { name: /run reconciler now/i }));
    expect(await screen.findByText(/only one runs at a time/i)).toBeInTheDocument();
    expect(screen.queryByText("Examined")).not.toBeInTheDocument();
  });
});
