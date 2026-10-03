import { apiFetch } from "./client";
import type {
  Category,
  Product,
  ProductCreateInput,
  ProductPage,
  ProductSearchQuery,
  ProductUpdateInput,
  StockMovement,
} from "./types";

export const STOCK_MOVEMENTS_PAGE_SIZE = 50;

export const productsApi = {
  search: (query: ProductSearchQuery, signal?: AbortSignal) =>
    apiFetch<ProductPage>("/api/products", { query: { ...query }, signal }),

  get: (id: number, signal?: AbortSignal) => apiFetch<Product>(`/api/products/${id}`, { signal }),

  create: (input: ProductCreateInput) =>
    apiFetch<Product>("/api/products", { method: "POST", json: input }),

  update: (id: number, input: ProductUpdateInput) =>
    apiFetch<Product>(`/api/products/${id}`, { method: "PATCH", json: input }),

  remove: (id: number, version: number) =>
    apiFetch<undefined>(`/api/products/${id}`, { method: "DELETE", query: { version } }),

  stockMovements: (id: number, beforeId: number | undefined, signal?: AbortSignal) =>
    apiFetch<StockMovement[]>(`/api/products/${id}/stock-movements`, {
      query: { limit: STOCK_MOVEMENTS_PAGE_SIZE, before_id: beforeId },
      signal,
    }),

  categories: (signal?: AbortSignal) => apiFetch<Category[]>("/api/categories", { signal }),
};
