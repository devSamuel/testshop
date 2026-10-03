import { Alert, Button, Group, Text } from "@mantine/core";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { errorMessage } from "../api/client";

interface ErrorStateProps {
  title?: string;
  error: unknown;
  onRetry?: () => void;
}

export function ErrorState({ title = "Something went wrong", error, onRetry }: ErrorStateProps) {
  return (
    <Alert
      color="red"
      variant="light"
      title={title}
      icon={<IconAlertTriangle aria-hidden />}
      my="md"
    >
      <Group justify="space-between" align="center" gap="md">
        <Text size="sm">{errorMessage(error)}</Text>
        {onRetry ? (
          <Button
            size="xs"
            variant="white"
            color="red"
            leftSection={<IconRefresh size={14} aria-hidden />}
            onClick={onRetry}
          >
            Try again
          </Button>
        ) : null}
      </Group>
    </Alert>
  );
}
