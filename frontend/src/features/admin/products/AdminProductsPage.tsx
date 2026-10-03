import {
  ActionIcon,
  Alert,
  Anchor,
  Button,
  Group,
  Loader,
  Paper,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconHistory,
  IconPackage,
  IconPencil,
  IconPlus,
  IconSearch,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { errorMessage, isNotFound } from "../../../api/client";
import { productsApi } from "../../../api/products";
import { queryKeys } from "../../../api/queryKeys";
import type { Product, ProductSearchQuery } from "../../../api/types";
import { AppPagination } from "../../../components/AppPagination";
import { DebouncedTextInput } from "../../../components/DebouncedTextInput";
import { EmptyState } from "../../../components/EmptyState";
import { MoneyText } from "../../../components/MoneyText";
import { PageHeader } from "../../../components/PageHeader";
import { QueryState } from "../../../components/QueryState";
import { StockBadge } from "../../../components/StockBadge";
import { formatDateTime } from "../../../lib/format";
import { pageCount, parsePageParam } from "../../../lib/pagination";
import { DeleteProductModal } from "./DeleteProductModal";
import { ProductFormModal } from "./ProductFormModal";
import { StaleVersionModal } from "./StaleVersionModal";

const PAGE_SIZE = 20;

type Editing = { mode: "create" } | { mode: "edit"; product: Product } | null;

interface StaleConflict {
  product: Product;
  action: "edit" | "delete";
}

interface ProductRowProps {
  product: Product;
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
}

function ProductRow({ product, onEdit, onDelete }: ProductRowProps) {
  return (
    <Table.Tr>
      <Table.Td>
        <Text ff="monospace" size="sm">
          {product.sku}
        </Text>
      </Table.Td>
      <Table.Td>
        <Anchor component={Link} to={`/products/${product.id}`} size="sm" fw={500}>
          {product.name}
        </Anchor>
        <Text size="xs" c="dimmed">
          {product.category}
        </Text>
      </Table.Td>
      <Table.Td ta="right">
        <MoneyText value={product.price} size="sm" />
      </Table.Td>
      <Table.Td ta="right">
        <Group gap="xs" justify="flex-end" wrap="nowrap">
          <Text size="sm" style={{ fontVariantNumeric: "tabular-nums" }}>
            {product.stock}
          </Text>
          {product.stock < 5 ? <StockBadge stock={product.stock} size="xs" /> : null}
        </Group>
      </Table.Td>
      <Table.Td ta="right">
        <Text size="sm" c="dimmed">
          v{product.version}
        </Text>
      </Table.Td>
      <Table.Td>
        <Text size="sm" c="dimmed">
          {formatDateTime(product.updated_at)}
        </Text>
      </Table.Td>
      <Table.Td>
        <Group gap={4} justify="flex-end" wrap="nowrap">
          <Tooltip label="Edit" withArrow>
            <ActionIcon
              variant="subtle"
              aria-label={`Edit ${product.name}`}
              onClick={() => onEdit(product)}
            >
              <IconPencil size={18} aria-hidden />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Stock history" withArrow>
            <ActionIcon
              variant="subtle"
              color="gray"
              component={Link}
              to={`/admin/products/${product.id}/history`}
              aria-label={`Stock history for ${product.name}`}
            >
              <IconHistory size={18} aria-hidden />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Delete" withArrow>
            <ActionIcon
              variant="subtle"
              color="red"
              aria-label={`Delete ${product.name}`}
              onClick={() => onDelete(product)}
            >
              <IconTrash size={18} aria-hidden />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}

export default function AdminProductsPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const page = parsePageParam(params.get("page"));
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [conflict, setConflict] = useState<StaleConflict | null>(null);
  const [reloading, setReloading] = useState(false);

  const search: ProductSearchQuery = { q: q.trim() || undefined, page, page_size: PAGE_SIZE };
  const products = useQuery({
    queryKey: queryKeys.products.search(search),
    queryFn: ({ signal }) => productsApi.search(search, signal),
    placeholderData: keepPreviousData,
  });

  const setQuery = (next: { q?: string; page?: number }) => {
    const nextParams = new URLSearchParams();
    const nextQ = next.q ?? q;
    if (nextQ.trim()) nextParams.set("q", nextQ);
    if ((next.page ?? 1) > 1) nextParams.set("page", String(next.page));
    setParams(nextParams, { replace: next.page === undefined });
  };

  const openConflict = (product: Product, action: StaleConflict["action"]) => {
    setEditing(null);
    setDeleting(null);
    setConflict({ product, action });
  };

  const reloadLatest = async () => {
    if (!conflict) return;
    setReloading(true);
    try {
      const latest = await queryClient.query({
        queryKey: queryKeys.products.detail(conflict.product.id),
        queryFn: ({ signal }) => productsApi.get(conflict.product.id, signal),
        staleTime: 0,
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      setConflict(null);
      if (conflict.action === "edit") setEditing({ mode: "edit", product: latest });
      else setDeleting(latest);
    } catch (error) {
      setConflict(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      notifications.show({
        color: isNotFound(error) ? "blue" : "red",
        title: isNotFound(error) ? "Product was deleted" : "Could not reload the product",
        message: isNotFound(error)
          ? `${conflict.product.name} no longer exists.`
          : errorMessage(error),
      });
    } finally {
      setReloading(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Products"
        description="Create, edit and retire catalog items. Edits use optimistic locking."
        actions={
          <Button
            leftSection={<IconPlus size={16} aria-hidden />}
            onClick={() => setEditing({ mode: "create" })}
          >
            New product
          </Button>
        }
      />
      <Group mb="md" align="flex-end" justify="space-between">
        <DebouncedTextInput
          label="Search products"
          placeholder="Name, SKU or description"
          leftSection={<IconSearch size={16} aria-hidden />}
          value={q}
          onCommit={(next) => setQuery({ q: next })}
          clearLabel="Clear search"
          w={{ base: "100%", sm: 360 }}
          autoComplete="off"
        />
        {products.isFetching ? <Loader size="xs" aria-label="Refreshing products" /> : null}
      </Group>
      <QueryState
        query={products}
        errorTitle="Could not load products"
        isEmpty={(data) => data.items.length === 0}
        empty={
          <EmptyState
            icon={<IconPackage size={30} stroke={1.5} />}
            title={q ? "No products match your search" : "No products yet"}
            description={q ? "Try another search term." : "Create a product or import a CSV."}
            action={
              q ? (
                <Button variant="light" onClick={() => setQuery({ q: "" })}>
                  Clear search
                </Button>
              ) : (
                <Button component={Link} to="/admin/import" variant="light">
                  Import a CSV
                </Button>
              )
            }
          />
        }
      >
        {(data) => (
          <>
            {data.fuzzy && q.trim() ? (
              <Alert color="yellow" variant="light" icon={<IconSparkles aria-hidden />} mb="md">
                Showing approximate matches for “{q.trim()}”
              </Alert>
            ) : null}
            <Paper withBorder radius="md">
              <Table.ScrollContainer minWidth={860}>
                <Table verticalSpacing="sm" highlightOnHover aria-label="Products">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>SKU</Table.Th>
                      <Table.Th>Name</Table.Th>
                      <Table.Th ta="right">Price</Table.Th>
                      <Table.Th ta="right">Stock</Table.Th>
                      <Table.Th ta="right">Version</Table.Th>
                      <Table.Th>Updated</Table.Th>
                      <Table.Th ta="right">Actions</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.items.map((product) => (
                      <ProductRow
                        key={product.id}
                        product={product}
                        onEdit={(target) => setEditing({ mode: "edit", product: target })}
                        onDelete={setDeleting}
                      />
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Paper>
            <Text size="sm" c="dimmed" mt="sm">
              {data.total} product{data.total === 1 ? "" : "s"}
            </Text>
            <AppPagination
              total={pageCount(data.total, PAGE_SIZE)}
              value={page}
              onChange={(next) => setQuery({ page: next })}
            />
          </>
        )}
      </QueryState>

      <ProductFormModal
        opened={editing !== null}
        product={editing?.mode === "edit" ? editing.product : null}
        onClose={() => setEditing(null)}
        onStale={(product) => openConflict(product, "edit")}
      />
      <DeleteProductModal
        product={deleting}
        onClose={() => setDeleting(null)}
        onStale={(product) => openConflict(product, "delete")}
      />
      <StaleVersionModal
        opened={conflict !== null}
        productName={conflict?.product.name ?? null}
        reloading={reloading}
        onReload={() => void reloadLatest()}
        onClose={() => setConflict(null)}
      />
    </>
  );
}
