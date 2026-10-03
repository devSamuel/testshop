import { Center, Loader, Stack, Text } from "@mantine/core";

interface LoadingStateProps {
  label?: string;
}

export function LoadingState({ label = "Loading…" }: LoadingStateProps) {
  return (
    <Center py="xl" role="status" aria-live="polite">
      <Stack align="center" gap="xs">
        <Loader size="md" aria-hidden />
        <Text size="sm" c="dimmed">
          {label}
        </Text>
      </Stack>
    </Center>
  );
}
