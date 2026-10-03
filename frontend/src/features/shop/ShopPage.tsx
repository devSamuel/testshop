import { Alert, Box, Button, Group, Loader, SimpleGrid, Text } from "@mantine/core";
import { IconSearchOff, IconSparkles } from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { productsApi } from "../../api/products";
import { queryKeys } from "../../api/queryKeys";
import { AppPagination } from "../../components/AppPagination";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { PageHeader } from "../../components/PageHeader";
import { formatCount } from "../../lib/format";
import { pageCount } from "../../lib/pagination";
import { hasActiveFilters, SHOP_PAGE_SIZE, toProductQuery } from "./filters";
import { ProductCard } from "./ProductCard";
import { ProductFilters } from "./ProductFilters";
import { ProductGridSkeleton } from "./ProductGridSkeleton";
import { useShopFilters } from "./useShopFilters";

export default function ShopPage() {
  const { filters, update, reset } = useShopFilters();
  const query = useMemo(() => toProductQuery(filters), [filters]);
  const products = useQuery({
    queryKey: queryKeys.products.search(query),
    queryFn: ({ signal }) => productsApi.search(query, signal),
    placeholderData: keepPreviousData,
  });

  const goToPage = (page: number) => {
    update({ page }, { push: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const renderResults = () => {
    if (products.data === undefined) {
      if (products.isError) {
        return (
          <ErrorState
            title="Could not load products"
            error={products.error}
            onRetry={() => void products.refetch()}
          />
        );
      }
      return <ProductGridSkeleton />;
    }

    const { items, total, fuzzy } = products.data;
    const pages = pageCount(total, SHOP_PAGE_SIZE);
    const firstIndex = (filters.page - 1) * SHOP_PAGE_SIZE + 1;
    const lastIndex = firstIndex + items.length - 1;

    if (items.length === 0) {
      if (total > 0) {
        return (
          <EmptyState
            title="This page is empty"
            description={`There are only ${pages} page${pages === 1 ? "" : "s"} of results.`}
            action={<Button onClick={() => goToPage(1)}>Go to the first page</Button>}
          />
        );
      }
      return (
        <EmptyState
          icon={<IconSearchOff size={30} stroke={1.5} />}
          title="No products found"
          description={
            hasActiveFilters(filters)
              ? "Try a different search term or loosen your filters."
              : "The catalog is empty. Import a CSV from the admin area to get started."
          }
          action={
            hasActiveFilters(filters) ? (
              <Button variant="light" onClick={reset}>
                Clear all filters
              </Button>
            ) : undefined
          }
        />
      );
    }

    return (
      <>
        {fuzzy && filters.q.trim() ? (
          <Alert
            color="yellow"
            variant="light"
            icon={<IconSparkles aria-hidden />}
            title={`Showing approximate matches for “${filters.q.trim()}”`}
            mb="md"
          >
            We couldn&apos;t find an exact match, so these are the closest results.
          </Alert>
        ) : null}
        {products.isError ? (
          <ErrorState
            title="Showing previous results"
            error={products.error}
            onRetry={() => void products.refetch()}
          />
        ) : null}
        <Group justify="space-between" mb="sm" mih={24}>
          <Text size="sm" c="dimmed" aria-live="polite">
            Showing {formatCount(firstIndex)}–{formatCount(lastIndex)} of {formatCount(total)}{" "}
            products
          </Text>
          {products.isFetching ? <Loader size="xs" aria-label="Updating results" /> : null}
        </Group>
        <Box
          aria-busy={products.isPlaceholderData}
          style={{
            opacity: products.isPlaceholderData ? 0.55 : 1,
            transition: "opacity 150ms ease",
          }}
        >
          <SimpleGrid cols={{ base: 1, xs: 2, md: 3, lg: 4 }} spacing="lg">
            {items.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </SimpleGrid>
        </Box>
        <AppPagination total={pages} value={filters.page} onChange={goToPage} />
      </>
    );
  };

  return (
    <>
      <PageHeader title="Shop" description="Browse the catalog and add items to your cart." />
      <ProductFilters filters={filters} onChange={update} onReset={reset} />
      {renderResults()}
    </>
  );
}
