import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../../api/types";
import { jsonResponse } from "../../test/render";
import { waitForSettlement } from "./waitForSettlement";

function order(status: Order["status"]): Order {
  return {
    id: 7,
    status,
    email: "buyer@example.com",
    total: "10.00",
    currency: "USD",
    items: [],
    card_brand: "visa",
    card_last4: "0101",
    payment_ref: null,
    decline_reason: null,
    reservation_expires_at: "2026-10-02T12:10:00Z",
    created_at: "2026-10-02T12:00:00Z",
    updated_at: "2026-10-02T12:00:00Z",
    paid_at: null,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("waitForSettlement", () => {
  it("polls every interval until the order leaves pending_payment", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(order("pending_payment")))
      .mockResolvedValueOnce(new Response("upstream down", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(order("paid")));
    vi.stubGlobal("fetch", fetchMock);
    const updates: string[] = [];

    const settled = waitForSettlement(7, {
      signal: new AbortController().signal,
      intervalMs: 1500,
      onUpdate: (current) => updates.push(current.status),
    });
    await vi.advanceTimersByTimeAsync(1500 * 3);

    await expect(settled).resolves.toMatchObject({ status: "paid" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/orders/7");
    expect(updates).toEqual(["pending_payment", "paid"]);
  });

  it("gives up on non-retryable errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, { status: 404 })),
    );
    const settled = waitForSettlement(7, { signal: new AbortController().signal, intervalMs: 10 });
    const assertion = expect(settled).rejects.toMatchObject({ status: 404 });
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
  });

  it("stops when aborted", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const settled = waitForSettlement(7, { signal: controller.signal, intervalMs: 1000 });
    const assertion = expect(settled).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await assertion;
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
