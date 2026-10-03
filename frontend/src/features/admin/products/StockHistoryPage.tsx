import { Anchor, Badge, Button, Center, Group, Paper, Stack, Table, Text } from "@mantine/core";
import { IconArrowLeft, IconHistory } from "@tabler/icons-react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { isNotFound } from "../../../api/client";
import { productsApi, STOCK_MOVEMENTS_PAGE_SIZE } from "../../../api/products";
import { queryKeys } from "../../../api/queryKeys";
import type { MovementReason, StockMovement } from "../../../api/types";
import { EmptyState } from "../../../components/EmptyState";
import { ErrorState } from "../../../components/ErrorState";
import { LoadingState } from "../../../components/LoadingState";
import { PageHeader } from "../../../components/PageHeader";
import { StockBadge } from "../../../components/StockBadge";
import { formatDateTime, shortId } from "../../../lib/format";
import { parseRouteId } from "../../../lib/routeParams";

const REASONS: Record<MovementReason, { label: string; color: string }> = {
  import: { label: "Import", color: "blue" },
  admin_adjustment: { label: "Admin adjustment", color: "violet" },
  reservation: { label: "Reservation", color: "orange" },
  reservation_released: { label: "Reservation released", color: "teal" },
};

function ReasonBadge({ reason }: { reason: string }) {
  const meta =
    reason in REASONS ? REASONS[reason as MovementReason] : { label: reason, color: "gray" };
  return (
    <Badge variant="light" color={meta.color}>
      {meta.label}
    </Badge>
  );
}

function Delta({ value }: { value: number }) {
  const positive = value > 0;
  return (
    <Text
      size="sm"
      fw={600}
      c={positive ? "green" : "red"}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {positive ? `+${value}` : `−${Math.abs(value)}`}
    </Text>
  );
}

function Reference({ movement }: { movement: StockMovement }) {
  const { reference_type: type, reference_id: id } = movement;
  if (!type || !id)
    return (
      <Text size="sm" c="dimmed">
        —
      </Text>
    );
  if (type === "order") {
    return (
      <Anchor component={Link} to={`/orders/${id}`} size="sm">
        Order #{id}
      </Anchor>
    );
  }
  if (type === "import_run") {
    return (
      <Anchor component={Link} to={`/admin/import?run=${encodeURIComponent(id)}`} size="sm">
        Import run {shortId(id)}
      </Anchor>
    );
  }
  return (
    <Text size="sm">
      Admin{" "}
      <Text span c="dimmed" size="sm">
        ({id})
      </Text>
    </Text>
  );
}

export default function StockHistoryPage() {
  const productId = parseRouteId(useParams().id);
  const id = productId ?? 0;
  const product = useQuery({
    queryKey: queryKeys.products.detail(id),
    queryFn: ({ signal }) => productsApi.get(id, signal),
    enabled: productId !== null,
  });
  const movements = useInfiniteQuery({
    queryKey: queryKeys.products.movements(id),
    queryFn: ({ pageParam, signal }) => productsApi.stockMovements(id, pageParam, signal),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.length === STOCK_MOVEMENTS_PAGE_SIZE ? lastPage.at(-1)?.id : undefined,
    enabled: productId !== null,
  });

  const back = (
    <Anchor
      component={Link}
      to="/admin/products"
      size="sm"
      mb="md"
      style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
    >
      <IconArrowLeft size={14} aria-hidden /> Products
    </Anchor>
  );

  if (productId === null || isNotFound(product.error) || isNotFound(movements.error)) {
    return (
      <>
        {back}
        <PageHeader title="Stock history" />
        <EmptyState title="Product not found" description="It may have been deleted." />
      </>
    );
  }

  const rows = movements.data?.pages.flat() ?? [];

  return (
    <>
      {back}
      <PageHeader
        title={product.data ? product.data.name : "Stock history"}
        documentTitle="Stock history"
        description={
          product.data ? (
            <Group gap="xs" component="span">
              <Text span ff="monospace">
                {product.data.sku}
              </Text>
              <Text span>· {product.data.stock} in stock</Text>
              <StockBadge stock={product.data.stock} size="sm" />
            </Group>
          ) : (
            "Every change to this product's stock, newest first."
          )
        }
      />
      {movements.data === undefined ? (
        movements.isError ? (
          <ErrorState
            title="Could not load stock movements"
            error={movements.error}
            onRetry={() => void movements.refetch()}
          />
        ) : (
          <LoadingState label="Loading stock movements…" />
        )
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<IconHistory size={30} stroke={1.5} />}
          title="No stock movements yet"
          description="Imports, admin adjustments and orders will be recorded here."
        />
      ) : (
        <Stack gap="md">
          <Paper withBorder radius="md">
            <Table.ScrollContainer minWidth={720}>
              <Table verticalSpacing="sm" aria-label="Stock movements">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>When</Table.Th>
                    <Table.Th ta="right">Change</Table.Th>
                    <Table.Th ta="right">Balance after</Table.Th>
                    <Table.Th>Reason</Table.Th>
                    <Table.Th>Reference</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((movement) => (
                    <Table.Tr key={movement.id}>
                      <Table.Td>
                        <Text size="sm">{formatDateTime(movement.created_at)}</Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Delta value={movement.delta} />
                      </Table.Td>
                      <Table.Td ta="right" style={{ fontVariantNumeric: "tabular-nums" }}>
                        {movement.balance_after}
                      </Table.Td>
                      <Table.Td>
                        <ReasonBadge reason={movement.reason} />
                      </Table.Td>
                      <Table.Td>
                        <Reference movement={movement} />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Paper>
          {movements.isFetchNextPageError ? (
            <ErrorState
              title="Could not load more movements"
              error={movements.error}
              onRetry={() => void movements.fetchNextPage()}
            />
          ) : null}
          <Center>
            {movements.hasNextPage ? (
              <Button
                variant="light"
                loading={movements.isFetchingNextPage}
                onClick={() => void movements.fetchNextPage()}
              >
                Load more
              </Button>
            ) : (
              <Text size="sm" c="dimmed">
                Showing all {rows.length} movements
              </Text>
            )}
          </Center>
        </Stack>
      )}
    </>
  );
}
