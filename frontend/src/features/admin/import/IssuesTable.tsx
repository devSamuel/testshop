import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { IconDownload, IconFileAlert } from "@tabler/icons-react";
import { useState } from "react";
import { issuesCsvUrl } from "../../../api/imports";
import type { ImportIssue, IssueSeverity } from "../../../api/types";
import { AppPagination } from "../../../components/AppPagination";
import { formatCount } from "../../../lib/format";
import { pageCount } from "../../../lib/pagination";

const ISSUES_PER_PAGE = 25;

type SeverityFilter = "all" | IssueSeverity;

const DOWNLOADS: readonly { severity?: IssueSeverity; label: string }[] = [
  { label: "All issues" },
  { severity: "error", label: "Errors only" },
  { severity: "warning", label: "Warnings only" },
];

const FILTER_NOUN: Record<SeverityFilter, string> = {
  all: "issues",
  error: "errors",
  warning: "warnings",
};

export interface IssuesTableProps {
  runId: string;
  reportUrl?: string;
  issues: ImportIssue[];
  issuesTotal: number;
  truncated: boolean;
  errorCount: number;
  warningCount: number;
}

function isSeverityFilter(value: string): value is SeverityFilter {
  return value === "all" || value === "error" || value === "warning";
}

function FullReportDownloads({
  runId,
  reportUrl,
  shown,
  total,
}: {
  runId: string;
  reportUrl?: string;
  shown: number;
  total: number;
}) {
  return (
    <Alert color="blue" variant="light" icon={<IconFileAlert aria-hidden />}>
      <Stack gap="xs">
        <Text size="sm">
          Showing the first {formatCount(shown)} of {formatCount(total)} issues. Download the full
          report:
        </Text>
        <Group gap="xs">
          {DOWNLOADS.map(({ severity, label }) => (
            <Button
              key={label}
              component="a"
              href={issuesCsvUrl(runId, severity, reportUrl)}
              download
              size="xs"
              variant="white"
              leftSection={<IconDownload size={14} aria-hidden />}
            >
              {label}
            </Button>
          ))}
        </Group>
      </Stack>
    </Alert>
  );
}

export function IssuesTable({
  runId,
  reportUrl,
  issues,
  issuesTotal,
  truncated,
  errorCount,
  warningCount,
}: IssuesTableProps) {
  const [filter, setFilter] = useState<SeverityFilter>("all");
  const [page, setPage] = useState(1);

  if (issues.length === 0 && issuesTotal === 0) {
    return (
      <Text size="sm" c="dimmed">
        No issues found: every row passed validation.
      </Text>
    );
  }

  const filtered = filter === "all" ? issues : issues.filter((issue) => issue.severity === filter);
  const pages = pageCount(filtered.length, ISSUES_PER_PAGE);
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * ISSUES_PER_PAGE, current * ISSUES_PER_PAGE);
  const severity = filter === "all" ? undefined : filter;

  return (
    <Stack gap="sm">
      {truncated ? (
        <FullReportDownloads
          runId={runId}
          reportUrl={reportUrl}
          shown={issues.length}
          total={issuesTotal}
        />
      ) : null}
      <Group justify="space-between" gap="sm">
        <SegmentedControl
          aria-label="Filter issues by severity"
          value={filter}
          onChange={(value) => {
            if (!isSeverityFilter(value)) return;
            setFilter(value);
            setPage(1);
          }}
          data={[
            { value: "all", label: `All (${formatCount(errorCount + warningCount)})` },
            { value: "error", label: `Errors (${formatCount(errorCount)})` },
            { value: "warning", label: `Warnings (${formatCount(warningCount)})` },
          ]}
        />
        {truncated ? null : (
          <Button
            component="a"
            href={issuesCsvUrl(runId, severity, reportUrl)}
            download
            variant="light"
            size="xs"
            leftSection={<IconDownload size={14} aria-hidden />}
          >
            Download {FILTER_NOUN[filter]} CSV
          </Button>
        )}
      </Group>
      {filtered.length === 0 ? (
        <Text size="sm" c="dimmed">
          No {FILTER_NOUN[filter]} {truncated ? "in this preview" : "in this report"}.
        </Text>
      ) : (
        <Paper withBorder radius="md">
          <Table.ScrollContainer minWidth={640}>
            <Table verticalSpacing="xs" aria-label="Import issues">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={70}>Row</Table.Th>
                  <Table.Th w={100}>Severity</Table.Th>
                  <Table.Th w={120}>Field</Table.Th>
                  <Table.Th w={180}>Value</Table.Th>
                  <Table.Th>Message</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {visible.map((issue, index) => (
                  <Table.Tr key={`${issue.row ?? "file"}-${issue.field ?? ""}-${index}`}>
                    <Table.Td>
                      {issue.row ?? (
                        <Text size="sm" c="dimmed">
                          File
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        variant="light"
                        color={issue.severity === "error" ? "red" : "yellow"}
                        size="sm"
                      >
                        {issue.severity}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{issue.field ? <Code>{issue.field}</Code> : "—"}</Table.Td>
                    <Table.Td>
                      <Text size="sm" truncate maw={180} title={issue.value ?? undefined}>
                        {issue.value ?? "—"}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{issue.message}</Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}
      <AppPagination total={pages} value={current} onChange={setPage} />
    </Stack>
  );
}
