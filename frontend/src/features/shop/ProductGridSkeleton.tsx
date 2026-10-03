import { Card, SimpleGrid, Skeleton, Stack } from "@mantine/core";

const PLACEHOLDERS = Array.from({ length: 8 }, (_, index) => index);

export function ProductGridSkeleton() {
  return (
    <SimpleGrid cols={{ base: 1, xs: 2, md: 3, lg: 4 }} spacing="lg" aria-busy="true">
      {PLACEHOLDERS.map((index) => (
        <Card key={index} withBorder radius="md" padding="lg">
          <Stack gap="sm">
            <Skeleton height={18} width="40%" />
            <Skeleton height={20} />
            <Skeleton height={12} width="30%" />
            <Skeleton height={32} mt="md" />
          </Stack>
        </Card>
      ))}
    </SimpleGrid>
  );
}
