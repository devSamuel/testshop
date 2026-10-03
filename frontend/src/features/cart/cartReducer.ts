import type { Product, StockShortage } from "../../api/types";
import { multiplyCents, parseCents, sumCents, type Cents } from "../../lib/money";

export const MAX_QUANTITY_PER_LINE = 100;
export const MAX_CART_LINES = 50;

export interface CartLine {
  productId: number;
  sku: string;
  name: string;
  unitPrice: string;
  stock: number;
  quantity: number;
}

export interface CartState {
  lines: CartLine[];
}

export type CartProductSnapshot = Pick<Product, "id" | "sku" | "name" | "price" | "stock">;

export type CartAction =
  | { type: "add"; product: CartProductSnapshot; quantity: number }
  | { type: "setQuantity"; productId: number; quantity: number }
  | { type: "remove"; productId: number }
  | { type: "clear" }
  | {
      type: "clampToAvailable";
      shortages: readonly Pick<StockShortage, "product_id" | "available">[];
    }
  | { type: "replace"; state: CartState };

export const EMPTY_CART: CartState = { lines: [] };

export function maxQuantity(stock: number): number {
  return Math.max(0, Math.min(Math.trunc(stock), MAX_QUANTITY_PER_LINE));
}

function clampQuantity(quantity: number, stock: number, min: number): number {
  if (!Number.isFinite(quantity)) return min;
  return Math.min(Math.max(Math.trunc(quantity), min), maxQuantity(stock));
}

function addLine(state: CartState, product: CartProductSnapshot, quantity: number): CartState {
  const existing = state.lines.find((line) => line.productId === product.id);
  const requested = (existing?.quantity ?? 0) + quantity;
  const nextQuantity = clampQuantity(requested, product.stock, 0);
  const snapshot: CartLine = {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    unitPrice: product.price,
    stock: product.stock,
    quantity: nextQuantity,
  };
  if (!existing) {
    if (nextQuantity === 0 || state.lines.length >= MAX_CART_LINES) return state;
    return { lines: [...state.lines, snapshot] };
  }
  if (nextQuantity === 0) {
    return { lines: state.lines.filter((line) => line.productId !== product.id) };
  }
  return {
    lines: state.lines.map((line) => (line.productId === product.id ? snapshot : line)),
  };
}

function setQuantity(state: CartState, productId: number, quantity: number): CartState {
  const line = state.lines.find((candidate) => candidate.productId === productId);
  if (!line) return state;
  if (maxQuantity(line.stock) === 0) {
    return { lines: state.lines.filter((candidate) => candidate.productId !== productId) };
  }
  const next = clampQuantity(quantity, line.stock, 1);
  if (next === line.quantity) return state;
  return {
    lines: state.lines.map((candidate) =>
      candidate.productId === productId ? { ...candidate, quantity: next } : candidate,
    ),
  };
}

function clampToAvailable(
  state: CartState,
  shortages: readonly Pick<StockShortage, "product_id" | "available">[],
): CartState {
  const available = new Map(
    shortages.map((item) => [item.product_id, Math.max(0, item.available)]),
  );
  const lines = state.lines
    .map((line) => {
      const stock = available.get(line.productId);
      if (stock === undefined) return line;
      return { ...line, stock, quantity: Math.min(line.quantity, maxQuantity(stock)) };
    })
    .filter((line) => line.quantity > 0);
  return { lines };
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "add":
      return addLine(state, action.product, action.quantity);
    case "setQuantity":
      return setQuantity(state, action.productId, action.quantity);
    case "remove":
      return { lines: state.lines.filter((line) => line.productId !== action.productId) };
    case "clear":
      return EMPTY_CART;
    case "clampToAvailable":
      return clampToAvailable(state, action.shortages);
    case "replace":
      return action.state;
  }
}

export function cartItemCount(state: CartState): number {
  return state.lines.reduce((total, line) => total + line.quantity, 0);
}

export function lineTotalCents(line: CartLine): Cents {
  return multiplyCents(parseCents(line.unitPrice), line.quantity);
}

export function cartSubtotalCents(state: CartState): Cents {
  return sumCents(state.lines.map(lineTotalCents));
}

export function quantityInCart(state: CartState, productId: number): number {
  return state.lines.find((line) => line.productId === productId)?.quantity ?? 0;
}

export function remainingForProduct(
  state: CartState,
  product: Pick<Product, "id" | "stock">,
): number {
  return Math.max(0, maxQuantity(product.stock) - quantityInCart(state, product.id));
}

function isCartLine(value: unknown): value is CartLine {
  if (typeof value !== "object" || value === null) return false;
  const line = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(line.productId) &&
    typeof line.sku === "string" &&
    typeof line.name === "string" &&
    typeof line.unitPrice === "string" &&
    Number.isSafeInteger(line.stock) &&
    Number.isSafeInteger(line.quantity)
  );
}

export function sanitizeCart(value: unknown): CartState {
  if (typeof value !== "object" || value === null) return EMPTY_CART;
  const lines = (value as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return EMPTY_CART;
  const valid = (lines as unknown[])
    .filter(isCartLine)
    .filter((line) => {
      try {
        parseCents(line.unitPrice);
        return true;
      } catch {
        return false;
      }
    })
    .map((line) => ({ ...line, quantity: clampQuantity(line.quantity, line.stock, 0) }))
    .filter((line) => line.quantity > 0);
  return { lines: valid.slice(0, MAX_CART_LINES) };
}
