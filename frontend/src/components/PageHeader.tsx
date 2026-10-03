import { Group, Stack, Text, Title } from "@mantine/core";
import { useDocumentTitle } from "@mantine/hooks";
import type { ReactNode } from "react";
import { APP_NAME } from "./brand";

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  badge?: ReactNode;
  documentTitle?: string;
}

export function PageHeader({ title, description, actions, badge, documentTitle }: PageHeaderProps) {
  useDocumentTitle(`${documentTitle ?? title} · ${APP_NAME}`);
  return (
    <Group justify="space-between" align="flex-end" mb="lg" gap="md">
      <Stack gap={4}>
        <Group gap="sm" align="center">
          <Title order={1} size="h2">
            {title}
          </Title>
          {badge}
        </Group>
        {description ? (
          <Text c="dimmed" component="div">
            {description}
          </Text>
        ) : null}
      </Stack>
      {actions ? <Group gap="sm">{actions}</Group> : null}
    </Group>
  );
}
