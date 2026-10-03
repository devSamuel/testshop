import { useQuery } from "@tanstack/react-query";
import { ordersApi } from "../../api/orders";
import { queryKeys } from "../../api/queryKeys";
import { ORDER_POLL_INTERVAL_MS } from "../checkout/waitForSettlement";

export function useOrder(orderId: number | null) {
  return useQuery({
    queryKey: queryKeys.orders.detail(orderId ?? 0),
    queryFn: ({ signal }) => ordersApi.get(orderId ?? 0, signal),
    enabled: orderId !== null,
    refetchInterval: (query) =>
      query.state.data?.status === "pending_payment" ? ORDER_POLL_INTERVAL_MS : false,
  });
}
