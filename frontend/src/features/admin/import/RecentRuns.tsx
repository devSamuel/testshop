import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconChecks, IconDownload, IconEye, IconFileImport } from "@tabler/icons-react";
import type { UseQueryResult } from "@tanstack/react-query";
import { issuesCsvUrl } from "../../../api/imports";
import type { ImportRun } from "../../../api/types";
import { EmptyState } from "../../../components/EmptyState";
import { QueryState } from "../../../components/QueryState";
import { ImportStatusBadge } from "../../../components/StatusBadge";
import {
  formatBytes,
  formatCount,
  formatDateTime,
  formatMilliseconds,
  shortId,
} from "../../../lib/format";
import { RunLink } from "./RunLink";

interface RecentRunsProps {
  runs: UseQueryResult<ImportRun[]>;
  onView: (runId: string) => void;
}

export function RunLineage({
  run,
  onView,
}: {
  run: Pick<ImportRun, "dry_run" | "applied_run_id" | "parent_run_id">;
  onView: (runId: string) => void;
}) {
  const appliedRunId = run.dry_run ? run.applied_run_id : null;
  if (appliedRunId) {
    return (
      <Button
        size="compact-xs"
        variant="light"
        color="green"
        leftSection={<IconChecks size={12} aria-hidden />}
        onClick={() => onView(appliedRunId)}
        aria-label="Applied: view the import run that applied this dry run"
      >
        Applied
      </Button>
    );
  }
  if (run.parent_run_id) {
    return (
      <Text size="xs" c="dimmed">
        from dry run{" "}
        <RunLink
          runId={run.parent_run_id}
          onView={onView}
          size="xs"
          label={`View dry run ${shortId(run.parent_run_id)}`}
        >
          {shortId(run.parent_run_id)}
        </RunLink>
      </Text>
    );
  }
  return null;
}

export function RecentRuns({ runs, onView }: RecentRunsProps) {
  return (
    <Paper withBorder radius="md" p="md" component="section" aria-labelledby="recent-runs-title">
      <Title order={2} size="h4" mb="sm" id="recent-runs-title">
        Recent runs
      </Title>
      <QueryState
        query={runs}
        errorTitle="Could not load recent runs"
        isEmpty={(data) => data.length === 0}
        empty={
          <EmptyState
            icon={<IconFileImport size={30} stroke={1.5} />}
            title="No imports yet"
            description="Dry runs and completed imports will be listed here."
          />
        }
      >
        {(data) => (
          <Table.ScrollContainer minWidth={900}>
            <Table verticalSpacing="xs" highlightOnHover aria-label="Recent import runs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Started</Table.Th>
                  <Table.Th>File</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th ta="right">Rows (valid / total)</Table.Th>
                  <Table.Th ta="right">Created · Updated · Unchanged</Table.Th>
                  <Table.Th ta="right">Errors · Warnings</Table.Th>
                  <Table.Th ta="right">Duration</Table.Th>
                  <Table.Th ta="right">Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.map((run) => (
                  <Table.Tr key={run.id}>
                    <Table.Td>
                      <Text size="sm">{formatDateTime(run.started_at)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" truncate maw={220} title={run.filename}>
                        {run.filename}
                      </Text>
                      <Text size="xs" c="dimmed">
                        via {run.source}
                        {run.file_size === null ? "" : ` · ${formatBytes(run.file_size)}`}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Stack gap={4} align="flex-start">
                        <Group gap={4} wrap="nowrap">
                          <ImportStatusBadge status={run.status} />
                          {run.dry_run && run.status !== "dry_run" ? (
                            <Badge variant="outline" color="gray" size="sm">
                              Dry run
                            </Badge>
                          ) : null}
                        </Group>
                        <RunLineage run={run} onView={onView} />
                      </Stack>
                    </Table.Td>
                    <Table.Td ta="right">
                      {formatCount(run.rows_valid)} / {formatCount(run.rows_total)}
                    </Table.Td>
                    <Table.Td ta="right">
                      {formatCount(run.created)} · {formatCount(run.updated)} ·{" "}
                      {formatCount(run.unchanged)}
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text span size="sm" c={run.error_count > 0 ? "red" : undefined}>
                        {formatCount(run.error_count)}
                      </Text>
                      {" · "}
                      <Text span size="sm" c={run.warning_count > 0 ? "yellow.8" : undefined}>
                        {formatCount(run.warning_count)}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right">{formatMilliseconds(run.duration_ms)}</Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <Tooltip label="View details" withArrow>
                          <ActionIcon
                            variant="subtle"
                            aria-label={`View details for ${run.filename}`}
                            onClick={() => onView(run.id)}
                          >
                            <IconEye size={18} aria-hidden />
                          </ActionIcon>
                        </Tooltip>
                        {run.issues_total > 0 ? (
                          <Tooltip label="Download issues CSV" withArrow>
                            <ActionIcon
                              variant="subtle"
                              color="gray"
                              component="a"
                              href={issuesCsvUrl(run.id)}
                              download
                              aria-label={`Download issues CSV for ${run.filename}`}
                            >
                              <IconDownload size={18} aria-hidden />
                            </ActionIcon>
                          </Tooltip>
                        ) : null}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </QueryState>
    </Paper>
  );
}
