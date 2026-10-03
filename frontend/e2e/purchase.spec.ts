import { expect, test } from "@playwright/test";
import { createProduct, productStock, searchShop, uniqueSku } from "./support.ts";

test("a declined card releases the stock and keeps the cart, then a good card pays", async ({
  page,
  request,
}) => {
  const sku = uniqueSku("E2E-BUY");
  const product = await createProduct(request, {
    sku,
    name: `Travel Mug ${sku}`,
    price: "25.00",
    stock: 3,
  });
  const email = `buyer-${sku.toLowerCase()}@example.com`;

  await searchShop(page, sku);
  await page.getByRole("button", { name: `Add ${product.name} to cart` }).click();
  await page.getByRole("link", { name: "Cart, 1 item" }).click();

  const checkout = page.getByRole("form", { name: "Checkout" });
  await checkout.getByLabel("Email").fill(email);
  await checkout.getByRole("button", { name: /^Use test card Decline/ }).click();
  await checkout.getByRole("button", { name: "Pay $25.00" }).click();

  await expect(page.getByRole("alert", { name: "Card declined" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Cart items" })).toContainText(product.name);
  expect(await productStock(request, product.id)).toBe(3);

  await checkout.getByRole("button", { name: /^Use test card Approve/ }).click();
  await checkout.getByRole("button", { name: "Pay $25.00" }).click();

  await expect(page).toHaveURL(/\/orders\/\d+$/);
  await expect(page.getByRole("alert", { name: "Thank you!" })).toBeVisible();
  expect(await productStock(request, product.id)).toBe(2);

  await page.goto("/orders");
  const attempts = page.getByRole("row").filter({ hasText: email });
  await expect(attempts.filter({ hasText: "Paid" })).toHaveCount(1);
  await expect(attempts.filter({ hasText: "Payment failed" })).toHaveCount(1);
});
