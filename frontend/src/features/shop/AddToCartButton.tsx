import { Button, type ButtonProps } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconShoppingCartPlus } from "@tabler/icons-react";
import type { Product } from "../../api/types";
import { useCart } from "../cart/cartContext";
import { remainingForProduct } from "../cart/cartReducer";

interface AddToCartButtonProps extends Omit<ButtonProps, "children"> {
  product: Product;
  quantity?: number;
}

export function AddToCartButton({ product, quantity = 1, ...props }: AddToCartButtonProps) {
  const { state, dispatch } = useCart();
  const remaining = remainingForProduct(state, product);
  const outOfStock = product.stock <= 0;
  const label = outOfStock ? "Out of stock" : remaining === 0 ? "Max in cart" : "Add to cart";

  const add = () => {
    dispatch({ type: "add", product, quantity });
    notifications.show({
      color: "green",
      title: "Added to cart",
      message: quantity > 1 ? `${quantity} × ${product.name}` : product.name,
      autoClose: 2500,
    });
  };

  return (
    <Button
      leftSection={<IconShoppingCartPlus size={16} aria-hidden />}
      disabled={outOfStock || remaining < quantity}
      onClick={add}
      aria-label={outOfStock ? `${product.name} is out of stock` : `Add ${product.name} to cart`}
      {...props}
    >
      {label}
    </Button>
  );
}
