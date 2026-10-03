import { expect, type APIRequestContext, type Page } from "@playwright/test";

export interface ProductRecord {
  id: number;
  sku: string;
  name: string;
  price: string;
  stock: number;
  version: number;
}

export interface NewProduct {
  sku: string;
  name: string;
  price: string;
  stock: number;
}

export function uniqueSku(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

export async function createProduct(
  request: APIRequestContext,
  product: NewProduct,
): Promise<ProductRecord> {
  const response = await request.post("/api/products", {
    data: {
      ...product,
      category: "Kitchen",
      description: "Created by the end-to-end suite",
      weight_kg: "0.500",
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as ProductRecord;
}

export async function productStock(request: APIRequestContext, id: number): Promise<number> {
  const response = await request.get(`/api/products/${id}`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as ProductRecord).stock;
}

async function searchWith(page: Page, label: string, query: string): Promise<void> {
  const results = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/products" && url.searchParams.get("q") === query;
  });
  const search = page.getByRole("textbox", { name: label, exact: true });
  await search.fill(query);
  await search.press("Enter");
  expect((await results).ok()).toBe(true);
}

export async function searchShop(page: Page, query: string): Promise<void> {
  await page.goto("/");
  await searchWith(page, "Search", query);
}

export async function searchAdminProducts(page: Page, query: string): Promise<void> {
  await page.goto("/admin/products");
  await searchWith(page, "Search products", query);
}
