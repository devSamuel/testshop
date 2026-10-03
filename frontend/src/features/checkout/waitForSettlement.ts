import { ApiError } from "../../api/client";
import { ordersApi } from "../../api/orders";
import type { Order } from "../../api/types";

export const ORDER_POLL_INTERVAL_MS = 1500;
export const MAX_CONSECUTIVE_POLL_ERRORS = 5;

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abortError = () => new DOMException("The wait was aborted", "AbortError");
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface WaitForSettlementOptions {
  signal: AbortSignal;
  intervalMs?: number;
  maxConsecutiveErrors?: number;
  onUpdate?: (order: Order) => void;
}

export async function waitForSettlement(
  orderId: number,
  {
    signal,
    intervalMs = ORDER_POLL_INTERVAL_MS,
    maxConsecutiveErrors = MAX_CONSECUTIVE_POLL_ERRORS,
    onUpdate,
  }: WaitForSettlementOptions,
): Promise<Order> {
  let consecutiveErrors = 0;
  for (;;) {
    await sleep(intervalMs, signal);
    try {
      const order = await ordersApi.get(orderId, signal);
      consecutiveErrors = 0;
      onUpdate?.(order);
      if (order.status !== "pending_payment") return order;
    } catch (error) {
      consecutiveErrors += 1;
      const transient = error instanceof ApiError && error.isRetryable;
      if (!transient || consecutiveErrors >= maxConsecutiveErrors) throw error;
    }
  }
}
