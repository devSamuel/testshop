import { Badge, Button, SimpleGrid, Table, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconRefresh } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "../../../api/admin";
import { errorMessage } from "../../../api/client";
import { queryKeys } from "../../../api/queryKeys";
import type { OutboxFailure } from "../../../api/types";
import { QueryState } from "../../../components/QueryState";
import { StatCard } from "../../../components/StatCard";
import { formatCount, formatDateTime, formatDuration } from "../../../lib/format";
import { SectionCard } from "./SectionCard";
import { useOutbox } from "./useSystemQueries";

const STALE_PENDING_SECONDS = 60;

function FailuresTable({ failures }: { failures: OutboxFailure[] }) {
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: (id: string) => adminApi.retryOutboxEvent(id),
    onSuccess: () => {
      notifications.show({
        color: "green",
        title: "Event re-queued",
        message: "It will be retried shortly.",
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.outbox });
    },
    onError: (error) => {
      notifications.show({ color: "red", title: "Retry failed", message: errorMessage(error) });
    },
  });

  if (failures.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        No failed deliveries.
      </Text>
    );
  }

  return (
    <Table.ScrollContainer minWidth={640}>
      <Table verticalSpacing="xs" aria-label="Recent outbox failures">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Event</Table.Th>
            <Table.Th ta="right">Attempts</Table.Th>
            <Table.Th>Last error</Table.Th>
            <Table.Th>State</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {failures.map((failure) => (
            <Table.Tr key={failure.id}>
              <Table.Td>
                <Text size="sm" ff="monospace">
                  {failure.event_type}
                </Text>
                <Text size="xs" c="dimmed">
                  {failure.aggregate_type} #{failure.aggregate_id} ·{" "}
                  {formatDateTime(failure.occurred_at)}
                </Text>
              </Table.Td>
              <Table.Td ta="right">{failure.attempts}</Table.Td>
              <Table.Td>
                <Text size="xs" lineClamp={2} title={failure.last_error ?? undefined} maw={260}>
                  {failure.last_error ?? "—"}
                </Text>
              </Table.Td>
              <Table.Td>
                {failure.failed_at ? (
                  <Badge color="red" variant="light">
                    Dead-lettered
                  </Badge>
                ) : (
                  <Badge color="yellow" variant="light">
                    Retrying
                  </Badge>
                )}
              </Table.Td>
              <Table.Td ta="right">
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<IconRefresh size={14} aria-hidden />}
                  loading={retry.isPending && retry.variables === failure.id}
                  onClick={() => retry.mutate(failure.id)}
                  aria-label={`Retry ${failure.event_type} event`}
                >
                  Retry
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

export function OutboxCard() {
  const outbox = useOutbox();
  return (
    <SectionCard
      id="outbox-health"
      title="Outbox health"
      description="Domain events waiting to be delivered to their handlers."
    >
      <QueryState query={outbox} errorTitle="Could not load outbox statistics">
        {(stats) => (
          <>
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
              <StatCard
                label="Pending"
                value={formatCount(stats.pending)}
                color={stats.pending > 0 ? "yellow.8" : undefined}
              />
              <StatCard label="Published" value={formatCount(stats.published)} color="green" />
              <StatCard
                label="Dead-lettered"
                value={formatCount(stats.dead_lettered)}
                color={stats.dead_lettered > 0 ? "red" : undefined}
              />
              <StatCard
                label="Oldest pending"
                value={formatDuration(stats.oldest_pending_seconds)}
                color={
                  (stats.oldest_pending_seconds ?? 0) > STALE_PENDING_SECONDS ? "orange" : undefined
                }
              />
            </SimpleGrid>
            <FailuresTable failures={stats.recent_failures} />
          </>
        )}
      </QueryState>
    </SectionCard>
  );
}
