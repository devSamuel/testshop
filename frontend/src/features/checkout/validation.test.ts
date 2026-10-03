import { describe, expect, it } from "vitest";
import type { CartLine } from "../cart/cartReducer";
import {
  buildCheckoutRequest,
  checkoutFingerprint,
  mapServerErrors,
  validateCheckout,
  type CheckoutFormValues,
} from "./validation";

const valid: CheckoutFormValues = {
  email: " buyer@example.com ",
  cardNumber: "4242 4242 4242 4242",
  expMonth: "12",
  expYear: "2030",
  cvc: "123",
};

const lines: CartLine[] = [
  { productId: 9, sku: "B", name: "B", unitPrice: "1.00", stock: 5, quantity: 2 },
  { productId: 3, sku: "A", name: "A", unitPrice: "2.00", stock: 5, quantity: 1 },
];

describe("validateCheckout", () => {
  const now = new Date(2026, 9, 2);

  it("accepts a valid form", () => {
    expect(validateCheckout(valid, now)).toEqual({});
  });

  it("rejects expired cards and malformed values", () => {
    expect(
      validateCheckout({ ...valid, expMonth: "9", expYear: "2026", cvc: "12", email: "" }, now),
    ).toEqual({ expMonth: "Card has expired", cvc: "3 or 4 digits", email: "Email is required" });
  });
});

describe("buildCheckoutRequest", () => {
  it("normalises the payload and sorts items for a stable fingerprint", () => {
    const request = buildCheckoutRequest(valid, lines);
    expect(request).toEqual({
      email: "buyer@example.com",
      items: [
        { product_id: 3, quantity: 1 },
        { product_id: 9, quantity: 2 },
      ],
      card: { number: "4242424242424242", exp_month: 12, exp_year: 2030, cvc: "123" },
    });
    expect(checkoutFingerprint(request)).toBe(
      checkoutFingerprint(buildCheckoutRequest(valid, [...lines].reverse())),
    );
  });
});

describe("checkoutFingerprint", () => {
  const fingerprint = (overrides: Partial<CheckoutFormValues>) =>
    checkoutFingerprint(buildCheckoutRequest({ ...valid, ...overrides }, lines));

  it("matches the order identity the server uses for idempotency", () => {
    expect(fingerprint({ cvc: "999", expMonth: "1", email: "BUYER@example.com" })).toBe(
      fingerprint({}),
    );
  });

  it("changes when the email, card or cart changes", () => {
    expect(fingerprint({ email: "other@example.com" })).not.toBe(fingerprint({}));
    expect(fingerprint({ cardNumber: "4000 0000 0000 0002" })).not.toBe(fingerprint({}));
    expect(checkoutFingerprint(buildCheckoutRequest(valid, lines.slice(1)))).not.toBe(
      fingerprint({}),
    );
  });
});

describe("mapServerErrors", () => {
  it("routes backend field paths to form fields", () => {
    expect(
      mapServerErrors({
        "card.cvc": "String should match pattern",
        card: "Card is expired",
        "items.0.quantity": "Input should be less than or equal to 100",
      }),
    ).toEqual({
      formErrors: { cvc: "String should match pattern", expMonth: "Card is expired" },
      otherMessages: ["items.0.quantity: Input should be less than or equal to 100"],
    });
  });
});
