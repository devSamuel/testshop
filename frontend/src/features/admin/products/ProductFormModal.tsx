import {
  Alert,
  Autocomplete,
  Button,
  Grid,
  Group,
  Modal,
  NumberInput,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, errorMessage } from "../../../api/client";
import { productsApi } from "../../../api/products";
import { queryKeys } from "../../../api/queryKeys";
import type { Product } from "../../../api/types";
import { useCategories } from "../../shop/useCategories";
import {
  MAX_STOCK,
  buildCreatePayload,
  buildUpdatePayload,
  hasProductChanges,
  mapProductServerErrors,
  productToFormValues,
  validateProductForm,
  type ProductFormValues,
} from "./productForm";

interface ProductFormProps {
  product: Product | null;
  onClose: () => void;
  onStale: (product: Product) => void;
}

function ProductForm({ product, onClose, onStale }: ProductFormProps) {
  const queryClient = useQueryClient();
  const categories = useCategories();
  const [generalError, setGeneralError] = useState<string | null>(null);
  const form = useForm<ProductFormValues>({
    mode: "controlled",
    initialValues: productToFormValues(product),
    validate: (values) => validateProductForm(values),
  });

  const save = useMutation({
    mutationFn: (values: ProductFormValues): Promise<Product> => {
      if (!product) return productsApi.create(buildCreatePayload(values));
      const payload = buildUpdatePayload(product, values);
      return payload ? productsApi.update(product.id, payload) : Promise.resolve(product);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.products.detail(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories });
      notifications.show({
        color: "green",
        title: product ? "Product updated" : "Product created",
        message: `${saved.name} (${saved.sku})`,
      });
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        if (product && error.is("stale-version")) {
          onStale(product);
          return;
        }
        if (error.is("duplicate-sku")) {
          form.setFieldError("sku", "Another product already uses this SKU");
          return;
        }
        if (error.status === 404) {
          setGeneralError("This product no longer exists. It may have been deleted.");
          return;
        }
        const { formErrors, otherMessages } = mapProductServerErrors(error.fieldErrors);
        form.setErrors(formErrors);
        if (Object.keys(formErrors).length > 0 && otherMessages.length === 0) return;
        setGeneralError([errorMessage(error), ...otherMessages].join(" "));
        return;
      }
      setGeneralError(errorMessage(error));
    },
  });

  const unchanged = product !== null && !hasProductChanges(product, form.values);

  return (
    <form
      noValidate
      onSubmit={form.onSubmit((values) => {
        setGeneralError(null);
        save.mutate(values);
      })}
    >
      <Stack gap="md">
        {generalError ? (
          <Alert color="red" variant="light" icon={<IconAlertTriangle aria-hidden />}>
            {generalError}
          </Alert>
        ) : null}
        <Grid gutter="md">
          <Grid.Col span={{ base: 12, sm: 5 }}>
            <TextInput
              label="SKU"
              withAsterisk
              autoComplete="off"
              description="Stored in upper case"
              ff="monospace"
              data-autofocus
              {...form.getInputProps("sku")}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 7 }}>
            <TextInput label="Name" withAsterisk {...form.getInputProps("name")} />
          </Grid.Col>
          <Grid.Col span={12}>
            <Textarea
              label="Description"
              autosize
              minRows={2}
              maxRows={6}
              {...form.getInputProps("description")}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6 }}>
            <Autocomplete
              label="Category"
              placeholder="Uncategorized"
              data={(categories.data ?? []).map((category) => category.name)}
              {...form.getInputProps("category")}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6 }}>
            <TextInput
              label="Price"
              withAsterisk
              inputMode="decimal"
              leftSection="$"
              placeholder="0.00"
              {...form.getInputProps("price")}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6 }}>
            <NumberInput
              label="Stock"
              withAsterisk
              min={0}
              max={MAX_STOCK}
              allowDecimal={false}
              allowNegative={false}
              thousandSeparator=","
              description={product ? "Changes are recorded in the stock ledger" : undefined}
              {...form.getInputProps("stock")}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6 }}>
            <TextInput
              label="Weight"
              inputMode="decimal"
              rightSection={
                <Text size="sm" c="dimmed">
                  kg
                </Text>
              }
              placeholder="Optional"
              {...form.getInputProps("weightKg")}
            />
          </Grid.Col>
        </Grid>
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending} disabled={unchanged}>
            {product ? (unchanged ? "No changes" : "Save changes") : "Create product"}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

interface ProductFormModalProps {
  opened: boolean;
  product: Product | null;
  onClose: () => void;
  onStale: (product: Product) => void;
}

export function ProductFormModal({ opened, product, onClose, onStale }: ProductFormModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={product ? `Edit ${product.name}` : "New product"}
      size="lg"
      centered
    >
      <ProductForm
        key={product ? `${product.id}:${product.version}` : "new"}
        product={product}
        onClose={onClose}
        onStale={onStale}
      />
    </Modal>
  );
}
