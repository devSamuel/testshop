from decimal import Decimal

import pytest

from app.importing.parsing import FieldError, parse_price, parse_stock, parse_weight


@pytest.mark.parametrize(
    ("raw", "expected", "warns"),
    [
        ("19.99", "19.99", False),
        ("  42  ", "42.00", False),
        ("$1,299.99", "1299.99", False),
        ("USD 15", "15.00", False),
        ("US$ 7.5", "7.50", False),
        ("1,299", "1299.00", False),
        ("12,99", "12.99", True),
        ("1.299,99", "1299.99", True),
        ("1.299.000", "1299000.00", True),
        (".5", "0.50", False),
        ("5.", "5.00", False),
        ("+3.10", "3.10", False),
        ("0", "0.00", True),
    ],
)
def test_price_accepts_real_world_formats(raw: str, expected: str, warns: bool) -> None:
    value, warnings = parse_price(raw)
    assert value == Decimal(expected)
    assert bool(warnings) is warns


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        ("", "required"),
        ("abc", "not a number"),
        ("-5", "negative"),
        ("(5.00)", "negative"),
        ("19.999", "more than 2 decimal places"),
        ("1e3", "not a number"),
        ("€12", "not in USD"),
        ("12 EUR", "not in USD"),
        ("1,2,3", "ambiguous"),
        ("12,3456", "ambiguous"),
        ("NaN", "not a number"),
        ("99999999999.00", "unrealistically large"),
        ("10000000000000000000000000", "unrealistically large"),
    ],
)
def test_price_rejects_unsafe_values(raw: str, message: str) -> None:
    with pytest.raises(FieldError, match=message):
        parse_price(raw)


@pytest.mark.parametrize(
    ("raw", "expected", "warns"),
    [
        ("12", 12, False),
        (" 7 ", 7, False),
        ("12.0", 12, True),
        ("1,200", 1200, True),
        ("12 units", 12, True),
        ("5 pcs.", 5, True),
        ("out of stock", 0, True),
        ("Sold Out", 0, True),
        ("0", 0, False),
    ],
)
def test_stock_accepts_string_or_int(raw: str, expected: int, warns: bool) -> None:
    value, warnings = parse_stock(raw)
    assert value == expected
    assert bool(warnings) is warns


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        ("", "required"),
        ("N/A", "unknown"),
        ("unknown", "unknown"),
        ("-", "unknown"),
        ("-3", "negative"),
        ("12.5", "whole number"),
        ("lots", "whole number"),
        ("99999999", "unrealistically large"),
    ],
)
def test_stock_refuses_to_guess(raw: str, message: str) -> None:
    with pytest.raises(FieldError, match=message):
        parse_stock(raw)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("1.5", "1.500"),
        ("1.5kg", "1.500"),
        ("1,5", "1.500"),
        ("500 g", "0.500"),
        ("2 lb", "0.907"),
        ("16oz", "0.454"),
        ("0.12345", "0.123"),
        ("", None),
        ("N/A", None),
    ],
)
def test_weight_normalizes_units_to_kg(raw: str, expected: str | None) -> None:
    value, _ = parse_weight(raw)
    assert value == (Decimal(expected) if expected else None)


@pytest.mark.parametrize("raw", ["-1", "heavy", "1.2.3kg", "5 tons", "10000000000000000000000000"])
def test_weight_rejects_garbage(raw: str) -> None:
    with pytest.raises(FieldError):
        parse_weight(raw)


def test_textual_price_explains_how_to_fix_it() -> None:
    with pytest.raises(FieldError, match=r"Price is text \('free'\), not a number; enter 0.00"):
        parse_price("free")
