import { expect, test } from "@playwright/test";
import { searchShop } from "./support.ts";

test("a typo still finds the product", async ({ page }) => {
  await searchShop(page, "blutooth");
  await expect(page.getByRole("article").first()).toContainText("Bluetooth Speaker");
  await expect(page.getByText("Showing approximate matches", { exact: false })).toHaveCount(0);
});

test("transposed letters fall back to approximate matches", async ({ page }) => {
  await searchShop(page, "keybaord");
  await expect(page.getByText("Showing approximate matches for “keybaord”")).toBeVisible();
  await expect(page.getByRole("article").first()).toContainText("Gaming Keyboard");
});

test("a lower-case SKU finds exactly that product", async ({ page }) => {
  await searchShop(page, "gk-088");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article")).toContainText("GK-088");
});
