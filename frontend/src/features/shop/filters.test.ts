import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  effectiveSort,
  hasActiveFilters,
  parseShopFilters,
  shopFiltersToParams,
  toProductQuery,
} from "./filters";

describe("shop filters", () => {
  it("parses URL search params defensively", () => {
    const filters = parseShopFilters(
      new URLSearchParams(
        "q=mouse&category=Electronics&min_price=10&max_price=abc&in_stock=true&sort=bogus&page=-2",
      ),
    );
    expect(filters).toEqual({
      q: "mouse",
      category: "Electronics",
      minPrice: "10",
      maxPrice: "",
      inStock: true,
      sort: null,
      page: 1,
    });
  });

  it("round-trips through the URL and omits defaults", () => {
    const filters = { ...DEFAULT_FILTERS, q: "lamp", sort: "price_asc" as const, page: 3 };
    const params = shopFiltersToParams(filters);
    expect(params.toString()).toBe("q=lamp&sort=price_asc&page=3");
    expect(parseShopFilters(params)).toEqual(filters);
    expect(shopFiltersToParams(DEFAULT_FILTERS).toString()).toBe("");
  });

  it("builds the API query", () => {
    expect(
      toProductQuery({ ...DEFAULT_FILTERS, q: "  desk ", inStock: true, minPrice: "5" }, 24),
    ).toEqual({
      q: "desk",
      category: undefined,
      min_price: "5",
      max_price: undefined,
      in_stock: true,
      sort: undefined,
      page: 1,
      page_size: 24,
    });
  });

  it("defaults the sort to relevance only when searching", () => {
    expect(effectiveSort(DEFAULT_FILTERS)).toBe("name");
    expect(effectiveSort({ ...DEFAULT_FILTERS, q: "x" })).toBe("relevance");
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, inStock: true })).toBe(true);
  });
});
