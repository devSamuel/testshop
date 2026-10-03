import {
  Anchor,
  Button,
  Loader,
  Paper,
  ScrollArea,
  SegmentedControl,
  Table,
  Text,
} from "@mantine/core";
import { IconReceipt } from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { ordersApi, type OrderListQuery } from "../../api/orders";
import { queryKeys } from "../../api/queryKeys";
import type { Order, OrderStatus } from "../../api/types";
import { AppPagination } from "../../components/AppPagination";
import { EmptyState } from "../../components/EmptyState";
import { MoneyText } from "../../components/MoneyText";
import { PageHeader } from "../../components/PageHeader";
import { QueryState } from "../../components/QueryState";
import { OrderStatusBadge } from "../../components/StatusBadge";
import { ORDER_STATUS_META } from "../../components/statusMeta";
import { formatDateTime } from "../../lib/format";
import { pageCount, parsePageParam } from "../../lib/pagination";

const PAGE_SIZE = 20;
const LIST_REFRESH_MS = 3000;

const STATUS_FILTERS: { value: OrderStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "paid", label: "Paid" },
  { value: "pending_payment", label: "Pending" },
  { value: "payment_failed", label: "Failed" },
  { value: "expired", label: "Expired" },
];

function parseStatus(value: string | null): OrderStatus | null {
  return value !== null && value in ORDER_STATUS_META ? (value as OrderStatus) : null;
}

function itemCount(order: Order): number {
  return order.items.reduce((total, item) => total + item.quantity, 0);
}

function OrdersTable({ orders }: { orders: Order[] }) {
  return (
    <Table.ScrollContainer minWidth={760}>
      <Table verticalSpacing="sm" highlightOnHover aria-label="Orders">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Order</Table.Th>
            <Table.Th>Placed</Table.Th>
            <Table.Th>Customer</Table.Th>
            <Table.Th ta="right">Items</Table.Th>
            <Table.Th ta="right">Total</Table.Th>
            <Table.Th>Payment</Table.Th>
            <Table.Th>Status</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {orders.map((order) => (
            <Table.Tr key={order.id}>
              <Table.Td>
                <Anchor component={Link} to={`/orders/${order.id}`} fw={600}>
                  #{order.id}
                </Anchor>
              </Table.Td>
              <Table.Td>{formatDateTime(order.created_at)}</Table.Td>
              <Table.Td>
                <Text size="sm" truncate maw={220}>
                  {order.email}
                </Text>
              </Table.Td>
              <Table.Td ta="right">{itemCount(order)}</Table.Td>
              <Table.Td ta="right">
                <MoneyText value={order.total} currency={order.currency} size="sm" fw={600} />
              </Table.Td>
              <Table.Td>
                <Text size="sm" tt="capitalize">
                  {order.card_brand} •••• {order.card_last4}
                </Text>
              </Table.Td>
              <Table.Td>
                <OrderStatusBadge status={order.status} />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

export default function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const status = parseStatus(params.get("status"));
  const page = parsePageParam(params.get("page"));
  const listQuery: OrderListQuery = { page, pageSize: PAGE_SIZE, status };

  const orders = useQuery({
    queryKey: queryKeys.orders.list(listQuery),
    queryFn: ({ signal }) => ordersApi.list(listQuery, signal),
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      query.state.data?.items.some((order) => order.status === "pending_payment")
        ? LIST_REFRESH_MS
        : false,
  });

  const updateParams = (next: { status?: OrderStatus | null; page?: number }) => {
    const nextStatus = next.status === undefined ? status : next.status;
    const nextPage = next.page ?? 1;
    const search = new URLSearchParams();
    if (nextStatus) search.set("status", nextStatus);
    if (nextPage > 1) search.set("page", String(nextPage));
    setParams(search);
  };

  return (
    <>
      <PageHeader
        title="Orders"
        description="Every checkout attempt, including declined and expired ones."
        actions={orders.isFetching ? <Loader size="xs" aria-label="Refreshing orders" /> : null}
      />
      <ScrollArea type="never" mb="md">
        <SegmentedControl
          aria-label="Filter by status"
          data={STATUS_FILTERS}
          value={status ?? "all"}
          onChange={(value) => updateParams({ status: parseStatus(value) })}
        />
      </ScrollArea>
      <QueryState
        query={orders}
        errorTitle="Could not load orders"
        isEmpty={(data) => data.items.length === 0}
        empty={
          <EmptyState
            icon={<IconReceipt size={30} stroke={1.5} />}
            title={status ? "No orders with this status" : "No orders yet"}
            description={
              status ? "Try a different status filter." : "Orders appear here after checkout."
            }
            action={
              status ? (
                <Button variant="light" onClick={() => updateParams({ status: null })}>
                  Show all orders
                </Button>
              ) : (
                <Button component={Link} to="/">
                  Start shopping
                </Button>
              )
            }
          />
        }
      >
        {(data) => (
          <>
            <Paper withBorder radius="md">
              <OrdersTable orders={data.items} />
            </Paper>
            <AppPagination
              total={pageCount(data.total, PAGE_SIZE)}
              value={page}
              onChange={(next) => updateParams({ page: next })}
            />
          </>
        )}
      </QueryState>
    </>
  );
}
