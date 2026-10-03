import type { ProductSearchQuery, ProductSort } from "../../api/types";

export const SHOP_PAGE_SIZE = 24;
export const PRICE_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

export interface ShopFilters {
  q: string;
  category: string;
  minPrice: string;
  maxPrice: string;
  inStock: boolean;
  sort: ProductSort | null;
  page: number;
}

export const DEFAULT_FILTERS: ShopFilters = {
  q: "",
  category: "",
  minPrice: "",
  maxPrice: "",
  inStock: false,
  sort: null,
  page: 1,
};

export const SORT_OPTIONS: readonly { value: ProductSort; label: string }[] = [
  { value: "relevance", label: "Best match" },
  { value: "name", label: "Name (A–Z)" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "newest", label: "Newest" },
];

const SORT_VALUES = new Set<string>(SORT_OPTIONS.map((option) => option.value));

function isSort(value: string | null): value is ProductSort {
  return value !== null && SORT_VALUES.has(value);
}

export function validatePrice(value: string): string | null {
  if (!value) return null;
  return PRICE_PATTERN.test(value) ? null : "Enter an amount like 19.99";
}

function parsePrice(value: string | null): string {
  const trimmed = value?.trim() ?? "";
  return validatePrice(trimmed) === null ? trimmed : "";
}

function parsePage(value: string | null): number {
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}

export function parseShopFilters(params: URLSearchParams): ShopFilters {
  const sort = params.get("sort");
  return {
    q: params.get("q") ?? "",
    category: params.get("category")?.trim() ?? "",
    minPrice: parsePrice(params.get("min_price")),
    maxPrice: parsePrice(params.get("max_price")),
    inStock: params.get("in_stock") === "true",
    sort: isSort(sort) ? sort : null,
    page: parsePage(params.get("page")),
  };
}

export function shopFiltersToParams(filters: ShopFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q);
  if (filters.category) params.set("category", filters.category);
  if (filters.minPrice) params.set("min_price", filters.minPrice);
  if (filters.maxPrice) params.set("max_price", filters.maxPrice);
  if (filters.inStock) params.set("in_stock", "true");
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.page > 1) params.set("page", String(filters.page));
  return params;
}

export function toProductQuery(
  filters: ShopFilters,
  pageSize = SHOP_PAGE_SIZE,
): ProductSearchQuery {
  const q = filters.q.trim();
  return {
    q: q || undefined,
    category: filters.category || undefined,
    min_price: filters.minPrice || undefined,
    max_price: filters.maxPrice || undefined,
    in_stock: filters.inStock || undefined,
    sort: filters.sort ?? undefined,
    page: filters.page,
    page_size: pageSize,
  };
}

export function effectiveSort(filters: ShopFilters): ProductSort {
  return filters.sort ?? (filters.q.trim() ? "relevance" : "name");
}

export function hasActiveFilters(filters: ShopFilters): boolean {
  return Boolean(
    filters.q.trim() ||
    filters.category ||
    filters.minPrice ||
    filters.maxPrice ||
    filters.inStock ||
    filters.sort,
  );
}
