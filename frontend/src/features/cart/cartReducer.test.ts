import { describe, expect, it } from "vitest";
import {
  cartItemCount,
  cartReducer,
  cartSubtotalCents,
  EMPTY_CART,
  MAX_QUANTITY_PER_LINE,
  remainingForProduct,
  sanitizeCart,
  type CartProductSnapshot,
  type CartState,
} from "./cartReducer";

const headphones: CartProductSnapshot = {
  id: 1,
  sku: "ELEC-1001",
  name: "Headphones",
  price: "199.99",
  stock: 5,
};

const keyboard: CartProductSnapshot = {
  id: 2,
  sku: "ELEC-1002",
  name: "Keyboard",
  price: "0.10",
  stock: 1000,
};

function cartWith(...steps: [CartProductSnapshot, number][]): CartState {
  return steps.reduce(
    (state, [product, quantity]) => cartReducer(state, { type: "add", product, quantity }),
    EMPTY_CART,
  );
}

describe("cartReducer", () => {
  it("adds a product as a new line with a snapshot of price and stock", () => {
    const state = cartWith([headphones, 2]);
    expect(state.lines).toEqual([
      {
        productId: 1,
        sku: "ELEC-1001",
        name: "Headphones",
        unitPrice: "199.99",
        stock: 5,
        quantity: 2,
      },
    ]);
  });

  it("merges repeated adds into one line", () => {
    const state = cartWith([headphones, 1], [headphones, 2]);
    expect(state.lines).toHaveLength(1);
    expect(state.lines[0]?.quantity).toBe(3);
  });

  it("never exceeds the stock snapshot", () => {
    const state = cartWith([headphones, 4], [headphones, 4]);
    expect(state.lines[0]?.quantity).toBe(5);
    expect(remainingForProduct(state, headphones)).toBe(0);
  });

  it("caps a line at the per-line maximum accepted by the API", () => {
    const state = cartWith([keyboard, 500]);
    expect(state.lines[0]?.quantity).toBe(MAX_QUANTITY_PER_LINE);
  });

  it("ignores out-of-stock products", () => {
    const state = cartWith([{ ...headphones, stock: 0 }, 1]);
    expect(state).toBe(EMPTY_CART);
  });

  it("refreshes the snapshot when the same product is added again", () => {
    const state = cartWith([headphones, 1], [{ ...headphones, price: "149.99", stock: 3 }, 1]);
    expect(state.lines[0]).toMatchObject({ unitPrice: "149.99", stock: 3, quantity: 2 });
  });

  it("clamps setQuantity between 1 and the stock", () => {
    const state = cartWith([headphones, 2]);
    const tooMany = cartReducer(state, { type: "setQuantity", productId: 1, quantity: 99 });
    expect(tooMany.lines[0]?.quantity).toBe(5);
    const tooFew = cartReducer(state, { type: "setQuantity", productId: 1, quantity: 0 });
    expect(tooFew.lines[0]?.quantity).toBe(1);
    const unchanged = cartReducer(state, { type: "setQuantity", productId: 1, quantity: 2 });
    expect(unchanged).toBe(state);
  });

  it("removes a line and clears the cart", () => {
    const state = cartWith([headphones, 1], [keyboard, 1]);
    const removed = cartReducer(state, { type: "remove", productId: 1 });
    expect(removed.lines.map((line) => line.productId)).toEqual([2]);
    expect(cartReducer(removed, { type: "clear" })).toEqual(EMPTY_CART);
  });

  it("clamps quantities to what a 409 insufficient-stock response reports", () => {
    const state = cartWith([headphones, 4], [keyboard, 3]);
    const adjusted = cartReducer(state, {
      type: "clampToAvailable",
      shortages: [
        { product_id: 1, available: 2 },
        { product_id: 2, available: 0 },
      ],
    });
    expect(adjusted.lines).toEqual([
      expect.objectContaining({ productId: 1, quantity: 2, stock: 2 }),
    ]);
  });

  it("leaves lines that are not short untouched when clamping", () => {
    const state = cartWith([headphones, 1], [keyboard, 3]);
    const adjusted = cartReducer(state, {
      type: "clampToAvailable",
      shortages: [{ product_id: 2, available: 10 }],
    });
    expect(adjusted.lines).toEqual([
      state.lines[0],
      expect.objectContaining({ productId: 2, quantity: 3, stock: 10 }),
    ]);
  });
});

describe("cart totals", () => {
  it("counts items and sums the subtotal in integer cents", () => {
    const state = cartWith([headphones, 2], [keyboard, 3]);
    expect(cartItemCount(state)).toBe(5);
    expect(cartSubtotalCents(state)).toBe(2 * 19999 + 3 * 10);
  });
});

describe("sanitizeCart", () => {
  it("drops malformed persisted data", () => {
    expect(sanitizeCart(null)).toEqual(EMPTY_CART);
    expect(sanitizeCart({ lines: "nope" })).toEqual(EMPTY_CART);
    expect(
      sanitizeCart({
        lines: [
          { productId: 1, sku: "A", name: "A", unitPrice: "abc", stock: 5, quantity: 1 },
          { productId: 2, sku: "B", name: "B", unitPrice: "1.00", stock: 2, quantity: 9 },
          { productId: "3" },
        ],
      }),
    ).toEqual({
      lines: [{ productId: 2, sku: "B", name: "B", unitPrice: "1.00", stock: 2, quantity: 2 }],
    });
  });
});
