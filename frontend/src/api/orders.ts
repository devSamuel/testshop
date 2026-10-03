import { apiFetch, apiRequest } from "./client";
import type { CheckoutRequest, Order, OrderPage, OrderStatus } from "./types";

export interface PlacedOrder {
  order: Order;
  replayed: boolean;
}

export interface OrderListQuery {
  page: number;
  pageSize: number;
  status: OrderStatus | null;
}

export const ordersApi = {
  place: async (
    request: CheckoutRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<PlacedOrder> => {
    const response = await apiRequest<Order>("/api/orders", {
      method: "POST",
      json: request,
      headers: { "Idempotency-Key": idempotencyKey },
      signal,
    });
    return {
      order: response.data,
      replayed: response.headers.get("Idempotent-Replayed") === "true",
    };
  },

  get: (id: number, signal?: AbortSignal) => apiFetch<Order>(`/api/orders/${id}`, { signal }),

  list: ({ page, pageSize, status }: OrderListQuery, signal?: AbortSignal) =>
    apiFetch<OrderPage>("/api/orders", {
      query: { page, page_size: pageSize, status },
      signal,
    }),
};
