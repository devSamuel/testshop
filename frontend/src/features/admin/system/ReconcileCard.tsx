import { Button, SimpleGrid, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPlayerPlay } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { adminApi } from "../../../api/admin";
import { errorMessage } from "../../../api/client";
import { queryKeys } from "../../../api/queryKeys";
import type { ReconcileResult } from "../../../api/types";
import { ErrorState } from "../../../components/ErrorState";
import { StatCard } from "../../../components/StatCard";
import { formatCount, formatTime } from "../../../lib/format";
import { SectionCard } from "./SectionCard";

const SKIPPED_MESSAGE =
  "A worker's reconciler is running right now; only one runs at a time. Try again in a few seconds.";

interface ReconcileRun {
  result: ReconcileResult;
  at: number;
}

export function ReconcileCard() {
  const queryClient = useQueryClient();
  const [lastRun, setLastRun] = useState<ReconcileRun | null>(null);
  const reconcile = useMutation({
    mutationFn: () => adminApi.reconcile(),
    onSuccess: (result) => {
      setLastRun({ result, at: Date.now() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.all });
      notifications.show(
        result.skipped
          ? {
              color: "yellow",
              title: "Reconciler already running",
              message: SKIPPED_MESSAGE,
            }
          : {
              color: "green",
              title: "Reconciler finished",
              message: `Examined ${formatCount(result.examined)} pending order(s).`,
            },
      );
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Reconciler failed",
        message: errorMessage(error),
      });
    },
  });

  const stats = lastRun
    ? [
        { label: "Examined", value: lastRun.result.examined },
        { label: "Paid", value: lastRun.result.paid, color: "green" },
        { label: "Failed", value: lastRun.result.failed, color: "red" },
        { label: "Expired", value: lastRun.result.expired, color: "gray" },
        { label: "Waiting", value: lastRun.result.waiting, color: "yellow.8" },
      ]
    : [];

  return (
    <SectionCard
      id="reconciler"
      title="Payment reconciler"
      description="Settles orders stuck in pending payment by asking the provider for the charge status. It also runs automatically in the worker container, one active reconciler at a time."
      actions={
        <Button
          leftSection={<IconPlayerPlay size={16} aria-hidden />}
          loading={reconcile.isPending}
          onClick={() => reconcile.mutate()}
        >
          Run reconciler now
        </Button>
      }
    >
      {reconcile.isError ? <ErrorState title="Reconciler failed" error={reconcile.error} /> : null}
      {lastRun?.result.skipped ? (
        <Text size="sm" c="yellow.8">
          {SKIPPED_MESSAGE}
        </Text>
      ) : lastRun ? (
        <>
          <SimpleGrid cols={{ base: 2, sm: 5 }} spacing="sm">
            {stats.map((stat) => (
              <StatCard
                key={stat.label}
                label={stat.label}
                value={formatCount(stat.value)}
                color={stat.value > 0 ? stat.color : undefined}
              />
            ))}
          </SimpleGrid>
          <Text size="xs" c="dimmed">
            Last run at {formatTime(lastRun.at)}
          </Text>
        </>
      ) : (
        <Text size="sm" c="dimmed">
          Run the reconciler to see how many pending orders it settles.
        </Text>
      )}
    </SectionCard>
  );
}
