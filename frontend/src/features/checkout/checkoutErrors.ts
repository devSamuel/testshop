import { isProblemDetails, isRecord, type ProblemDetails } from "../../api/client";
import type { Order, StockShortage } from "../../api/types";

export function declinedOrderFrom(problem: ProblemDetails | null): Order | null {
  const order = problem?.order;
  if (!isRecord(order) || typeof order.id !== "number" || typeof order.status !== "string") {
    return null;
  }
  return order as unknown as Order;
}

function isShortage(value: unknown): value is StockShortage {
  return (
    isRecord(value) &&
    typeof value.product_id === "number" &&
    typeof value.requested === "number" &&
    typeof value.available === "number"
  );
}

export function shortagesFrom(problem: ProblemDetails | null): StockShortage[] {
  const items = isProblemDetails(problem) ? problem.items : undefined;
  if (!Array.isArray(items)) return [];
  return (items as unknown[]).filter(isShortage);
}

const DECLINE_MESSAGES: Readonly<Record<string, string>> = {
  card_declined: "The card issuer declined this payment.",
  insufficient_funds: "The card has insufficient funds.",
  expired_card: "The card has expired.",
};

export function declineMessage(reason: string | null | undefined): string {
  if (!reason) return "Your card was declined.";
  return DECLINE_MESSAGES[reason] ?? `Your card was declined (${reason.replace(/_/g, " ")}).`;
}
