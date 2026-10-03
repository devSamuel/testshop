import { ActionIcon, Anchor, Group, NumberInput, Paper, Stack, Text, Tooltip } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { MoneyText } from "../../components/MoneyText";
import { useCart } from "./cartContext";
import { lineTotalCents, maxQuantity, type CartLine } from "./cartReducer";

interface CartLineItemProps {
  line: CartLine;
  locked: boolean;
}

export function CartLineItem({ line, locked }: CartLineItemProps) {
  const { dispatch } = useCart();
  const max = maxQuantity(line.stock);
  const atMax = line.quantity >= max;

  return (
    <Paper withBorder radius="md" p="md" component="li">
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
        <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
          <Anchor component={Link} to={`/products/${line.productId}`} fw={600} lineClamp={2}>
            {line.name}
          </Anchor>
          <Text size="xs" c="dimmed" ff="monospace">
            {line.sku}
          </Text>
          <Text size="sm" c="dimmed">
            <MoneyText span value={line.unitPrice} inherit /> each
          </Text>
        </Stack>
        <Tooltip label="Remove from cart" withArrow>
          <ActionIcon
            variant="subtle"
            color="red"
            size="lg"
            aria-label={`Remove ${line.name} from cart`}
            onClick={() => dispatch({ type: "remove", productId: line.productId })}
            disabled={locked}
          >
            <IconTrash size={18} aria-hidden />
          </ActionIcon>
        </Tooltip>
      </Group>
      <Group justify="space-between" align="flex-end" mt="sm" wrap="nowrap">
        <NumberInput
          aria-label={`Quantity for ${line.name}`}
          w={120}
          min={1}
          max={Math.max(1, max)}
          value={line.quantity}
          onChange={(value) => {
            if (typeof value === "number") {
              dispatch({ type: "setQuantity", productId: line.productId, quantity: value });
            }
          }}
          allowDecimal={false}
          allowNegative={false}
          clampBehavior="strict"
          disabled={locked}
          description={atMax ? `Max ${max}` : undefined}
          inputWrapperOrder={["input", "description"]}
        />
        <MoneyText
          cents={lineTotalCents(line)}
          fw={600}
          aria-label={`Line total for ${line.name}`}
        />
      </Group>
    </Paper>
  );
}
