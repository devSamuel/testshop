import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { searchShop } from "./support.ts";

const outputDir =
  process.env.SCREENSHOT_DIR ?? fileURLToPath(new URL("../../docs/screenshots/", import.meta.url));
const officialFile = fileURLToPath(new URL("../../data/products.csv", import.meta.url));

interface ProductPage {
  items: { id: number; sku: string }[];
}

async function capture(page: Page, file: string): Promise<void> {
  await page.mouse.move(0, 0);
  await expect(page.locator(".mantine-Notification-root")).toHaveCount(0, { timeout: 10_000 });
  mkdirSync(outputDir, { recursive: true });
  await page.screenshot({ path: join(outputDir, file) });
}

test.describe.configure({ mode: "serial" });

test("shop search", async ({ page }) => {
  await searchShop(page, "blutooth");
  await expect(page.getByRole("article").first()).toContainText("Bluetooth Speaker");
  await capture(page, "01-shop-typo-search.png");

  await searchShop(page, "keybaord");
  await expect(page.getByText("Showing approximate matches for “keybaord”")).toBeVisible();
  await capture(page, "02-shop-fuzzy-fallback.png");
});

test("checkout, paid order and stock ledger", async ({ page }) => {
  await searchShop(page, "GK-088");
  await page.getByRole("button", { name: "Add Gaming Keyboard to cart" }).click();
  await page.getByRole("link", { name: "Cart, 1 item" }).click();
  const checkout = page.getByRole("form", { name: "Checkout" });
  await checkout.getByLabel("Email").fill("reviewer@example.com");
  await checkout.getByRole("button", { name: /^Use test card Decline/ }).click();
  await checkout.getByRole("button", { name: /^Pay / }).click();
  await expect(page.getByRole("alert", { name: "Card declined" })).toBeVisible();
  await capture(page, "03-checkout-declined-stock-released.png");

  await checkout.getByRole("button", { name: /^Use test card Approve/ }).click();
  await checkout.getByRole("button", { name: /^Pay / }).click();
  await expect(page.getByRole("alert", { name: "Thank you!" })).toBeVisible();
  await capture(page, "04-order-paid.png");

  const response = await page.request.get("/api/products", { params: { q: "GK-088" } });
  const { items } = (await response.json()) as ProductPage;
  const keyboard = items.find((item) => item.sku === "GK-088");
  expect(keyboard).toBeDefined();
  await page.goto(`/admin/products/${String(keyboard?.id)}/history`);
  await expect(page.getByRole("table", { name: "Stock movements" })).toBeVisible();
  await capture(page, "06-stock-ledger.png");
});

test("import dry run", async ({ page }) => {
  await page.goto("/admin/import");
  await page.locator('input[type="file"]').setInputFiles(officialFile);
  await expect(page.getByRole("radiogroup", { name: "Filter issues by severity" })).toContainText(
    "Errors (7)",
  );
  await capture(page, "05-import-dry-run-report.png");
});

test("system health", async ({ page }) => {
  await page.goto("/admin/system");
  await expect(page.getByText("All checks passing")).toBeVisible();
  await capture(page, "07-system-health.png");
});

test.describe("mobile", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });

  test("mobile shop", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("article").first()).toBeVisible();
    await capture(page, "08-mobile-shop.png");
  });
});
