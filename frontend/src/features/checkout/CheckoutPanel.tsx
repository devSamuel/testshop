import { Card, Stack, Title } from "@mantine/core";
import { formatCents } from "../../lib/money";
import { useCart } from "../cart/cartContext";
import { CheckoutForm } from "./CheckoutForm";
import { CheckoutStatus } from "./CheckoutStatus";
import type { CheckoutController } from "./useCheckout";

interface CheckoutPanelProps {
  checkout: CheckoutController;
}

export function CheckoutPanel({ checkout }: CheckoutPanelProps) {
  const { state, subtotalCents } = useCart();
  const { phase } = checkout;
  const total = formatCents(subtotalCents);
  const submitLabel =
    phase.status === "confirming"
      ? "Confirming payment…"
      : phase.status === "retryable-error"
        ? `Retry payment of ${total}`
        : `Pay ${total}`;

  return (
    <Card withBorder radius="md" padding="lg" component="section" aria-labelledby="checkout-title">
      <Stack gap="md">
        <Title order={2} size="h4" id="checkout-title">
          Checkout
        </Title>
        <div aria-live="polite">
          <CheckoutStatus
            phase={phase}
            lines={state.lines}
            onAdjustQuantities={checkout.adjustQuantities}
            onDismiss={checkout.dismiss}
          />
        </div>
        <CheckoutForm
          onSubmit={checkout.submit}
          busy={checkout.busy}
          disabled={state.lines.length === 0}
          submitLabel={submitLabel}
        />
      </Stack>
    </Card>
  );
}
