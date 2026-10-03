import { Alert, Anchor, Button, Group, List, Loader, Stack, Text } from "@mantine/core";
import {
  IconAlertTriangle,
  IconClockOff,
  IconCreditCardOff,
  IconPackageOff,
  IconWifiOff,
} from "@tabler/icons-react";
import { Link } from "react-router-dom";
import type { StockShortage } from "../../api/types";
import type { CartLine } from "../cart/cartReducer";
import type { CheckoutPhase } from "./useCheckout";

interface CheckoutStatusProps {
  phase: CheckoutPhase;
  lines: readonly CartLine[];
  onAdjustQuantities: () => void;
  onDismiss: () => void;
}

function shortageLabel(shortage: StockShortage, lines: readonly CartLine[]): string {
  const line = lines.find((candidate) => candidate.productId === shortage.product_id);
  return line?.name ?? shortage.sku ?? `Product #${shortage.product_id}`;
}

function shortageDetail(shortage: StockShortage): string {
  if (shortage.available <= 0) return `requested ${shortage.requested}, none left`;
  return `requested ${shortage.requested}, only ${shortage.available} available`;
}

export function CheckoutStatus({
  phase,
  lines,
  onAdjustQuantities,
  onDismiss,
}: CheckoutStatusProps) {
  switch (phase.status) {
    case "idle":
    case "submitting":
      return null;
    case "confirming":
      return (
        <Alert color="blue" variant="light" icon={<Loader size={18} />} title="Confirming payment…">
          <Text size="sm">
            Your bank is taking a little longer than usual. We&apos;ll update this page as soon as
            the payment settles.
          </Text>
          <Anchor component={Link} to={`/orders/${phase.order.id}`} size="sm">
            Track order #{phase.order.id}
          </Anchor>
        </Alert>
      );
    case "declined":
      return (
        <Alert
          color="red"
          variant="light"
          icon={<IconCreditCardOff aria-hidden />}
          title="Card declined"
          withCloseButton
          closeButtonLabel="Dismiss"
          onClose={onDismiss}
        >
          <Stack gap={4}>
            <Text size="sm">{phase.message}</Text>
            <Text size="sm">Your cart is unchanged. Please try a different card.</Text>
            {phase.order ? (
              <Anchor component={Link} to={`/orders/${phase.order.id}`} size="sm">
                View declined order #{phase.order.id}
              </Anchor>
            ) : null}
          </Stack>
        </Alert>
      );
    case "expired":
      return (
        <Alert
          color="gray"
          variant="light"
          icon={<IconClockOff aria-hidden />}
          title="Payment window expired"
          withCloseButton
          closeButtonLabel="Dismiss"
          onClose={onDismiss}
        >
          The payment did not complete in time and the reserved stock was released. Please try
          again.
        </Alert>
      );
    case "insufficient-stock":
      return (
        <Alert
          color="orange"
          variant="light"
          icon={<IconPackageOff aria-hidden />}
          title="Some items are no longer available in the requested quantity"
        >
          <Stack gap="sm">
            <List size="sm" spacing={4}>
              {phase.shortages.map((shortage) => (
                <List.Item key={shortage.product_id}>
                  <Text span fw={600} size="sm">
                    {shortageLabel(shortage, lines)}
                  </Text>
                  : {shortageDetail(shortage)}
                </List.Item>
              ))}
            </List>
            <Group gap="xs">
              <Button size="xs" color="orange" onClick={onAdjustQuantities}>
                Adjust quantities
              </Button>
              <Button size="xs" variant="subtle" color="gray" onClick={onDismiss}>
                Dismiss
              </Button>
            </Group>
          </Stack>
        </Alert>
      );
    case "retryable-error":
      return (
        <Alert
          color="yellow"
          variant="light"
          icon={<IconWifiOff aria-hidden />}
          title="We couldn't confirm your order"
        >
          {phase.message}
        </Alert>
      );
    case "error":
      return (
        <Alert
          color="red"
          variant="light"
          icon={<IconAlertTriangle aria-hidden />}
          title="Checkout failed"
          withCloseButton
          closeButtonLabel="Dismiss"
          onClose={onDismiss}
        >
          <Text size="sm">{phase.message}</Text>
          {phase.details.length > 0 ? (
            <List size="sm" mt={4}>
              {phase.details.map((detail) => (
                <List.Item key={detail}>{detail}</List.Item>
              ))}
            </List>
          ) : null}
        </Alert>
      );
  }
}
