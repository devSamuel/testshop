import { Button, Divider, Grid, Group, Paper, Stack, Text } from "@mantine/core";
import { IconShoppingCart } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { EmptyState } from "../../components/EmptyState";
import { MoneyText } from "../../components/MoneyText";
import { PageHeader } from "../../components/PageHeader";
import { pluralize } from "../../lib/format";
import { CheckoutPanel } from "../checkout/CheckoutPanel";
import { useCheckout } from "../checkout/useCheckout";
import { useCart } from "./cartContext";
import { CartLineItem } from "./CartLineItem";

export default function CartPage() {
  const { state, itemCount, subtotalCents } = useCart();
  const checkout = useCheckout();

  if (state.lines.length === 0) {
    return (
      <>
        <PageHeader title="Your cart" />
        <EmptyState
          icon={<IconShoppingCart size={30} stroke={1.5} />}
          title="Your cart is empty"
          description="Find something you like in the shop and it will show up here."
          action={
            <Button component={Link} to="/">
              Browse products
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Your cart" description={`${pluralize(itemCount, "item")} in your cart`} />
      <Grid gutter="xl">
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Stack gap="md">
            <Stack
              component="ul"
              gap="sm"
              aria-label="Cart items"
              style={{ listStyle: "none", padding: 0, margin: 0 }}
            >
              {state.lines.map((line) => (
                <CartLineItem key={line.productId} line={line} locked={checkout.busy} />
              ))}
            </Stack>
            <Paper withBorder radius="md" p="md">
              <Group justify="space-between">
                <Text fw={600}>Subtotal ({pluralize(itemCount, "item")})</Text>
                <MoneyText cents={subtotalCents} fw={700} size="lg" />
              </Group>
              <Divider my="sm" />
              <Text size="sm" c="dimmed">
                Prices and stock are re-validated at checkout.
              </Text>
            </Paper>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <CheckoutPanel checkout={checkout} />
        </Grid.Col>
      </Grid>
    </>
  );
}
