import { Alert, Group, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { IconAlertTriangle, IconCircleCheck } from "@tabler/icons-react";
import type { ImportReport } from "../../../api/types";
import { StatCard } from "../../../components/StatCard";
import { ImportStatusBadge } from "../../../components/StatusBadge";
import { formatCount, formatMilliseconds, shortId } from "../../../lib/format";
import { FileMeta } from "./FileMeta";
import { IssuesTable } from "./IssuesTable";
import { RunLink } from "./RunLink";

interface ImportReportViewProps {
  report: ImportReport;
  onViewRun?: (runId: string) => void;
}

function countColor(value: number, color: string): string | undefined {
  return value > 0 ? color : undefined;
}

export function ImportReportView({ report, onViewRun }: ImportReportViewProps) {
  const preview = report.dry_run;
  const stats = [
    { label: "Rows", value: report.rows_total },
    { label: "Valid", value: report.rows_valid, color: countColor(report.rows_valid, "green") },
    { label: "Invalid", value: report.rows_invalid, color: countColor(report.rows_invalid, "red") },
    { label: preview ? "Will create" : "Created", value: report.created },
    { label: preview ? "Will update" : "Updated", value: report.updated },
    { label: "Unchanged", value: report.unchanged },
    {
      label: "Duplicates",
      value: report.duplicates,
      color: countColor(report.duplicates, "red"),
    },
    {
      label: "Warnings",
      value: report.warning_count,
      color: countColor(report.warning_count, "yellow.8"),
    },
    { label: "Errors", value: report.error_count, color: countColor(report.error_count, "red") },
  ];

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start" gap="sm">
        <Stack gap={4}>
          <Group gap="sm">
            <Title order={2} size="h4" style={{ overflowWrap: "anywhere" }}>
              {report.filename}
            </Title>
            <ImportStatusBadge status={report.status} />
          </Group>
          <FileMeta size={report.file_size} sha256={report.file_sha256} />
          {report.parent_run_id ? (
            <Text size="sm" c="dimmed">
              Applied from dry run{" "}
              {onViewRun ? (
                <RunLink runId={report.parent_run_id} onView={onViewRun}>
                  {shortId(report.parent_run_id)}
                </RunLink>
              ) : (
                shortId(report.parent_run_id)
              )}
            </Text>
          ) : null}
        </Stack>
        <Text size="sm" c="dimmed">
          Processed in {formatMilliseconds(report.duration_ms)}
        </Text>
      </Group>
      {report.failure ? (
        <Alert
          color="red"
          variant="light"
          icon={<IconAlertTriangle aria-hidden />}
          title={report.status === "rejected" ? "File rejected" : "Import failed"}
        >
          {report.failure}
        </Alert>
      ) : null}
      {report.status === "completed" ? (
        <Alert
          color="green"
          variant="light"
          icon={<IconCircleCheck aria-hidden />}
          title="Import completed"
        >
          {formatCount(report.created)} created, {formatCount(report.updated)} updated,{" "}
          {formatCount(report.unchanged)} unchanged.
          {report.rows_invalid > 0
            ? ` ${formatCount(report.rows_invalid)} invalid rows were skipped.`
            : ""}
        </Alert>
      ) : null}
      <SimpleGrid cols={{ base: 2, xs: 3, md: 5, lg: 9 }} spacing="sm">
        {stats.map((stat) => (
          <StatCard
            key={stat.label}
            label={stat.label}
            value={formatCount(stat.value)}
            color={stat.color}
          />
        ))}
      </SimpleGrid>
      {report.blank_rows > 0 ? (
        <Text size="xs" c="dimmed">
          {formatCount(report.blank_rows)} blank rows were ignored.
        </Text>
      ) : null}
      {report.duplicates > 0 ? (
        <Text size="xs" c="dimmed">
          Repeated SKUs: identical rows are skipped with a warning; conflicting rows are errors and
          the first row is kept.
        </Text>
      ) : null}
      <Title order={3} size="h5">
        Issues
      </Title>
      <IssuesTable
        runId={report.run_id}
        reportUrl={report.issues_report_url}
        issues={report.issues}
        issuesTotal={report.issues_total}
        truncated={report.issues_truncated}
        errorCount={report.error_count}
        warningCount={report.warning_count}
      />
    </Stack>
  );
}
