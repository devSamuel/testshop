import { Badge, Loader, type BadgeProps } from "@mantine/core";
import { importStatusMeta, orderStatusMeta } from "./statusMeta";

interface OrderStatusBadgeProps extends Omit<BadgeProps, "color" | "children"> {
  status: string;
}

export function OrderStatusBadge({ status, ...props }: OrderStatusBadgeProps) {
  const { color, label } = orderStatusMeta(status);
  const pending = status === "pending_payment";
  return (
    <Badge
      color={color}
      variant="light"
      leftSection={pending ? <Loader size={10} color={color} aria-hidden /> : undefined}
      {...props}
    >
      {label}
    </Badge>
  );
}

interface ImportStatusBadgeProps extends Omit<BadgeProps, "color" | "children"> {
  status: string;
}

export function ImportStatusBadge({ status, ...props }: ImportStatusBadgeProps) {
  const { color, label } = importStatusMeta(status);
  return (
    <Badge color={color} variant="light" {...props}>
      {label}
    </Badge>
  );
}
