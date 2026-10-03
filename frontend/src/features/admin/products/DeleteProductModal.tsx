import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconTrash } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, errorMessage } from "../../../api/client";
import { productsApi } from "../../../api/products";
import { queryKeys } from "../../../api/queryKeys";
import type { Product } from "../../../api/types";

interface DeleteProductModalProps {
  product: Product | null;
  onClose: () => void;
  onStale: (product: Product) => void;
}

export function DeleteProductModal({ product, onClose, onStale }: DeleteProductModalProps) {
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: (target: Product) => productsApi.remove(target.id, target.version),
    onSuccess: (_, target) => {
      queryClient.removeQueries({ queryKey: queryKeys.products.detail(target.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories });
      notifications.show({ color: "green", title: "Product deleted", message: target.name });
      onClose();
    },
    onError: (error, target) => {
      if (error instanceof ApiError && error.is("stale-version")) {
        onStale(target);
        return;
      }
      if (error instanceof ApiError && error.status === 404) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
        notifications.show({
          color: "blue",
          title: "Already deleted",
          message: `${target.name} had already been removed.`,
        });
        onClose();
      }
    },
  });

  const close = () => {
    remove.reset();
    onClose();
  };

  return (
    <Modal opened={product !== null} onClose={close} title="Delete product" centered>
      {product ? (
        <Stack gap="md">
          <Text size="sm">
            Delete <strong>{product.name}</strong> ({product.sku})? It will disappear from the
            catalog, while past orders and the stock ledger keep their history.
          </Text>
          {remove.isError &&
          !(remove.error instanceof ApiError && remove.error.is("stale-version")) ? (
            <Alert color="red" variant="light">
              {errorMessage(remove.error)}
            </Alert>
          ) : null}
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={close} disabled={remove.isPending}>
              Cancel
            </Button>
            <Button
              color="red"
              leftSection={<IconTrash size={16} aria-hidden />}
              loading={remove.isPending}
              onClick={() => remove.mutate(product)}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      ) : null}
    </Modal>
  );
}
