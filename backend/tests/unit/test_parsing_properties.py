import contextlib
import csv
import io
from decimal import Decimal

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from app.importing.parsing import (
    KNOWN_COLUMNS,
    CsvStructureError,
    FieldError,
    parse_csv,
    parse_price,
    parse_record,
    parse_stock,
    parse_weight,
)

garbage = st.text(st.characters(codec="utf-8", exclude_categories=("Cs",)), max_size=40)


@given(garbage)
def test_field_parsers_only_raise_field_errors(value: str) -> None:
    for parser in (parse_price, parse_stock, parse_weight):
        with contextlib.suppress(FieldError):
            parser(value)


@given(st.dictionaries(st.sampled_from(KNOWN_COLUMNS), garbage), st.integers(min_value=2, max_value=10**6))
def test_any_record_parses_or_reports_structured_errors(record: dict[str, str], row: int) -> None:
    outcome = parse_record(row, record)
    if outcome.parsed is None:
        assert any(i.severity == "error" and i.row == row for i in outcome.issues)
    else:
        assert outcome.parsed.price >= 0
        assert outcome.parsed.stock >= 0
        assert outcome.parsed.sku == outcome.parsed.sku.upper()


@settings(max_examples=150, suppress_health_check=[HealthCheck.too_slow])
@given(st.binary(max_size=2000))
def test_arbitrary_bytes_never_crash_the_importer(data: bytes) -> None:
    try:
        result = parse_csv(data, 1000)
    except CsvStructureError:
        return
    assert result.rows_total >= len(result.rows) + result.rows_invalid - result.duplicates


valid_rows = st.lists(
    st.tuples(
        st.from_regex(r"[A-Z0-9]{1,8}", fullmatch=True),
        st.text(st.characters(codec="ascii", categories=("L", "N")), min_size=1, max_size=30),
        st.decimals(min_value=0, max_value=100000, places=2, allow_nan=False, allow_infinity=False),
        st.integers(min_value=0, max_value=100000),
    ),
    min_size=1,
    max_size=25,
    unique_by=lambda r: r[0],
)


@given(valid_rows)
def test_clean_csv_round_trips_exactly(rows: list[tuple[str, str, Decimal, int]]) -> None:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["sku", "name", "price", "stock"])
    for sku, name, price, stock in rows:
        writer.writerow([sku, name, str(price), str(stock)])
    result = parse_csv(buffer.getvalue().encode(), 1000)
    assert result.rows_invalid == 0
    parsed = {r.sku: (r.name, r.price, r.stock) for r in result.rows}
    assert parsed == {sku: (name, price, stock) for sku, name, price, stock in rows}
