import type { OrderListQuery } from "./orders";
import type { ProductSearchQuery } from "./types";

export const queryKeys = {
  products: {
    all: ["products"] as const,
    search: (query: ProductSearchQuery) => ["products", "search", query] as const,
    detail: (id: number) => ["products", "detail", id] as const,
    movements: (id: number) => ["products", "movements", id] as const,
  },
  categories: ["categories"] as const,
  orders: {
    all: ["orders"] as const,
    list: (query: OrderListQuery) => ["orders", "list", query] as const,
    detail: (id: number) => ["orders", "detail", id] as const,
  },
  imports: {
    all: ["imports"] as const,
    list: (limit: number) => ["imports", "list", limit] as const,
    detail: (runId: string) => ["imports", "detail", runId] as const,
  },
  admin: {
    all: ["admin"] as const,
    invariants: ["admin", "invariants"] as const,
    outbox: ["admin", "outbox"] as const,
    alertsAll: ["admin", "alerts"] as const,
    alerts: (includeResolved: boolean) => ["admin", "alerts", includeResolved] as const,
    notifications: (limit: number) => ["admin", "notifications", limit] as const,
    readiness: ["admin", "readiness"] as const,
  },
};
