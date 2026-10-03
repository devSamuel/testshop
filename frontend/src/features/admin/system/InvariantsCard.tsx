import { Badge, Code, Group, Paper, Spoiler, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconCheck, IconX } from "@tabler/icons-react";
import type { InvariantCheck } from "../../../api/types";
import { QueryState } from "../../../components/QueryState";
import { formatTime, humanize, pluralize } from "../../../lib/format";
import { SectionCard } from "./SectionCard";
import { useInvariants } from "./useSystemQueries";

const MAX_VIOLATIONS_SHOWN = 10;

function CheckRow({ check }: { check: InvariantCheck }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm" w="100%">
      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
        <ThemeIcon
          size="sm"
          radius="xl"
          color={check.passed ? "green" : "red"}
          variant="light"
          role="img"
          aria-label={check.passed ? "Passed" : "Failed"}
        >
          {check.passed ? <IconCheck size={14} /> : <IconX size={14} />}
        </ThemeIcon>
        <div style={{ minWidth: 0 }}>
          <Text size="sm" fw={600}>
            {humanize(check.name)}
          </Text>
          <Text size="xs" c="dimmed">
            {check.description}
          </Text>
        </div>
      </Group>
      <Badge color={check.passed ? "gray" : "red"} variant="light" style={{ flexShrink: 0 }}>
        {pluralize(check.violations.length, "violation")}
      </Badge>
    </Group>
  );
}

export function InvariantsCard() {
  const invariants = useInvariants();
  return (
    <SectionCard
      id="data-integrity"
      title="Data integrity"
      description="Ledger, reservation and payment invariants, verified against the database."
      actions={
        invariants.data ? (
          <Badge size="lg" color={invariants.data.passed ? "green" : "red"} variant="filled">
            {invariants.data.passed ? "All checks passing" : "Violations found"}
          </Badge>
        ) : null
      }
    >
      <QueryState query={invariants} errorTitle="Could not run integrity checks">
        {(report) => (
          <Stack gap="xs">
            {report.checks.map((check) => (
              <Paper key={check.name} withBorder radius="md" p="sm">
                <CheckRow check={check} />
                {check.passed ? null : (
                  <Spoiler
                    maxHeight={0}
                    showLabel="Show violations"
                    hideLabel="Hide violations"
                    mt="xs"
                  >
                    <Code block>
                      {JSON.stringify(check.violations.slice(0, MAX_VIOLATIONS_SHOWN), null, 2)}
                    </Code>
                    {check.violations.length > MAX_VIOLATIONS_SHOWN ? (
                      <Text size="xs" c="dimmed" mt={4}>
                        Showing {MAX_VIOLATIONS_SHOWN} of {check.violations.length}
                      </Text>
                    ) : null}
                  </Spoiler>
                )}
              </Paper>
            ))}
            <Text size="xs" c="dimmed">
              Checked at {formatTime(report.checked_at)}
            </Text>
          </Stack>
        )}
      </QueryState>
    </SectionCard>
  );
}
