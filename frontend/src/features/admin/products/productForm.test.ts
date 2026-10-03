import { describe, expect, it } from "vitest";
import type { Product } from "../../../api/types";
import {
  buildCreatePayload,
  buildUpdatePayload,
  hasProductChanges,
  mapProductServerErrors,
  productToFormValues,
  validateProductForm,
  type ProductFormValues,
} from "./productForm";

const product: Product = {
  id: 7,
  sku: "ELEC-1001",
  name: "Wireless Headphones",
  description: "Over-ear",
  category: "Electronics",
  price: "199.99",
  stock: 25,
  weight_kg: "0.250",
  version: 3,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

function form(overrides: Partial<ProductFormValues> = {}): ProductFormValues {
  return { ...productToFormValues(product), ...overrides };
}

describe("validateProductForm", () => {
  it("accepts a valid product", () => {
    expect(validateProductForm(form())).toEqual({});
  });

  it("mirrors backend constraints", () => {
    expect(
      validateProductForm(
        form({
          sku: "-bad",
          name: "   ",
          price: "1.999",
          stock: 1.5,
          weightKg: "-1",
        }),
      ),
    ).toEqual({
      sku: expect.stringContaining("letters, digits") as string,
      name: "Name is required",
      price: "Enter a non-negative amount with at most 2 decimals",
      stock: expect.stringContaining("whole number") as string,
      weightKg: "Enter a non-negative weight with at most 3 decimals",
    });
  });

  it("accepts lower-case SKUs with allowed punctuation", () => {
    expect(validateProductForm(form({ sku: "abc.1_2/3-4" })).sku).toBeUndefined();
    expect(validateProductForm(form({ sku: "x".repeat(65) })).sku).toBeDefined();
  });
});

describe("buildCreatePayload", () => {
  it("normalises values like the backend does", () => {
    expect(
      buildCreatePayload({
        sku: " elec 2000 ",
        name: "  Desk   Lamp ",
        description: "Warm light",
        category: " lighting ",
        price: "12.5",
        stock: "4",
        weightKg: "1.2",
      }),
    ).toEqual({
      sku: "ELEC2000",
      name: "Desk Lamp",
      description: "Warm light",
      category: "lighting",
      price: "12.50",
      stock: 4,
      weight_kg: "1.200",
    });
  });

  it("sends a null weight when left blank", () => {
    expect(buildCreatePayload(form({ weightKg: "" })).weight_kg).toBeNull();
  });
});

describe("buildUpdatePayload", () => {
  it("returns null when nothing meaningful changed", () => {
    expect(
      buildUpdatePayload(
        product,
        form({
          price: "199.990".slice(0, 6),
          weightKg: "0.25",
          category: "electronics",
          sku: "elec-1001",
        }),
      ),
    ).toBeNull();
    expect(hasProductChanges(product, form())).toBe(false);
  });

  it("sends the version and only the changed fields", () => {
    expect(buildUpdatePayload(product, form({ price: "149.99" }))).toEqual({
      version: 3,
      price: "149.99",
    });
  });

  it("guards a stock edit with the stock the admin saw", () => {
    expect(buildUpdatePayload(product, form({ stock: 30 }))).toEqual({
      version: 3,
      stock: 30,
      expected_stock: product.stock,
    });
  });

  it("can clear the weight", () => {
    expect(buildUpdatePayload(product, form({ weightKg: "" }))).toEqual({
      version: 3,
      weight_kg: null,
    });
  });
});

describe("mapProductServerErrors", () => {
  it("maps API field names to form fields", () => {
    expect(mapProductServerErrors({ weight_kg: "Too many digits", version: "Required" })).toEqual({
      formErrors: { weightKg: "Too many digits" },
      otherMessages: ["version: Required"],
    });
  });
});
