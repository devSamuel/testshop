import { useEffect, useMemo, useReducer, type ReactNode } from "react";
import { parseJson, readJson, writeJson } from "../../lib/storage";
import { CartContext, type CartContextValue } from "./cartContext";
import { cartItemCount, cartReducer, cartSubtotalCents, sanitizeCart } from "./cartReducer";

export const CART_STORAGE_KEY = "test-shop.cart.v1";

interface CartProviderProps {
  children: ReactNode;
  storageKey?: string;
}

function loadCart(storageKey: string) {
  return sanitizeCart(readJson(storageKey));
}

export function CartProvider({ children, storageKey = CART_STORAGE_KEY }: CartProviderProps) {
  const [state, dispatch] = useReducer(cartReducer, storageKey, loadCart);

  useEffect(() => {
    writeJson(storageKey, state);
  }, [state, storageKey]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      dispatch({ type: "replace", state: sanitizeCart(parseJson(event.newValue)) });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageKey]);

  const value = useMemo<CartContextValue>(
    () => ({
      state,
      dispatch,
      itemCount: cartItemCount(state),
      subtotalCents: cartSubtotalCents(state),
    }),
    [state],
  );

  return <CartContext value={value}>{children}</CartContext>;
}
