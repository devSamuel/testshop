import { apiFetch } from "./client";
import type {
  InvariantReport,
  OrderNotification,
  OutboxStats,
  Readiness,
  ReconcileResult,
  StockAlert,
} from "./types";

export const adminApi = {
  invariants: (signal?: AbortSignal) =>
    apiFetch<InvariantReport>("/api/admin/invariants", { signal }),

  outbox: (signal?: AbortSignal) => apiFetch<OutboxStats>("/api/admin/outbox", { signal }),

  retryOutboxEvent: (id: string) =>
    apiFetch<undefined>(`/api/admin/outbox/${encodeURIComponent(id)}/retry`, { method: "POST" }),

  alerts: (includeResolved: boolean, signal?: AbortSignal) =>
    apiFetch<StockAlert[]>("/api/admin/alerts", {
      query: { include_resolved: includeResolved },
      signal,
    }),

  resolveAlert: (id: number) =>
    apiFetch<undefined>(`/api/admin/alerts/${id}/resolve`, { method: "POST" }),

  notifications: (limit: number, signal?: AbortSignal) =>
    apiFetch<OrderNotification[]>("/api/admin/notifications", { query: { limit }, signal }),

  reconcile: () => apiFetch<ReconcileResult>("/api/admin/reconcile", { method: "POST" }),

  readiness: (signal?: AbortSignal) => apiFetch<Readiness>("/readyz", { signal }),
};
