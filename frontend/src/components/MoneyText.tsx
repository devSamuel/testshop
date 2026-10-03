import { Text, type TextProps } from "@mantine/core";
import type { DecimalString } from "../api/types";
import { formatCents, formatMoney, type Cents } from "../lib/money";

type MoneyTextProps = TextProps & { currency?: string } & (
    { value: DecimalString; cents?: never } | { cents: Cents; value?: never }
  );

export function MoneyText({ value, cents, currency = "USD", ...props }: MoneyTextProps) {
  const formatted =
    value === undefined ? formatCents(cents, currency) : formatMoney(value, currency);
  return (
    <Text style={{ fontVariantNumeric: "tabular-nums" }} {...props}>
      {formatted}
    </Text>
  );
}
