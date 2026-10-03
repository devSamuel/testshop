import { createContext, use, type Dispatch } from "react";
import type { Cents } from "../../lib/money";
import type { CartAction, CartState } from "./cartReducer";

export interface CartContextValue {
  state: CartState;
  dispatch: Dispatch<CartAction>;
  itemCount: number;
  subtotalCents: Cents;
}

export const CartContext = createContext<CartContextValue | null>(null);

export function useCart(): CartContextValue {
  const context = use(CartContext);
  if (!context) throw new Error("useCart must be used inside <CartProvider>");
  return context;
}
