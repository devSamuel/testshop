import { Badge, type BadgeProps } from "@mantine/core";
import { stockStatus } from "./stock";

interface StockBadgeProps extends Omit<BadgeProps, "color" | "children"> {
  stock: number;
}

export function StockBadge({ stock, ...props }: StockBadgeProps) {
  const { color, label } = stockStatus(stock);
  return (
    <Badge color={color} variant="light" {...props}>
      {label}
    </Badge>
  );
}
