import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../test/render";
import { stockStatus } from "./stock";
import { StockBadge } from "./StockBadge";

describe("StockBadge", () => {
  it.each([
    [0, "Out of stock", "red"],
    [-1, "Out of stock", "red"],
    [1, "Only 1 left", "orange"],
    [4, "Only 4 left", "orange"],
    [5, "In stock", "green"],
    [120, "In stock", "green"],
  ])("maps stock %i to %s (%s)", (stock, label, color) => {
    expect(stockStatus(stock)).toEqual({ label, color });
  });

  it("renders the label", () => {
    renderWithProviders(<StockBadge stock={3} />);
    expect(screen.getByText("Only 3 left")).toBeInTheDocument();
  });
});
