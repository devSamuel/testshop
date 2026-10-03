import {
  Anchor,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  Divider,
  Grid,
  Group,
  NumberInput,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { IconPackage, IconShoppingCart } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { isNotFound } from "../../api/client";
import { productsApi } from "../../api/products";
import { queryKeys } from "../../api/queryKeys";
import type { Product } from "../../api/types";
import { EmptyState } from "../../components/EmptyState";
import { MoneyText } from "../../components/MoneyText";
import { PageHeader } from "../../components/PageHeader";
import { QueryState } from "../../components/QueryState";
import { StockBadge } from "../../components/StockBadge";
import { useCart } from "../cart/cartContext";
import { quantityInCart, remainingForProduct } from "../cart/cartReducer";
import { AddToCartButton } from "./AddToCartButton";
import { parseRouteId } from "../../lib/routeParams";

function ProductNotFound() {
  return (
    <>
      <PageHeader title="Product not found" />
      <EmptyState
        icon={<IconPackage size={30} stroke={1.5} />}
        title="This product isn't available"
        description="It may have been removed from the catalog."
        action={
          <Button component={Link} to="/">
            Back to the shop
          </Button>
        }
      />
    </>
  );
}

function ProductDetail({ product }: { product: Product }) {
  const { state } = useCart();
  const [quantity, setQuantity] = useState(1);
  const inCart = quantityInCart(state, product.id);
  const remaining = remainingForProduct(state, product);
  const effectiveQuantity = Math.max(1, Math.min(quantity, remaining));

  return (
    <>
      <Breadcrumbs mb="md">
        <Anchor component={Link} to="/">
          Shop
        </Anchor>
        <Text c="dimmed">{product.name}</Text>
      </Breadcrumbs>
      <PageHeader title={product.name} documentTitle={product.name} />
      <Grid gutter="xl">
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Stack gap="md">
            <Group gap="xs">
              <Badge variant="default" style={{ textTransform: "none" }}>
                {product.category}
              </Badge>
              <StockBadge stock={product.stock} />
            </Group>
            <Text c="dimmed" size="sm">
              SKU{" "}
              <Text span ff="monospace" c="var(--mantine-color-text)">
                {product.sku}
              </Text>
            </Text>
            <Text style={{ whiteSpace: "pre-line" }}>
              {product.description || "No description provided."}
            </Text>
            {product.weight_kg ? (
              <Text size="sm" c="dimmed">
                Weight: {product.weight_kg} kg
              </Text>
            ) : null}
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Card withBorder radius="md" padding="lg">
            <Stack gap="md">
              <Group justify="space-between" align="center">
                <MoneyText value={product.price} size="xl" fw={700} />
                <ThemeIcon variant="light" size="lg" radius="md" aria-hidden>
                  <IconPackage size={20} />
                </ThemeIcon>
              </Group>
              <Divider />
              <NumberInput
                label="Quantity"
                min={1}
                max={Math.max(1, remaining)}
                value={effectiveQuantity}
                onChange={(value) => setQuantity(typeof value === "number" ? value : 1)}
                allowDecimal={false}
                allowNegative={false}
                clampBehavior="strict"
                disabled={remaining === 0}
                description={
                  product.stock > 0 ? `${product.stock} available` : "Currently unavailable"
                }
              />
              <AddToCartButton product={product} quantity={effectiveQuantity} size="md" fullWidth />
              {inCart > 0 ? (
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    {inCart} in your cart
                  </Text>
                  <Anchor
                    component={Link}
                    to="/cart"
                    size="sm"
                    style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                  >
                    <IconShoppingCart size={14} aria-hidden /> View cart
                  </Anchor>
                </Group>
              ) : null}
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    </>
  );
}

export default function ProductDetailPage() {
  const productId = parseRouteId(useParams().id);
  const product = useQuery({
    queryKey: queryKeys.products.detail(productId ?? 0),
    queryFn: ({ signal }) => productsApi.get(productId ?? 0, signal),
    enabled: productId !== null,
  });

  if (productId === null || isNotFound(product.error)) return <ProductNotFound />;

  return (
    <QueryState query={product} errorTitle="Could not load this product">
      {(data) => <ProductDetail key={data.id} product={data} />}
    </QueryState>
  );
}
