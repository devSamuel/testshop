import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const officialFile = fileURLToPath(new URL("../../data/products.csv", import.meta.url));

test("the provided example file shows its planted problems in a dry run, then imports", async ({
  page,
}) => {
  await page.goto("/admin/import");
  await page.locator('input[type="file"]').setInputFiles(officialFile);

  await expect(
    page.getByText("88 valid rows will be imported; 7 invalid rows will be skipped."),
  ).toBeVisible();
  const severity = page.getByRole("radiogroup", { name: "Filter issues by severity" });
  await expect(severity).toContainText("Errors (7)");
  await expect(severity).toContainText("Warnings (6)");
  await expect(page.getByRole("table", { name: "Import issues" })).toContainText("free");

  await page.getByRole("button", { name: "Confirm import" }).click();
  await expect(page.getByRole("alert", { name: "Import completed" })).toBeVisible();
});
