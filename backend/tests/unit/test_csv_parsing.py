import io
from decimal import Decimal
from pathlib import Path

import pytest

from app.importing.parsing import CsvStructureError, Severity, normalize_header, parse_csv

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
HEADER = "name,sku,description,category,price,stock,weight_kg\n"


def errors(result, row: int | None = None) -> list[str]:
    return [
        i.message for i in result.issues if i.severity is Severity.error and (row is None or i.row == row)
    ]


def warnings(result) -> list[str]:
    return [i.message for i in result.issues if i.severity is Severity.warning]


def test_happy_path_maps_all_columns() -> None:
    result = parse_csv((HEADER + "Mouse,ms-1,Optical,electronics,10.50,3,0.1\n").encode(), 100)
    assert result.rows_total == 1
    row = result.rows[0]
    assert (row.sku, row.name, row.category, row.price, row.stock, row.weight_kg) == (
        "MS-1",
        "Mouse",
        "Electronics",
        Decimal("10.50"),
        3,
        Decimal("0.100"),
    )


def test_utf8_bom_and_header_aliases() -> None:
    data = "﻿Product Name , SKU ,Unit Price,Qty,Weight (kg)\nLamp,L-1,9.99,4,1.2\n".encode()
    result = parse_csv(data, 100)
    assert result.rows[0].name == "Lamp"
    assert result.rows[0].weight_kg == Decimal("1.200")
    assert not errors(result)


def test_semicolon_delimiter_is_detected() -> None:
    data = b"name;sku;price;stock\nLamp;L-1;9,99;4\n"
    result = parse_csv(data, 100)
    assert result.delimiter == ";"
    assert result.rows[0].price == Decimal("9.99")


def test_quoted_newlines_and_commas_inside_description() -> None:
    data = (HEADER + 'Desk,D-1,"Line one\nline two, with comma",Office,100,1,10\n').encode()
    result = parse_csv(data, 100)
    assert result.rows[0].description == "Line one\nline two, with comma"


def test_windows_1252_file_is_decoded_with_warning() -> None:
    data = (HEADER + "Caf\xe9 Mug,M-1,Nice,Kitchen,5,1,0.3\n").encode("cp1252")
    result = parse_csv(data, 100)
    assert result.rows[0].name == "Café Mug"
    assert any("Windows-1252" in w for w in warnings(result))


def test_missing_required_column_rejects_file() -> None:
    with pytest.raises(CsvStructureError, match="price"):
        parse_csv(b"name,sku,stock\nA,B,1\n", 100)


def test_empty_file_is_rejected() -> None:
    with pytest.raises(CsvStructureError, match="empty"):
        parse_csv(b"\n\n", 100)


def test_row_limit() -> None:
    data = (HEADER + "A,A-1,,X,1,1,1\n" * 5).encode()
    with pytest.raises(CsvStructureError, match="more than 3"):
        parse_csv(data, 3)


def test_shifted_columns_from_unquoted_comma_are_rejected() -> None:
    data = (HEADER + "Notebook,N-1,Dotted,Office,12,99,200,250 g\n").encode()
    result = parse_csv(data, 100)
    assert result.rows == []
    assert "shifted" in errors(result, 2)[0]


def test_short_rows_warn_but_import_when_required_fields_present() -> None:
    data = (HEADER + "Mouse,M-1,Optical,Electronics,10,3\n").encode()
    result = parse_csv(data, 100)
    assert len(result.rows) == 1
    assert any("6 values" in w for w in warnings(result))


def test_conflicting_duplicate_skus_keep_the_first_row_and_reject_the_rest() -> None:
    data = (HEADER + "First,DUP-1,,X,1,1,1\nSecond,dup-1,,X,2,2,1\nThird,DUP-1,,X,3,3,1\n").encode()
    result = parse_csv(data, 100)
    assert [r.name for r in result.rows] == ["First"]
    assert (result.duplicates, result.rows_invalid) == (2, 2)
    assert errors(result, 3) == [
        "Duplicate SKU DUP-1: conflicts with row 2 (different values); "
        "only the first row is imported, review which one is correct"
    ]


def test_identical_duplicate_is_skipped_with_a_warning_not_an_error() -> None:
    row = "Speaker,BS-021,Portable speaker,Electronics,59.99,110,0.8\n"
    result = parse_csv((HEADER + row + "Other,OT-1,,X,1,1,1\n" + row).encode(), 100)
    assert [r.sku for r in result.rows] == ["BS-021", "OT-1"]
    assert (result.rows_total, result.rows_invalid, result.duplicates) == (3, 0, 1)
    assert "identical to row 2; nothing to import" in warnings(result)[0]


def test_html_markup_in_text_is_rejected() -> None:
    data = (HEADER + "<script>alert('xss')</script>,XS-001,Fine,Electronics,19.99,100,0.1\n").encode()
    result = parse_csv(data, 100)
    assert result.rows == []
    assert errors(result, 2) == ["Name contains HTML markup; product text must be plain text"]
    described = parse_csv((HEADER + "Lamp,L-1,<b>bold</b> text,Home,1,1,1\n").encode(), 100)
    assert described.rows == []


def test_sql_looking_text_is_kept_verbatim() -> None:
    data = (HEADER + '"Robert\'); DROP TABLE products;--",SQL-001,Test,Games,9.99,50,0.5\n').encode()
    result = parse_csv(data, 100)
    assert [r.name for r in result.rows] == ["Robert'); DROP TABLE products;--"]
    assert not errors(result)


def test_placeholder_stock_is_flagged() -> None:
    result = parse_csv((HEADER + "Gift Card,GC-025,Digital,,25.00,99999,0\n").encode(), 100)
    assert result.rows[0].stock == 99999
    assert any("looks like a placeholder for 'unlimited'" in w for w in warnings(result))


def test_missing_weight_is_flagged() -> None:
    result = parse_csv((HEADER + "Keyboard,GK-088,RGB,Electronics,129.99,45\n").encode(), 100)
    assert result.rows[0].weight_kg is None
    assert "Weight is missing; stored as unknown" in warnings(result)


def test_duplicates_are_detected_across_batches() -> None:
    rows = "".join(f"Item {i},SKU-{i},,X,1,1,1\n" for i in range(7)) + "Again,SKU-1,,X,9,9,1\n"
    result = parse_csv((HEADER + rows).encode(), 100, batch_size=3)
    assert len(result.rows) == 7
    assert result.duplicates == 1


def test_batches_are_bounded_and_cover_every_row() -> None:
    from app.importing.parsing import CsvStream

    rows = "".join(f"Item {i},SKU-{i},,X,1,1,1\n" for i in range(10)) + ",,,,x,y,z\n"
    parser = CsvStream(io.BytesIO((HEADER + rows).encode()), max_rows=100, batch_size=4)
    parser.open()
    sizes = []
    while (batch := parser.next_batch()) is not None:
        sizes.append(
            len(batch.rows)
            + sum(1 for i in batch.issues if i.severity is Severity.error and i.field == "sku")
        )
    assert sizes == [4, 4, 3]
    assert (parser.stats.rows_total, parser.stats.rows_invalid) == (11, 1)


def test_invalid_utf8_late_in_a_large_file_is_still_detected() -> None:
    filler = "".join(f"Item {i},SKU-{i},,X,1,1,1\n" for i in range(3000)).encode()
    assert len(filler) > 65536
    data = HEADER.encode() + filler + "Caf\xe9 Mug,M-1,,Kitchen,5,1,0.3\n".encode("cp1252")
    result = parse_csv(data, 10_000)
    assert result.encoding == "cp1252"
    assert result.rows[-1].name == "Café Mug"


def _peak_parse_memory(count: int, description: str) -> int:
    import tracemalloc

    from app.importing.parsing import CsvStream

    body = "".join(f"Item {i},S-{i},{description},Cat,1.50,3,0.2\n" for i in range(count))
    stream = io.BytesIO((HEADER + body).encode())
    tracemalloc.start()
    parser = CsvStream(stream, max_rows=count + 1, batch_size=500)
    parser.open()
    while parser.next_batch() is not None:
        pass
    peak = tracemalloc.get_traced_memory()[1]
    tracemalloc.stop()
    return peak


def test_memory_does_not_grow_with_row_width() -> None:
    narrow = _peak_parse_memory(20_000, "short")
    wide = _peak_parse_memory(20_000, "x" * 2_000)
    assert wide < narrow * 1.5 + 4_000_000, (narrow, wide)


def test_memory_per_distinct_sku_is_bounded() -> None:
    assert _peak_parse_memory(50_000, "d") < 50_000 * 200 + 2_000_000


def test_every_error_in_a_row_is_reported_not_just_the_first() -> None:
    data = (HEADER + ",, ,,abc,N/A,heavy\n").encode()
    result = parse_csv(data, 100)
    assert result.rows_invalid == 1
    fields = {i.field for i in result.issues if i.severity is Severity.error}
    assert {"sku", "name", "price", "stock", "weight_kg"} <= fields


def test_blank_rows_are_skipped() -> None:
    data = (HEADER + "\nA,A-1,,X,1,1,1\n,,,,,,\n").encode()
    result = parse_csv(data, 100)
    assert result.rows_total == 1
    assert result.blank_rows == 2


def test_nul_bytes_are_stripped() -> None:
    data = (HEADER + "A\x00B,A-1,,X,1,1,1\n").encode()
    result = parse_csv(data, 100)
    assert result.rows[0].name == "AB"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("Weight (kg)", "weight_kg"), ("  SKU ", "sku"), ("Product-Name", "name"), ("QTY", "stock")],
)
def test_normalize_header(raw: str, expected: str) -> None:
    assert normalize_header(raw) == expected


def test_nasty_fixture_files_never_crash() -> None:
    for path in sorted(FIXTURES.glob("*.csv")):
        try:
            result = parse_csv(path.read_bytes(), 100_000)
        except CsvStructureError:
            continue
        assert result.rows_total >= len(result.rows)
