import { notifications } from "@mantine/notifications";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, errorMessage, isAbortError } from "../../api/client";
import { ordersApi } from "../../api/orders";
import { queryKeys } from "../../api/queryKeys";
import type { Order, StockShortage } from "../../api/types";
import { IdempotencyKeyManager } from "../../lib/idempotency";
import { useCart } from "../cart/cartContext";
import { declinedOrderFrom, declineMessage, shortagesFrom } from "./checkoutErrors";
import {
  buildCheckoutRequest,
  checkoutFingerprint,
  mapServerErrors,
  type CheckoutFormErrors,
  type CheckoutFormValues,
} from "./validation";
import { waitForSettlement } from "./waitForSettlement";

export type CheckoutPhase =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "confirming"; order: Order }
  | { status: "declined"; order: Order | null; message: string }
  | { status: "expired"; order: Order }
  | { status: "insufficient-stock"; shortages: StockShortage[] }
  | { status: "retryable-error"; message: string }
  | { status: "error"; message: string; details: string[] };

export interface CheckoutController {
  phase: CheckoutPhase;
  busy: boolean;
  submit: (values: CheckoutFormValues) => Promise<CheckoutFormErrors | undefined>;
  adjustQuantities: () => void;
  dismiss: () => void;
}

export interface PlacedOrderState {
  placed: true;
}

const IDLE: CheckoutPhase = { status: "idle" };

const RETRY_IS_SAFE = "Retrying is safe: you will not be charged twice.";

function retryableMessage(error: unknown): string {
  if (error instanceof ApiError && error.isNetworkError) {
    return `We couldn't reach the server, so the order may not have been placed. ${RETRY_IS_SAFE}`;
  }
  return `The server couldn't confirm your order. ${RETRY_IS_SAFE}`;
}

export function useCheckout(): CheckoutController {
  const { state: cart, dispatch } = useCart();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [keys] = useState(() => new IdempotencyKeyManager());
  const [phase, setPhase] = useState<CheckoutPhase>(IDLE);
  const lifetime = useRef<AbortController | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);

  const cacheOrder = useCallback(
    (order: Order) => {
      queryClient.setQueryData(queryKeys.orders.detail(order.id), order);
    },
    [queryClient],
  );

  const refreshCatalog = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
  }, [queryClient]);

  const finish = useCallback(
    (order: Order) => {
      keys.reset();
      refreshCatalog();
      switch (order.status) {
        case "paid":
          dispatch({ type: "clear" });
          setPhase(IDLE);
          notifications.show({
            color: "green",
            title: "Payment confirmed",
            message: `Order #${order.id} has been placed.`,
          });
          if (!lifetime.current?.signal.aborted) {
            const state: PlacedOrderState = { placed: true };
            void navigate(`/orders/${order.id}`, { state });
          }
          return;
        case "payment_failed":
          setPhase({ status: "declined", order, message: declineMessage(order.decline_reason) });
          return;
        case "expired":
          setPhase({ status: "expired", order });
          return;
        case "pending_payment":
          setPhase({ status: "confirming", order });
          return;
      }
    },
    [dispatch, keys, navigate, refreshCatalog],
  );

  const fail = useCallback(
    (error: unknown): CheckoutFormErrors | undefined => {
      if (isAbortError(error)) return undefined;
      if (!(error instanceof ApiError) || error.isRetryable) {
        setPhase({ status: "retryable-error", message: retryableMessage(error) });
        return undefined;
      }

      keys.reset();
      if (error.status === 402) {
        const order = declinedOrderFrom(error.problem);
        if (order) cacheOrder(order);
        refreshCatalog();
        setPhase({ status: "declined", order, message: declineMessage(order?.decline_reason) });
        return undefined;
      }
      if (error.status === 409 && error.is("insufficient-stock")) {
        refreshCatalog();
        setPhase({ status: "insufficient-stock", shortages: shortagesFrom(error.problem) });
        return undefined;
      }
      if (error.is("idempotency-key-reused")) {
        setPhase({
          status: "error",
          message:
            "This checkout attempt was already used for a different order. Please submit again.",
          details: [],
        });
        return undefined;
      }
      const { formErrors, otherMessages } = mapServerErrors(error.fieldErrors);
      setPhase({ status: "error", message: errorMessage(error), details: otherMessages });
      return formErrors;
    },
    [cacheOrder, keys, refreshCatalog],
  );

  const submit = useCallback(
    async (values: CheckoutFormValues): Promise<CheckoutFormErrors | undefined> => {
      if (inFlight.current || cart.lines.length === 0) return undefined;
      inFlight.current = true;
      const request = buildCheckoutRequest(values, cart.lines);
      const idempotencyKey = keys.keyFor(checkoutFingerprint(request));
      setPhase({ status: "submitting" });
      try {
        const { order } = await ordersApi.place(request, idempotencyKey);
        cacheOrder(order);
        if (order.status !== "pending_payment") {
          finish(order);
          return undefined;
        }
        setPhase({ status: "confirming", order });
        const signal = lifetime.current?.signal ?? new AbortController().signal;
        const settled = await waitForSettlement(order.id, { signal, onUpdate: cacheOrder });
        finish(settled);
        return undefined;
      } catch (error) {
        return fail(error);
      } finally {
        inFlight.current = false;
      }
    },
    [cacheOrder, cart.lines, fail, finish, keys],
  );

  const adjustQuantities = useCallback(() => {
    if (phase.status !== "insufficient-stock") return;
    dispatch({ type: "clampToAvailable", shortages: phase.shortages });
    setPhase(IDLE);
    notifications.show({
      color: "blue",
      title: "Cart updated",
      message: "Quantities now match the stock that is available.",
    });
  }, [dispatch, phase]);

  const dismiss = useCallback(() => setPhase(IDLE), []);

  return {
    phase,
    busy: phase.status === "submitting" || phase.status === "confirming",
    submit,
    adjustQuantities,
    dismiss,
  };
}
