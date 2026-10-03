import { Button, Grid, Group, Paper, Select, Switch } from "@mantine/core";
import { IconFilterOff, IconSearch } from "@tabler/icons-react";
import { DebouncedTextInput } from "../../components/DebouncedTextInput";
import { tryParseCents } from "../../lib/money";
import {
  SORT_OPTIONS,
  effectiveSort,
  hasActiveFilters,
  validatePrice,
  type ShopFilters,
} from "./filters";
import { useCategories } from "./useCategories";

interface ProductFiltersProps {
  filters: ShopFilters;
  onChange: (patch: Partial<ShopFilters>, options?: { push?: boolean }) => void;
  onReset: () => void;
}

function compareAmounts(min: string, max: string): number | null {
  const low = tryParseCents(min);
  const high = tryParseCents(max);
  return low === null || high === null ? null : high - low;
}

export function ProductFilters({ filters, onChange, onReset }: ProductFiltersProps) {
  const categories = useCategories();
  const categoryOptions = (categories.data ?? []).map((category) => ({
    value: category.name,
    label: `${category.name} (${category.product_count})`,
  }));

  const validateMin = (value: string) => {
    const error = validatePrice(value);
    if (error) return error;
    const diff = filters.maxPrice ? compareAmounts(value, filters.maxPrice) : null;
    return diff !== null && diff < 0 ? "Must not exceed the maximum" : null;
  };

  const validateMax = (value: string) => {
    const error = validatePrice(value);
    if (error) return error;
    const diff = filters.minPrice ? compareAmounts(filters.minPrice, value) : null;
    return diff !== null && diff < 0 ? "Must be at least the minimum" : null;
  };

  return (
    <Paper withBorder radius="md" p="md" mb="lg" component="section" aria-label="Product filters">
      <Grid gutter="sm" align="flex-end">
        <Grid.Col span={{ base: 12, md: 6 }}>
          <DebouncedTextInput
            label="Search"
            placeholder="Search by name, SKU or description"
            leftSection={<IconSearch size={16} aria-hidden />}
            value={filters.q}
            onCommit={(q) => onChange({ q })}
            clearLabel="Clear search"
            autoComplete="off"
            maxLength={200}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <Select
            label="Category"
            placeholder={categories.isError ? "Categories unavailable" : "All categories"}
            data={categoryOptions}
            value={filters.category || null}
            onChange={(category) => onChange({ category: category ?? "" }, { push: true })}
            clearable
            searchable
            nothingFoundMessage="No matching category"
            disabled={categories.isError}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
          <Select
            label="Sort by"
            data={SORT_OPTIONS.map((option) => ({
              ...option,
              disabled: option.value === "relevance" && !filters.q.trim(),
            }))}
            value={effectiveSort(filters)}
            onChange={(sort) => {
              const next = SORT_OPTIONS.find((option) => option.value === sort);
              if (next) onChange({ sort: next.value }, { push: true });
            }}
            allowDeselect={false}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 6, sm: 3, md: 2 }}>
          <DebouncedTextInput
            label="Min price"
            placeholder="0.00"
            inputMode="decimal"
            leftSection="$"
            value={filters.minPrice}
            validate={validateMin}
            onCommit={(minPrice) => onChange({ minPrice })}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 6, sm: 3, md: 2 }}>
          <DebouncedTextInput
            label="Max price"
            placeholder="Any"
            inputMode="decimal"
            leftSection="$"
            value={filters.maxPrice}
            validate={validateMax}
            onCommit={(maxPrice) => onChange({ maxPrice })}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, md: 8 }}>
          <Group justify="space-between" h={36} wrap="nowrap">
            <Switch
              label="In stock only"
              checked={filters.inStock}
              onChange={(event) =>
                onChange({ inStock: event.currentTarget.checked }, { push: true })
              }
            />
            <Button
              variant="subtle"
              color="gray"
              leftSection={<IconFilterOff size={16} aria-hidden />}
              onClick={onReset}
              disabled={!hasActiveFilters(filters)}
            >
              Clear filters
            </Button>
          </Group>
        </Grid.Col>
      </Grid>
    </Paper>
  );
}
