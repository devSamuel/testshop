import {
  Alert,
  Anchor,
  Button,
  Card,
  Grid,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import {
  IconArrowLeft,
  IconCircleCheck,
  IconClockOff,
  IconCreditCardOff,
  IconReceipt,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { isNotFound, isRecord } from "../../api/client";
import type { Order } from "../../api/types";
import { EmptyState } from "../../components/EmptyState";
import { MoneyText } from "../../components/MoneyText";
import { PageHeader } from "../../components/PageHeader";
import { QueryState } from "../../components/QueryState";
import { OrderStatusBadge } from "../../components/StatusBadge";
import { formatDateTime } from "../../lib/format";
import { parseRouteId } from "../../lib/routeParams";
import { declineMessage } from "../checkout/checkoutErrors";
import { useOrder } from "./useOrder";

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text size="sm" ta="right" style={{ overflowWrap: "anywhere" }} component="div">
        {children}
      </Text>
    </Group>
  );
}

function OrderBanner({ order, justPlaced }: { order: Order; justPlaced: boolean }) {
  switch (order.status) {
    case "paid":
      return justPlaced ? (
        <Alert
          color="green"
          variant="light"
          icon={<IconCircleCheck aria-hidden />}
          title="Thank you!"
        >
          Your payment was confirmed and your order is on its way.
        </Alert>
      ) : null;
    case "pending_payment":
      return (
        <Alert
          color="yellow"
          variant="light"
          icon={<Loader size={18} />}
          title="Confirming payment…"
        >
          We&apos;re waiting for the payment provider. This page refreshes automatically. Stock is
          reserved until {formatDateTime(order.reservation_expires_at)}.
        </Alert>
      );
    case "payment_failed":
      return (
        <Alert
          color="red"
          variant="light"
          icon={<IconCreditCardOff aria-hidden />}
          title="Payment declined"
        >
          {declineMessage(order.decline_reason)} No charge was made and the reserved stock was
          released.
        </Alert>
      );
    case "expired":
      return (
        <Alert color="gray" variant="light" icon={<IconClockOff aria-hidden />} title="Expired">
          The payment did not complete in time, so the reservation was released.
        </Alert>
      );
  }
}

function OrderDetail({ order, justPlaced }: { order: Order; justPlaced: boolean }) {
  return (
    <Stack gap="lg">
      <PageHeader
        title={`Order #${order.id}`}
        badge={<OrderStatusBadge status={order.status} size="lg" />}
        description={`Placed ${formatDateTime(order.created_at)}`}
      />
      <OrderBanner order={order} justPlaced={justPlaced} />
      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Card withBorder radius="md" padding={0}>
            <Table.ScrollContainer minWidth={520}>
              <Table verticalSpacing="sm" horizontalSpacing="md" aria-label="Order items">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Product</Table.Th>
                    <Table.Th ta="right">Unit price</Table.Th>
                    <Table.Th ta="right">Qty</Table.Th>
                    <Table.Th ta="right">Total</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {order.items.map((item) => (
                    <Table.Tr key={item.product_id}>
                      <Table.Td>
                        <Anchor component={Link} to={`/products/${item.product_id}`} size="sm">
                          {item.name}
                        </Anchor>
                        <Text size="xs" c="dimmed" ff="monospace">
                          {item.sku}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <MoneyText value={item.unit_price} currency={order.currency} size="sm" />
                      </Table.Td>
                      <Table.Td ta="right">{item.quantity}</Table.Td>
                      <Table.Td ta="right">
                        <MoneyText value={item.line_total} currency={order.currency} size="sm" />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
                <Table.Tfoot>
                  <Table.Tr>
                    <Table.Th colSpan={3} ta="right">
                      Total
                    </Table.Th>
                    <Table.Th ta="right">
                      <MoneyText value={order.total} currency={order.currency} fw={700} />
                    </Table.Th>
                  </Table.Tr>
                </Table.Tfoot>
              </Table>
            </Table.ScrollContainer>
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Card withBorder radius="md" padding="lg">
            <Stack gap="sm">
              <Title order={2} size="h5">
                Summary
              </Title>
              <SummaryRow label="Email">{order.email}</SummaryRow>
              <SummaryRow label="Card">
                <Text span size="sm" tt="capitalize">
                  {order.card_brand}
                </Text>{" "}
                •••• {order.card_last4}
              </SummaryRow>
              <SummaryRow label="Total">
                <MoneyText value={order.total} currency={order.currency} size="sm" fw={600} />
              </SummaryRow>
              {order.payment_ref ? (
                <SummaryRow label="Payment ref">
                  <Text span ff="monospace" size="xs">
                    {order.payment_ref}
                  </Text>
                </SummaryRow>
              ) : null}
              {order.paid_at ? (
                <SummaryRow label="Paid">{formatDateTime(order.paid_at)}</SummaryRow>
              ) : null}
              {order.status === "pending_payment" ? (
                <SummaryRow label="Reserved until">
                  {formatDateTime(order.reservation_expires_at)}
                </SummaryRow>
              ) : null}
              <SummaryRow label="Last update">{formatDateTime(order.updated_at)}</SummaryRow>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

function wasJustPlaced(state: unknown): boolean {
  return isRecord(state) && state.placed === true;
}

export default function OrderDetailPage() {
  const orderId = parseRouteId(useParams().id);
  const location = useLocation();
  const order = useOrder(orderId);

  const back = (
    <Anchor
      component={Link}
      to="/orders"
      size="sm"
      mb="md"
      style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
    >
      <IconArrowLeft size={14} aria-hidden /> All orders
    </Anchor>
  );

  if (orderId === null || isNotFound(order.error)) {
    return (
      <>
        {back}
        <PageHeader title="Order not found" />
        <EmptyState
          icon={<IconReceipt size={30} stroke={1.5} />}
          title="We couldn't find this order"
          action={
            <Button component={Link} to="/orders">
              View all orders
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      {back}
      <QueryState query={order} errorTitle="Could not load this order">
        {(data) => <OrderDetail order={data} justPlaced={wasJustPlaced(location.state)} />}
      </QueryState>
    </>
  );
}
