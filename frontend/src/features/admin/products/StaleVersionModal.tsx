import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";

interface StaleVersionModalProps {
  opened: boolean;
  productName: string | null;
  reloading: boolean;
  onReload: () => void;
  onClose: () => void;
}

export function StaleVersionModal({
  opened,
  productName,
  reloading,
  onReload,
  onClose,
}: StaleVersionModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="This product was changed by someone else"
      centered
    >
      <Stack gap="md">
        <Text size="sm">
          {productName ? <strong>{productName}</strong> : "This product"} was updated after you
          opened it, so your changes were not saved. Reload the latest version to review what
          changed, then apply your edits again.
        </Text>
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose} disabled={reloading}>
            Cancel
          </Button>
          <Button
            leftSection={<IconRefresh size={16} aria-hidden />}
            loading={reloading}
            onClick={onReload}
          >
            Reload latest
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
