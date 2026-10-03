import type { Product, ProductCreateInput, ProductUpdateInput } from "../../../api/types";
import { formatScaled, parseScaled } from "../../../lib/money";

export interface ProductFormValues {
  sku: string;
  name: string;
  description: string;
  category: string;
  price: string;
  stock: number | string;
  weightKg: string;
}

export type ProductField = keyof ProductFormValues;

export type ProductFormErrors = Partial<Record<ProductField, string>>;

export const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;
export const PRICE_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;
export const WEIGHT_PATTERN = /^\d{1,7}(\.\d{1,3})?$/;
export const MAX_STOCK = 10_000_000;
export const MAX_NAME_LENGTH = 255;
export const MAX_DESCRIPTION_LENGTH = 5000;
export const MAX_CATEGORY_LENGTH = 100;

const PRICE_SCALE = 2;
const WEIGHT_SCALE = 3;
const UNCATEGORIZED = "uncategorized";

export function normalizeSku(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function categoryKey(value: string): string {
  return collapseWhitespace(value).toLowerCase() || UNCATEGORIZED;
}

export function parseStock(value: number | string): number | null {
  const stock = typeof value === "number" ? value : value.trim() === "" ? NaN : Number(value);
  return Number.isSafeInteger(stock) && stock >= 0 && stock <= MAX_STOCK ? stock : null;
}

export function productToFormValues(product?: Product | null): ProductFormValues {
  if (!product) {
    return {
      sku: "",
      name: "",
      description: "",
      category: "",
      price: "",
      stock: 0,
      weightKg: "",
    };
  }
  return {
    sku: product.sku,
    name: product.name,
    description: product.description,
    category: product.category,
    price: product.price,
    stock: product.stock,
    weightKg: product.weight_kg ?? "",
  };
}

export function validateProductForm(values: ProductFormValues): ProductFormErrors {
  const errors: ProductFormErrors = {};
  const sku = normalizeSku(values.sku);
  if (!sku) errors.sku = "SKU is required";
  else if (!SKU_PATTERN.test(sku)) {
    errors.sku = "Use 1–64 letters, digits, '.', '_', '/' or '-', starting with a letter or digit";
  }

  const name = collapseWhitespace(values.name);
  if (!name) errors.name = "Name is required";
  else if (name.length > MAX_NAME_LENGTH) errors.name = `At most ${MAX_NAME_LENGTH} characters`;

  if (values.description.length > MAX_DESCRIPTION_LENGTH) {
    errors.description = `At most ${MAX_DESCRIPTION_LENGTH} characters`;
  }
  if (collapseWhitespace(values.category).length > MAX_CATEGORY_LENGTH) {
    errors.category = `At most ${MAX_CATEGORY_LENGTH} characters`;
  }

  const price = values.price.trim();
  if (!price) errors.price = "Price is required";
  else if (!PRICE_PATTERN.test(price)) {
    errors.price = "Enter a non-negative amount with at most 2 decimals";
  }

  if (parseStock(values.stock) === null) {
    errors.stock = `Enter a whole number between 0 and ${MAX_STOCK.toLocaleString("en-US")}`;
  }

  const weight = values.weightKg.trim();
  if (weight && !WEIGHT_PATTERN.test(weight)) {
    errors.weightKg = "Enter a non-negative weight with at most 3 decimals";
  }
  return errors;
}

function normalizeScaled(value: string, scale: number): string {
  const units = parseScaled(value, scale);
  if (units === null) throw new RangeError(`Invalid decimal: ${value}`);
  return formatScaled(units, scale);
}

export function buildCreatePayload(values: ProductFormValues): Required<ProductCreateInput> {
  const stock = parseStock(values.stock);
  if (stock === null) throw new RangeError("Invalid stock");
  const weight = values.weightKg.trim();
  return {
    sku: normalizeSku(values.sku),
    name: collapseWhitespace(values.name),
    description: values.description,
    category: collapseWhitespace(values.category),
    price: normalizeScaled(values.price, PRICE_SCALE),
    stock,
    weight_kg: weight ? normalizeScaled(weight, WEIGHT_SCALE) : null,
  };
}

function sameScaled(left: string | null, right: string | null, scale: number): boolean {
  if (left === null || right === null) return left === right;
  return parseScaled(left, scale) === parseScaled(right, scale);
}

export function buildUpdatePayload(
  original: Product,
  values: ProductFormValues,
): ProductUpdateInput | null {
  const next = buildCreatePayload(values);
  const changes: Partial<ProductCreateInput> = {};
  if (next.sku !== original.sku) changes.sku = next.sku;
  if (next.name !== original.name) changes.name = next.name;
  if (next.description !== original.description) changes.description = next.description;
  if (categoryKey(next.category) !== categoryKey(original.category)) {
    changes.category = next.category;
  }
  if (!sameScaled(next.price, original.price, PRICE_SCALE)) changes.price = next.price;
  if (next.stock !== original.stock) changes.stock = next.stock;
  if (!sameScaled(next.weight_kg, original.weight_kg, WEIGHT_SCALE)) {
    changes.weight_kg = next.weight_kg;
  }
  if (Object.keys(changes).length === 0) return null;
  const precondition = changes.stock === undefined ? {} : { expected_stock: original.stock };
  return { version: original.version, ...changes, ...precondition };
}

export function hasProductChanges(original: Product, values: ProductFormValues): boolean {
  if (Object.keys(validateProductForm(values)).length > 0) return true;
  return buildUpdatePayload(original, values) !== null;
}

const SERVER_FIELDS: Readonly<Record<string, ProductField>> = {
  sku: "sku",
  name: "name",
  description: "description",
  category: "category",
  price: "price",
  stock: "stock",
  weight_kg: "weightKg",
};

export function mapProductServerErrors(fieldErrors: Readonly<Record<string, string>>): {
  formErrors: ProductFormErrors;
  otherMessages: string[];
} {
  const formErrors: ProductFormErrors = {};
  const otherMessages: string[] = [];
  for (const [field, message] of Object.entries(fieldErrors)) {
    const target = SERVER_FIELDS[field];
    if (target) formErrors[target] ??= message;
    else otherMessages.push(`${field}: ${message}`);
  }
  return { formErrors, otherMessages };
}
