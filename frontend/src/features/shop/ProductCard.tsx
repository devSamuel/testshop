import { Anchor, Badge, Card, Group, Stack, Text } from "@mantine/core";
import { Link } from "react-router-dom";
import type { Product } from "../../api/types";
import { MoneyText } from "../../components/MoneyText";
import { StockBadge } from "../../components/StockBadge";
import { AddToCartButton } from "./AddToCartButton";

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  return (
    <Card withBorder radius="md" padding="lg" h="100%" component="article">
      <Stack gap="xs" style={{ flex: 1 }}>
        <Group justify="space-between" gap="xs" wrap="nowrap">
          <Badge variant="default" radius="sm" style={{ textTransform: "none" }} maw="60%">
            {product.category}
          </Badge>
          <StockBadge stock={product.stock} />
        </Group>
        <Anchor
          component={Link}
          to={`/products/${product.id}`}
          fw={600}
          c="var(--mantine-color-text)"
          lineClamp={2}
        >
          {product.name}
        </Anchor>
        <Text size="xs" c="dimmed" ff="monospace">
          {product.sku}
        </Text>
        {product.description ? (
          <Text size="sm" c="dimmed" lineClamp={2}>
            {product.description}
          </Text>
        ) : null}
      </Stack>
      <Group justify="space-between" align="center" mt="md" wrap="nowrap">
        <MoneyText value={product.price} fw={700} size="lg" />
        <AddToCartButton product={product} size="sm" />
      </Group>
    </Card>
  );
}
