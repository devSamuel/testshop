import { Button, Group, Stack, Text, Tooltip } from "@mantine/core";
import { formatCardNumber, TEST_CARDS, type TestCard } from "../../lib/card";

interface TestCardPickerProps {
  onPick: (card: TestCard) => void;
  disabled?: boolean;
}

export function TestCardPicker({ onPick, disabled }: TestCardPickerProps) {
  return (
    <Stack gap={6}>
      <Text size="xs" c="dimmed">
        Test cards (any future expiry, any 3-digit CVC)
      </Text>
      <Group gap="xs" role="group" aria-label="Test cards">
        {TEST_CARDS.map((card) => (
          <Tooltip key={card.number} label={card.description} withArrow>
            <Button
              size="compact-sm"
              variant="light"
              color={card.color}
              radius="xl"
              disabled={disabled}
              onClick={() => onPick(card)}
              aria-label={`Use test card ${card.label}: ${formatCardNumber(card.number)}`}
            >
              {card.label}
            </Button>
          </Tooltip>
        ))}
      </Group>
    </Stack>
  );
}
