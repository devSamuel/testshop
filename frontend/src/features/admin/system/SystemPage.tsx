import { Badge, Button, Grid, Group, Text, Tooltip } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../../api/queryKeys";
import { PageHeader } from "../../../components/PageHeader";
import { formatTime } from "../../../lib/format";
import { AlertsCard } from "./AlertsCard";
import { InvariantsCard } from "./InvariantsCard";
import { NotificationsCard } from "./NotificationsCard";
import { OutboxCard } from "./OutboxCard";
import { ReconcileCard } from "./ReconcileCard";
import { SYSTEM_REFRESH_MS, useOutbox, useReadiness } from "./useSystemQueries";

function ReadinessBadge() {
  const readiness = useReadiness();
  if (readiness.isPending) {
    return (
      <Badge color="gray" variant="light">
        Checking…
      </Badge>
    );
  }
  const ready = readiness.data?.status === "ok";
  return (
    <Tooltip
      label={ready ? "API and database are reachable" : "The API or database is unavailable"}
    >
      <Badge color={ready ? "green" : "red"} variant="dot" size="lg">
        {ready ? "API ready" : "API unavailable"}
      </Badge>
    </Tooltip>
  );
}

export default function SystemPage() {
  const queryClient = useQueryClient();
  const fetching = useIsFetching({ queryKey: queryKeys.admin.all });
  const { dataUpdatedAt: updatedAt } = useOutbox();

  return (
    <>
      <PageHeader
        title="System health"
        badge={<ReadinessBadge />}
        description={`Auto-refreshes every ${SYSTEM_REFRESH_MS / 1000}s${
          updatedAt ? ` · last updated ${formatTime(updatedAt)}` : ""
        }`}
        actions={
          <Group gap="sm">
            {fetching > 0 ? (
              <Text size="xs" c="dimmed" aria-live="polite">
                Refreshing…
              </Text>
            ) : null}
            <Button
              variant="default"
              leftSection={<IconRefresh size={16} aria-hidden />}
              onClick={() => void queryClient.invalidateQueries({ queryKey: queryKeys.admin.all })}
            >
              Refresh
            </Button>
          </Group>
        }
      />
      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <InvariantsCard />
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <OutboxCard />
        </Grid.Col>
        <Grid.Col span={12}>
          <ReconcileCard />
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <AlertsCard />
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <NotificationsCard />
        </Grid.Col>
      </Grid>
    </>
  );
}
