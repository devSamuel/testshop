import { Anchor, Badge, Button, Switch, Table, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCheck } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { adminApi } from "../../../api/admin";
import { errorMessage } from "../../../api/client";
import { queryKeys } from "../../../api/queryKeys";
import type { StockAlert } from "../../../api/types";
import { QueryState } from "../../../components/QueryState";
import { formatDateTime } from "../../../lib/format";
import { SectionCard } from "./SectionCard";
import { useAlerts } from "./useSystemQueries";

const LEVELS: Record<string, { label: string; color: string }> = {
  low: { label: "Low stock", color: "orange" },
  out_of_stock: { label: "Out of stock", color: "red" },
};

function AlertsTable({ alerts }: { alerts: StockAlert[] }) {
  const queryClient = useQueryClient();
  const resolve = useMutation({
    mutationFn: (id: number) => adminApi.resolveAlert(id),
    onSuccess: () => {
      notifications.show({
        color: "green",
        title: "Alert resolved",
        message: "Marked as handled.",
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.alertsAll });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Could not resolve alert",
        message: errorMessage(error),
      });
    },
  });

  return (
    <Table.ScrollContainer minWidth={560}>
      <Table verticalSpacing="xs" aria-label="Stock alerts">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>SKU</Table.Th>
            <Table.Th>Level</Table.Th>
            <Table.Th ta="right">Stock / threshold</Table.Th>
            <Table.Th>Raised</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {alerts.map((alert) => {
            const level = LEVELS[alert.level] ?? { label: alert.level, color: "gray" };
            return (
              <Table.Tr key={alert.id}>
                <Table.Td>
                  <Anchor
                    component={Link}
                    to={`/admin/products/${alert.product_id}/history`}
                    size="sm"
                    ff="monospace"
                  >
                    {alert.sku}
                  </Anchor>
                </Table.Td>
                <Table.Td>
                  <Badge color={level.color} variant="light">
                    {level.label}
                  </Badge>
                </Table.Td>
                <Table.Td ta="right">
                  {alert.stock_at_alert} / {alert.threshold}
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{formatDateTime(alert.created_at)}</Text>
                </Table.Td>
                <Table.Td ta="right">
                  {alert.resolved_at ? (
                    <Text size="xs" c="dimmed">
                      Resolved {formatDateTime(alert.resolved_at)}
                    </Text>
                  ) : (
                    <Button
                      size="xs"
                      variant="light"
                      color="green"
                      leftSection={<IconCheck size={14} aria-hidden />}
                      loading={resolve.isPending && resolve.variables === alert.id}
                      onClick={() => resolve.mutate(alert.id)}
                      aria-label={`Resolve alert for ${alert.sku}`}
                    >
                      Resolve
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

export function AlertsCard() {
  const [includeResolved, setIncludeResolved] = useState(false);
  const alerts = useAlerts(includeResolved);
  return (
    <SectionCard
      id="stock-alerts"
      title="Stock alerts"
      description="Raised when stock drops to the low-stock threshold or runs out."
      actions={
        <Switch
          label="Show resolved"
          checked={includeResolved}
          onChange={(event) => setIncludeResolved(event.currentTarget.checked)}
        />
      }
    >
      <QueryState
        query={alerts}
        errorTitle="Could not load stock alerts"
        isEmpty={(data) => data.length === 0}
        empty={
          <Text size="sm" c="dimmed">
            {includeResolved ? "No stock alerts have been raised." : "No open stock alerts."}
          </Text>
        }
      >
        {(data) => <AlertsTable alerts={data} />}
      </QueryState>
    </SectionCard>
  );
}
