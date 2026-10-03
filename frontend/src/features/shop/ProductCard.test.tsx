import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Product } from "../../api/types";
import { renderWithProviders } from "../../test/render";
import { ProductCard } from "./ProductCard";

function product(overrides: Partial<Product>): Product {
  return {
    id: 1,
    sku: "XS-001",
    name: "Plain name",
    description: "Plain description",
    category: "Electronics",
    price: "19.99",
    stock: 100,
    weight_kg: "0.100",
    version: 1,
    created_at: "2026-10-03T00:00:00Z",
    updated_at: "2026-10-03T00:00:00Z",
    ...overrides,
  };
}

describe("ProductCard", () => {
  it("renders markup in product text as plain text, never as HTML", () => {
    const payload = "<script>alert('xss')</script>";
    const { container } = renderWithProviders(
      <ProductCard
        product={product({ name: payload, description: '<img src=x onerror="alert(1)">' })}
      />,
    );
    expect(screen.getByText(payload)).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("keeps quotes and SQL-looking characters verbatim", () => {
    const name = "Robert'); DROP TABLE products;--";
    renderWithProviders(<ProductCard product={product({ name })} />);
    expect(screen.getByText(name)).toBeInTheDocument();
  });
});
