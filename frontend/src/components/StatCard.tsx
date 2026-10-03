import { Paper, Text } from "@mantine/core";
import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: ReactNode;
  color?: string;
  hint?: ReactNode;
}

export function StatCard({ label, value, color, hint }: StatCardProps) {
  return (
    <Paper withBorder radius="md" p="sm">
      <Text size="xs" c="dimmed" tt="uppercase" fw={700} lh={1.2}>
        {label}
      </Text>
      <Text
        size="xl"
        fw={700}
        c={color}
        mt={4}
        style={{ fontVariantNumeric: "tabular-nums" }}
        component="div"
      >
        {value}
      </Text>
      {hint ? (
        <Text size="xs" c="dimmed" mt={2}>
          {hint}
        </Text>
      ) : null}
    </Paper>
  );
}
