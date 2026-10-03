import { expect, test } from "@playwright/test";
import { searchAdminProducts, searchShop, uniqueSku } from "./support.ts";

test("an admin creates, edits and deletes a product, and the shop follows", async ({ page }) => {
  const sku = uniqueSku("E2E-CRUD");
  const name = `Desk Lamp ${sku}`;

  await page.goto("/admin/products");
  await page.getByRole("button", { name: "New product" }).click();
  const create = page.getByRole("dialog", { name: "New product" });
  await create.getByLabel("SKU").fill(sku);
  await create.getByLabel("Name").fill(name);
  await create.getByLabel("Description").fill("Adjustable LED desk lamp");
  await create.getByLabel("Category").fill("Lighting");
  await create.getByLabel("Category").press("Tab");
  await create.getByLabel("Price").fill("39.90");
  await create.getByLabel("Stock").fill("12");
  await create.getByLabel("Weight").fill("1.2");
  await create.getByRole("button", { name: "Create product" }).click();
  await expect(create).toBeHidden();

  await searchShop(page, sku);
  const card = page.getByRole("article").filter({ hasText: name });
  await expect(card).toContainText("$39.90");
  await expect(card).toContainText("Lighting");

  await searchAdminProducts(page, sku);
  const row = page.getByRole("row").filter({ hasText: sku });
  await expect(row).toContainText("$39.90");

  await page.getByRole("button", { name: `Edit ${name}` }).click();
  const edit = page.getByRole("dialog", { name: `Edit ${name}` });
  await edit.getByLabel("Price").fill("34.50");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toBeHidden();
  await expect(row).toContainText("$34.50");

  await page.getByRole("button", { name: `Delete ${name}` }).click();
  const confirm = page.getByRole("dialog", { name: "Delete product" });
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(confirm).toBeHidden();
  await expect(row).toHaveCount(0);

  await searchShop(page, sku);
  await expect(page.getByRole("article").filter({ hasText: name })).toHaveCount(0);
});
