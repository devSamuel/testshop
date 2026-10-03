import { Group, Paper, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

interface SectionCardProps {
  id: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function SectionCard({ id, title, description, actions, children }: SectionCardProps) {
  return (
    <Paper withBorder radius="md" p="md" component="section" aria-labelledby={id} h="100%">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start" gap="sm">
          <div>
            <Title order={2} size="h4" id={id}>
              {title}
            </Title>
            {description ? (
              <Text size="sm" c="dimmed">
                {description}
              </Text>
            ) : null}
          </div>
          {actions}
        </Group>
        {children}
      </Stack>
    </Paper>
  );
}
