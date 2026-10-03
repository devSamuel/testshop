import type { ImportStatus, OrderStatus } from "../api/types";

export interface StatusMeta {
  color: string;
  label: string;
}

export const ORDER_STATUS_META: Record<OrderStatus, StatusMeta> = {
  paid: { color: "green", label: "Paid" },
  pending_payment: { color: "yellow", label: "Pending payment" },
  payment_failed: { color: "red", label: "Payment failed" },
  expired: { color: "gray", label: "Expired" },
};

export const IMPORT_STATUS_META: Record<ImportStatus, StatusMeta> = {
  dry_run: { color: "blue", label: "Dry run" },
  running: { color: "yellow", label: "Running" },
  completed: { color: "green", label: "Completed" },
  rejected: { color: "red", label: "Rejected" },
  failed: { color: "red", label: "Failed" },
};

export function orderStatusMeta(status: string): StatusMeta {
  return status in ORDER_STATUS_META
    ? ORDER_STATUS_META[status as OrderStatus]
    : { color: "gray", label: status };
}

export function importStatusMeta(status: string): StatusMeta {
  return status in IMPORT_STATUS_META
    ? IMPORT_STATUS_META[status as ImportStatus]
    : { color: "gray", label: status };
}
