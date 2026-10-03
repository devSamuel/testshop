import { Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconMoodEmpty } from "@tabler/icons-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <Stack align="center" gap="sm" py="xl" ta="center">
      <ThemeIcon size={56} radius="xl" variant="light" color="gray" aria-hidden>
        {icon ?? <IconMoodEmpty size={30} stroke={1.5} />}
      </ThemeIcon>
      <Title order={3} size="h4">
        {title}
      </Title>
      {description ? (
        <Text c="dimmed" maw={460}>
          {description}
        </Text>
      ) : null}
      {action}
    </Stack>
  );
}
