import { Alert, Badge, Drawer, Group, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { isNotFound } from "../../../api/client";
import { importsApi } from "../../../api/imports";
import { queryKeys } from "../../../api/queryKeys";
import type { ImportRunDetail } from "../../../api/types";
import { EmptyState } from "../../../components/EmptyState";
import { QueryState } from "../../../components/QueryState";
import { StatCard } from "../../../components/StatCard";
import { ImportStatusBadge } from "../../../components/StatusBadge";
import { formatCount, formatDateTime, formatMilliseconds } from "../../../lib/format";
import { FileMeta } from "./FileMeta";
import { IssuesTable } from "./IssuesTable";
import { RunLineage } from "./RecentRuns";

function RunDetails({ run, onView }: { run: ImportRunDetail; onView: (runId: string) => void }) {
  const stats = [
    { label: "Rows", value: run.rows_total },
    { label: "Valid", value: run.rows_valid },
    { label: "Invalid", value: run.rows_invalid },
    { label: run.dry_run ? "Would create" : "Created", value: run.created },
    { label: run.dry_run ? "Would update" : "Updated", value: run.updated },
    { label: "Unchanged", value: run.unchanged },
  ];
  return (
    <Stack gap="md">
      <Group gap="sm">
        <Title order={3} size="h4" style={{ overflowWrap: "anywhere" }}>
          {run.filename}
        </Title>
        <ImportStatusBadge status={run.status} />
        {run.dry_run ? (
          <Badge variant="outline" color="gray">
            Dry run
          </Badge>
        ) : null}
        <RunLineage run={run} onView={onView} />
      </Group>
      <Text size="sm" c="dimmed">
        Started {formatDateTime(run.started_at)} via {run.source} · took{" "}
        {formatMilliseconds(run.duration_ms)}
      </Text>
      <FileMeta size={run.file_size} sha256={run.file_sha256} />
      {run.failure ? (
        <Alert color="red" variant="light" icon={<IconAlertTriangle aria-hidden />}>
          {run.failure}
        </Alert>
      ) : null}
      <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
        {stats.map((stat) => (
          <StatCard key={stat.label} label={stat.label} value={formatCount(stat.value)} />
        ))}
      </SimpleGrid>
      <IssuesTable
        runId={run.id}
        issues={run.issues}
        issuesTotal={run.issues_total}
        truncated={run.issues_truncated}
        errorCount={run.error_count}
        warningCount={run.warning_count}
      />
    </Stack>
  );
}

interface RunDetailsDrawerProps {
  runId: string | null;
  onClose: () => void;
  onView: (runId: string) => void;
}

export function RunDetailsDrawer({ runId, onClose, onView }: RunDetailsDrawerProps) {
  const run = useQuery({
    queryKey: queryKeys.imports.detail(runId ?? ""),
    queryFn: ({ signal }) => importsApi.get(runId ?? "", signal),
    enabled: runId !== null,
  });

  return (
    <Drawer
      opened={runId !== null}
      onClose={onClose}
      position="right"
      size="xl"
      title="Import run details"
    >
      {isNotFound(run.error) ? (
        <EmptyState title="Import run not found" description="It may have been purged." />
      ) : (
        <QueryState query={run} errorTitle="Could not load this import run">
          {(data) => <RunDetails key={data.id} run={data} onView={onView} />}
        </QueryState>
      )}
    </Drawer>
  );
}
