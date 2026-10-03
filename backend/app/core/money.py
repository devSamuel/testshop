from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")
GRAM = Decimal("0.001")


def to_money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def to_weight(value: Decimal) -> Decimal:
    return value.quantize(GRAM, rounding=ROUND_HALF_UP)
