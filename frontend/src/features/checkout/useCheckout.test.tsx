import { act } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../../api/types";
import { jsonResponse, problemResponse, renderHookWithProviders } from "../../test/render";
import { useCart } from "../cart/cartContext";
import { CART_STORAGE_KEY } from "../cart/CartProvider";
import type { CartState } from "../cart/cartReducer";
import { useCheckout } from "./useCheckout";
import type { CheckoutFormValues } from "./validation";

const values: CheckoutFormValues = {
  email: "buyer@example.com",
  cardNumber: "4242 4242 4242 4242",
  expMonth: "12",
  expYear: String(new Date().getFullYear() + 2),
  cvc: "123",
};

const seededCart: CartState = {
  lines: [
    {
      productId: 1,
      sku: "ELEC-1001",
      name: "Headphones",
      unitPrice: "199.99",
      stock: 5,
      quantity: 3,
    },
    {
      productId: 2,
      sku: "ELEC-1002",
      name: "Keyboard",
      unitPrice: "89.50",
      stock: 40,
      quantity: 1,
    },
  ],
};

function order(status: Order["status"], overrides: Partial<Order> = {}): Order {
  return {
    id: 42,
    status,
    email: values.email,
    total: "689.47",
    currency: "USD",
    items: [],
    card_brand: "visa",
    card_last4: "4242",
    payment_ref: status === "paid" ? "ch_123" : null,
    decline_reason: status === "payment_failed" ? "card_declined" : null,
    reservation_expires_at: "2026-10-02T12:10:00Z",
    created_at: "2026-10-02T12:00:00Z",
    updated_at: "2026-10-02T12:00:00Z",
    paid_at: status === "paid" ? "2026-10-02T12:00:01Z" : null,
    ...overrides,
  };
}

function stubFetch(...responses: (Response | Error | DOMException)[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) {
    if (response instanceof Response) fetchMock.mockResolvedValueOnce(response);
    else fetchMock.mockRejectedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function idempotencyKeyOf(fetchMock: ReturnType<typeof stubFetch>, call: number): string | null {
  const init = fetchMock.mock.calls[call]?.[1];
  return new Headers(init?.headers).get("Idempotency-Key");
}

function renderCheckout() {
  return renderHookWithProviders(
    () => ({ checkout: useCheckout(), cart: useCart(), location: useLocation() }),
    { route: "/cart" },
  );
}

beforeEach(() => {
  window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(seededCart));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useCheckout", () => {
  it("reuses the idempotency key after a network error and clears the cart on success", async () => {
    const fetchMock = stubFetch(
      new TypeError("Failed to fetch"),
      jsonResponse(order("paid"), { status: 201 }),
    );
    const { result } = renderCheckout();

    await act(() => result.current.checkout.submit(values));
    expect(result.current.checkout.phase.status).toBe("retryable-error");
    expect(result.current.cart.state.lines).toHaveLength(2);

    await act(() => result.current.checkout.submit(values));

    const firstKey = idempotencyKeyOf(fetchMock, 0);
    expect(firstKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(idempotencyKeyOf(fetchMock, 1)).toBe(firstKey);
    expect(result.current.cart.state.lines).toHaveLength(0);
    expect(result.current.location.pathname).toBe("/orders/42");
  });

  it("reuses the key after a 5xx response", async () => {
    const fetchMock = stubFetch(
      problemResponse(503, "unavailable"),
      jsonResponse(order("paid"), { status: 200, headers: { "Idempotent-Replayed": "true" } }),
    );
    const { result } = renderCheckout();

    await act(() => result.current.checkout.submit(values));
    await act(() => result.current.checkout.submit(values));

    expect(idempotencyKeyOf(fetchMock, 1)).toBe(idempotencyKeyOf(fetchMock, 0));
    expect(result.current.location.pathname).toBe("/orders/42");
  });

  it("keeps the cart on a decline and uses a fresh key for the next attempt", async () => {
    const declined = order("payment_failed");
    const fetchMock = stubFetch(
      problemResponse(402, "payment-declined", { order: declined }),
      jsonResponse(order("paid", { id: 43 }), { status: 201 }),
    );
    const { result } = renderCheckout();

    await act(() => result.current.checkout.submit(values));
    expect(result.current.checkout.phase).toMatchObject({
      status: "declined",
      order: { id: 42 },
    });
    expect(result.current.cart.state.lines).toHaveLength(2);

    await act(() => result.current.checkout.submit(values));
    expect(idempotencyKeyOf(fetchMock, 1)).not.toBe(idempotencyKeyOf(fetchMock, 0));
    expect(result.current.location.pathname).toBe("/orders/43");
  });

  it("generates a new key when the payload changes", async () => {
    const fetchMock = stubFetch(new TypeError("offline"), new TypeError("offline"));
    const { result } = renderCheckout();

    await act(() => result.current.checkout.submit(values));
    await act(() => result.current.checkout.submit({ ...values, email: "other@example.com" }));

    expect(idempotencyKeyOf(fetchMock, 1)).not.toBe(idempotencyKeyOf(fetchMock, 0));
  });

  it("keeps the key when only the CVC or expiry is corrected after a network error", async () => {
    const fetchMock = stubFetch(
      new TypeError("offline"),
      jsonResponse(order("paid"), { status: 200, headers: { "Idempotent-Replayed": "true" } }),
    );
    const { result } = renderCheckout();

    await act(() => result.current.checkout.submit(values));
    await act(() => result.current.checkout.submit({ ...values, cvc: "456" }));

    expect(idempotencyKeyOf(fetchMock, 1)).toBe(idempotencyKeyOf(fetchMock, 0));
  });

  it("reports stock shortages and clamps the cart on request", async () => {
    stubFetch(
      problemResponse(409, "insufficient-stock", {
        items: [
          { product_id: 1, sku: "ELEC-1001", requested: 3, available: 1 },
          { product_id: 2, sku: "ELEC-1002", requested: 1, available: 0 },
        ],
      }),
    );
    const { result } = renderCheckout();

    await act(() => result.current.checkout.submit(values));
    expect(result.current.checkout.phase).toMatchObject({
      status: "insufficient-stock",
      shortages: [
        { product_id: 1, available: 1 },
        { product_id: 2, available: 0 },
      ],
    });

    act(() => result.current.checkout.adjustQuantities());
    expect(result.current.checkout.phase.status).toBe("idle");
    expect(result.current.cart.state.lines).toEqual([
      expect.objectContaining({ productId: 1, quantity: 1, stock: 1 }),
    ]);
  });

  it("returns server field errors for the form", async () => {
    stubFetch(
      problemResponse(422, "validation-error", {
        errors: [{ field: "card", message: "Value error, Card is expired" }],
      }),
    );
    const { result } = renderCheckout();

    let errors: unknown;
    await act(async () => {
      errors = await result.current.checkout.submit(values);
    });

    expect(errors).toEqual({ expMonth: "Card is expired" });
    expect(result.current.checkout.phase.status).toBe("error");
  });

  it("polls a 202 order until the payment is confirmed", async () => {
    vi.useFakeTimers();
    const fetchMock = stubFetch(
      jsonResponse(order("pending_payment"), { status: 202 }),
      jsonResponse(order("pending_payment")),
      jsonResponse(order("paid")),
    );
    const { result } = renderCheckout();

    let submission: Promise<unknown> = Promise.resolve();
    act(() => {
      submission = result.current.checkout.submit(values);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.checkout.phase.status).toBe("confirming");
    expect(result.current.checkout.busy).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(result.current.checkout.phase.status).toBe("confirming");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
      await submission;
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/orders/42");
    expect(result.current.cart.state.lines).toHaveLength(0);
    expect(result.current.location.pathname).toBe("/orders/42");
  });

  it("shows a decline that happens while confirming and keeps the cart", async () => {
    vi.useFakeTimers();
    stubFetch(
      jsonResponse(order("pending_payment"), { status: 202 }),
      jsonResponse(order("payment_failed")),
    );
    const { result } = renderCheckout();

    let submission: Promise<unknown> = Promise.resolve();
    act(() => {
      submission = result.current.checkout.submit(values);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
      await submission;
    });

    expect(result.current.checkout.phase.status).toBe("declined");
    expect(result.current.cart.state.lines).toHaveLength(2);
  });
});
