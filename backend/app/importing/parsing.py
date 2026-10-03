import codecs
import csv
import io
import itertools
import re
from collections.abc import Iterator
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from enum import StrEnum
from typing import Any, BinaryIO

from app.catalog.normalize import (
    UNCATEGORIZED,
    category_display,
    category_key,
    collapse_whitespace,
    contains_markup,
    is_valid_sku,
    normalize_sku,
)
from app.core.money import to_weight

REQUIRED_COLUMNS = ("sku", "name", "price", "stock")
OPTIONAL_COLUMNS = ("description", "category", "weight_kg")
KNOWN_COLUMNS = REQUIRED_COLUMNS + OPTIONAL_COLUMNS

HEADER_ALIASES = {
    "product_name": "name",
    "title": "name",
    "product_sku": "sku",
    "unit_price": "price",
    "price_usd": "price",
    "qty": "stock",
    "quantity": "stock",
    "inventory": "stock",
    "stock_qty": "stock",
    "weight": "weight_kg",
    "weight_kgs": "weight_kg",
    "weightkg": "weight_kg",
    "weight_kilograms": "weight_kg",
    "category_name": "category",
    "desc": "description",
}

UNKNOWN_STOCK = {"n/a", "na", "null", "none", "unknown", "-", "--", "?", "tbd", "nan"}
ZERO_STOCK = {"out of stock", "sold out", "oos", "out-of-stock"}
FOREIGN_CURRENCY = re.compile(r"[€£¥₹]|\b(eur|gbp|jpy|inr|mxn|cad)\b", re.IGNORECASE)
USD_MARKERS = re.compile(r"\$|\busd\b|\bus\b", re.IGNORECASE)
STOCK_PATTERN = re.compile(
    r"([+-]?\d[\d,]*)(\.0+)?\s*(units?|pcs?|pieces?|items?|ea|each|u)?\.?", re.IGNORECASE
)
WEIGHT_PATTERN = re.compile(
    r"(\d+(?:[.,]\d+)?)\s*(kg|kgs|kilograms?|kilos?|g|gr|grams?|lb|lbs|pounds?|oz|ounces?)?\.?",
    re.IGNORECASE,
)
WEIGHT_FACTORS: dict[str, tuple[Decimal, str]] = {
    "g": (Decimal("0.001"), "grams"),
    "gr": (Decimal("0.001"), "grams"),
    "gram": (Decimal("0.001"), "grams"),
    "grams": (Decimal("0.001"), "grams"),
    "lb": (Decimal("0.45359237"), "pounds"),
    "lbs": (Decimal("0.45359237"), "pounds"),
    "pound": (Decimal("0.45359237"), "pounds"),
    "pounds": (Decimal("0.45359237"), "pounds"),
    "oz": (Decimal("0.028349523125"), "ounces"),
    "ounce": (Decimal("0.028349523125"), "ounces"),
    "ounces": (Decimal("0.028349523125"), "ounces"),
}
MAX_PRICE = Decimal("9999999999.99")
MAX_STOCK = 10_000_000
MAX_WEIGHT = Decimal("9999999.999")
MAX_DESCRIPTION = 5000
PLACEHOLDER_STOCK = re.compile(r"9{4,}")


class Severity(StrEnum):
    error = "error"
    warning = "warning"


@dataclass(frozen=True, slots=True)
class Issue:
    row: int | None
    severity: Severity
    message: str
    field: str | None = None
    value: str | None = None

    def as_dict(self) -> dict[str, object]:
        return {
            "row": self.row,
            "severity": self.severity.value,
            "field": self.field,
            "value": self.value,
            "message": self.message,
        }


@dataclass(frozen=True, slots=True)
class ParsedRow:
    row: int
    sku: str
    name: str
    description: str
    category: str
    price: Decimal
    stock: int
    weight_kg: Decimal | None


@dataclass(slots=True)
class RowOutcome:
    row: int
    parsed: ParsedRow | None
    issues: list[Issue] = field(default_factory=list)


class FieldError(ValueError):
    pass


class CsvStructureError(ValueError):
    pass


PROBE_CHUNK_BYTES = 1 << 16


@dataclass(slots=True)
class FileProbe:
    codec: str
    encoding: str
    lines: int
    warnings: list[str] = field(default_factory=list)


def _decodes_as(stream: BinaryIO, codec: str) -> bool:
    stream.seek(0)
    decoder = codecs.getincrementaldecoder(codec)()
    try:
        while chunk := stream.read(PROBE_CHUNK_BYTES):
            decoder.decode(chunk)
        decoder.decode(b"", final=True)
    except UnicodeDecodeError:
        return False
    finally:
        stream.seek(0)
    return True


def probe_file(stream: BinaryIO) -> FileProbe:
    stream.seek(0)
    lines = 0
    last = b""
    while chunk := stream.read(PROBE_CHUNK_BYTES):
        lines += chunk.count(b"\n")
        last = chunk
    if last and not last.endswith(b"\n"):
        lines += 1
    stream.seek(0)
    if _decodes_as(stream, "utf-8-sig"):
        return FileProbe("utf-8-sig", "utf-8", lines)
    if _decodes_as(stream, "cp1252"):
        return FileProbe("cp1252", "cp1252", lines, ["File is not valid UTF-8; decoded as Windows-1252"])
    return FileProbe("latin-1", "latin-1", lines, ["File is not valid UTF-8; decoded as Latin-1"])


def normalize_header(raw: str) -> str:
    cleaned = collapse_whitespace(raw.replace("﻿", "")).lower()
    cleaned = re.sub(r"[()\[\]]", " ", cleaned)
    cleaned = re.sub(r"[\s\-./]+", "_", cleaned).strip("_")
    return HEADER_ALIASES.get(cleaned, cleaned)


def detect_delimiter(text: str) -> str:
    first_line = text.lstrip().split("\n", 1)[0]
    candidates = [",", ";", "\t", "|"]
    counts = {c: first_line.count(c) for c in candidates}
    best = max(candidates, key=lambda c: counts[c])
    return best if counts[best] > 0 else ","


@dataclass(slots=True)
class HeaderMap:
    columns: dict[str, int]
    raw_headers: list[str]
    ignored: list[str]


def map_headers(headers: list[str]) -> HeaderMap:
    columns: dict[str, int] = {}
    ignored: list[str] = []
    for index, raw in enumerate(headers):
        canonical = normalize_header(raw)
        if canonical in KNOWN_COLUMNS and canonical not in columns:
            columns[canonical] = index
        elif raw.strip():
            ignored.append(raw.strip())
    missing = [c for c in REQUIRED_COLUMNS if c not in columns]
    if missing:
        raise CsvStructureError(
            f"Missing required column(s): {', '.join(missing)}. "
            f"Found: {', '.join(h.strip() for h in headers if h.strip()) or 'none'}"
        )
    return HeaderMap(columns=columns, raw_headers=headers, ignored=ignored)


def _group_ok(groups: list[str]) -> bool:
    return bool(groups[0]) and len(groups[0]) <= 3 and all(len(g) == 3 for g in groups[1:])


def parse_price(raw: str) -> tuple[Decimal, list[str]]:
    warnings: list[str] = []
    value = collapse_whitespace(raw)
    if not value:
        raise FieldError("Price is required")
    if FOREIGN_CURRENCY.search(value):
        raise FieldError("Price is not in USD; currency conversion is not supported")
    value = USD_MARKERS.sub("", value).replace(" ", "")
    if value.startswith("(") and value.endswith(")"):
        raise FieldError("Price must not be negative")
    if value.startswith("-"):
        raise FieldError("Price must not be negative")
    value = value.removeprefix("+")
    if not re.search(r"\d", value):
        raise FieldError(
            f"Price is text ('{raw.strip()}'), not a number; enter 0.00 if the product is intentionally free"
        )
    if not re.fullmatch(r"[\d.,]+", value):
        raise FieldError("Price is not a number")
    if "," in value and "." in value:
        decimal_sep = "," if value.rfind(",") > value.rfind(".") else "."
        thousands_sep = "." if decimal_sep == "," else ","
        integer, _, fraction = value.rpartition(decimal_sep)
        if not _group_ok(integer.split(thousands_sep)) or thousands_sep in fraction:
            raise FieldError("Price has an ambiguous number format")
        normalized = integer.replace(thousands_sep, "") + "." + fraction
        if decimal_sep == ",":
            warnings.append(f"Interpreted European number format '{raw.strip()}' as {normalized}")
    elif "," in value:
        parts = value.split(",")
        if len(parts) == 2 and 1 <= len(parts[1]) <= 2:
            normalized = parts[0] + "." + parts[1]
            warnings.append(f"Interpreted decimal comma '{raw.strip()}' as {normalized}")
        elif _group_ok(parts):
            normalized = "".join(parts)
        else:
            raise FieldError("Price has an ambiguous number format")
    elif value.count(".") > 1:
        parts = value.split(".")
        if not _group_ok(parts):
            raise FieldError("Price has an ambiguous number format")
        normalized = "".join(parts)
        warnings.append(f"Interpreted '{raw.strip()}' as {normalized} (dots as thousands separators)")
    else:
        normalized = value
    if re.fullmatch(r"\.\d+", normalized):
        normalized = "0" + normalized
    elif re.fullmatch(r"\d+\.", normalized):
        normalized = normalized[:-1]
    if not re.fullmatch(r"\d+(\.\d+)?", normalized):
        raise FieldError("Price is not a number")
    try:
        price = Decimal(normalized)
    except InvalidOperation as exc:
        raise FieldError("Price is not a number") from exc
    exponent = price.as_tuple().exponent
    if isinstance(exponent, int) and exponent < -2:
        raise FieldError("Price has more than 2 decimal places; refusing to round money silently")
    if price > MAX_PRICE:
        raise FieldError("Price is unrealistically large")
    if price == 0:
        warnings.append("Price is 0.00")
    return price.quantize(Decimal("0.01")), warnings


def parse_stock(raw: str) -> tuple[int, list[str]]:
    value = collapse_whitespace(raw).lower()
    if not value:
        raise FieldError("Stock is required")
    if value in UNKNOWN_STOCK:
        raise FieldError(f"Stock is unknown ('{raw.strip()}'); refusing to guess a quantity")
    if value in ZERO_STOCK:
        return 0, [f"Stock '{raw.strip()}' interpreted as 0"]
    match = STOCK_PATTERN.fullmatch(value)
    if not match:
        raise FieldError("Stock is not a whole number")
    number, decimal_zero, unit = match.groups()
    if number.startswith("-"):
        raise FieldError("Stock must not be negative")
    digits = number.lstrip("+")
    if "," in digits:
        if not _group_ok(digits.split(",")):
            raise FieldError("Stock is not a whole number")
        digits = digits.replace(",", "")
    stock = int(digits)
    if stock > MAX_STOCK:
        raise FieldError("Stock is unrealistically large")
    warnings: list[str] = []
    if decimal_zero or unit or value != digits:
        warnings.append(f"Stock '{raw.strip()}' interpreted as {stock}")
    return stock, warnings


def parse_weight(raw: str) -> tuple[Decimal | None, list[str]]:
    value = collapse_whitespace(raw).lower()
    if not value or value in UNKNOWN_STOCK:
        return None, []
    if value.startswith("-"):
        raise FieldError("Weight must not be negative")
    match = WEIGHT_PATTERN.fullmatch(value)
    if not match:
        raise FieldError("Weight is not a number")
    number, unit = match.groups()
    warnings: list[str] = []
    if "," in number:
        number = number.replace(",", ".")
        warnings.append(f"Interpreted decimal comma in weight '{raw.strip()}'")
    weight = Decimal(number)
    unit = (unit or "kg").lower()
    if unit in WEIGHT_FACTORS:
        weight = weight * WEIGHT_FACTORS[unit][0]
    if weight > MAX_WEIGHT:
        raise FieldError("Weight is unrealistically large")
    rounded = to_weight(weight)
    if unit in WEIGHT_FACTORS:
        warnings.append(f"Converted weight from {WEIGHT_FACTORS[unit][1]}: '{raw.strip()}' -> {rounded} kg")
    elif rounded != weight:
        warnings.append(f"Weight rounded to 3 decimals: {rounded} kg")
    return rounded, warnings


def parse_record(row_number: int, record: dict[str, str]) -> RowOutcome:
    outcome = RowOutcome(row=row_number, parsed=None)
    errors: list[Issue] = []

    def error(field_name: str, message: str) -> None:
        errors.append(Issue(row_number, Severity.error, message, field_name, record.get(field_name)))

    def warn(field_name: str, message: str) -> None:
        outcome.issues.append(
            Issue(row_number, Severity.warning, message, field_name, record.get(field_name))
        )

    sku = normalize_sku(record.get("sku", ""))
    if not sku:
        error("sku", "SKU is required")
    elif not is_valid_sku(sku):
        error("sku", "SKU must be 1-64 characters: letters, digits, '.', '_', '/', '-'")

    name = collapse_whitespace(record.get("name", ""))
    if not name:
        error("name", "Name is required")
    elif len(name) > 255:
        error("name", "Name is longer than 255 characters")
    elif contains_markup(name):
        error("name", "Name contains HTML markup; product text must be plain text")

    description = (record.get("description") or "").strip()
    if contains_markup(description):
        error("description", "Description contains HTML markup; product text must be plain text")
    if len(description) > MAX_DESCRIPTION:
        description = description[:MAX_DESCRIPTION]
        warn("description", f"Description truncated to {MAX_DESCRIPTION} characters")

    raw_category = record.get("category", "")
    category = category_display(raw_category)
    if category == UNCATEGORIZED and not collapse_whitespace(raw_category):
        warn("category", "Category is empty; using 'Uncategorized'")
    elif len(category) > 100:
        error("category", "Category is longer than 100 characters")

    price = Decimal("0")
    try:
        price, price_warnings = parse_price(record.get("price", ""))
        for message in price_warnings:
            warn("price", message)
    except FieldError as exc:
        error("price", str(exc))

    stock = 0
    try:
        stock, stock_warnings = parse_stock(record.get("stock", ""))
        for message in stock_warnings:
            warn("stock", message)
        if PLACEHOLDER_STOCK.fullmatch(str(stock)):
            warn("stock", f"Stock {stock} looks like a placeholder for 'unlimited'; imported as {stock}")
    except FieldError as exc:
        error("stock", str(exc))

    weight: Decimal | None = None
    try:
        weight, weight_warnings = parse_weight(record.get("weight_kg", ""))
        for message in weight_warnings:
            warn("weight_kg", message)
    except FieldError as exc:
        error("weight_kg", str(exc))
    else:
        if weight is None:
            warn("weight_kg", "Weight is missing; stored as unknown")

    if errors:
        outcome.issues = errors + outcome.issues
        return outcome
    outcome.parsed = ParsedRow(
        row=row_number,
        sku=sku,
        name=name,
        description=description,
        category=category,
        price=price,
        stock=stock,
        weight_kg=weight,
    )
    return outcome


@dataclass(slots=True)
class ParseStats:
    rows_total: int = 0
    rows_invalid: int = 0
    blank_rows: int = 0
    duplicates: int = 0
    encoding: str = "utf-8"
    delimiter: str = ","

    @property
    def rows_valid(self) -> int:
        return self.rows_total - self.rows_invalid


@dataclass(slots=True)
class ParsedBatch:
    rows: list[ParsedRow]
    issues: list[Issue]


def _row_signature(row: ParsedRow) -> int:
    return hash((row.name, row.description, category_key(row.category), row.price, row.stock, row.weight_kg))


class CsvStream:
    def __init__(self, stream: BinaryIO, *, max_rows: int, batch_size: int) -> None:
        self._stream = stream
        self._max_rows = max_rows
        self._batch_size = batch_size
        self._first_sku_row: dict[str, tuple[int, int]] = {}
        self._header: HeaderMap | None = None
        self._records: Iterator[list[str]] | None = None
        self._reader: Any = None
        self._nul_reported = False
        self.stats = ParseStats()

    def open(self) -> list[Issue]:
        probe = probe_file(self._stream)
        if probe.lines > self._max_rows + 1:
            raise CsvStructureError(f"File has more than {self._max_rows} data rows")
        self.stats.encoding = probe.encoding
        issues = [Issue(None, Severity.warning, w) for w in probe.warnings]
        text = io.TextIOWrapper(self._stream, encoding=probe.codec, newline="")
        lines = self._strip_nul(text, issues)
        buffered: list[str] = []
        first = ""
        for line in lines:
            buffered.append(line)
            if line.strip():
                first = line
                break
        self.stats.delimiter = detect_delimiter(first)
        if self.stats.delimiter != ",":
            issues.append(
                Issue(None, Severity.warning, f"Detected delimiter {self.stats.delimiter!r} instead of ','")
            )
        reader = csv.reader(itertools.chain(buffered, lines), delimiter=self.stats.delimiter, strict=False)
        self._reader = reader
        self._records = iter(reader)
        try:
            for values in self._records:
                if any(v.strip() for v in values):
                    self._header = map_headers(values)
                    break
        except csv.Error as exc:
            raise CsvStructureError(f"Malformed CSV: {exc}") from exc
        if self._header is None:
            raise CsvStructureError("File is empty or has no header row")
        if self._header.ignored:
            issues.append(
                Issue(None, Severity.warning, f"Ignored unknown column(s): {', '.join(self._header.ignored)}")
            )
        return issues

    def _strip_nul(self, text: io.TextIOWrapper, issues: list[Issue]) -> Iterator[str]:
        for line in text:
            if "\x00" in line:
                if not self._nul_reported:
                    self._nul_reported = True
                    issues.append(
                        Issue(None, Severity.warning, "File contained NUL bytes; they were removed")
                    )
                line = line.replace("\x00", "")
            yield line

    def next_batch(self) -> ParsedBatch | None:
        if self._records is None or self._header is None:
            raise RuntimeError("open() must be called first")
        header = self._header
        rows: list[ParsedRow] = []
        issues: list[Issue] = []
        processed = 0
        try:
            for values in self._records:
                line_number = int(self._reader.line_num)
                if not any(v.strip() for v in values):
                    self.stats.blank_rows += 1
                    continue
                self.stats.rows_total += 1
                if self.stats.rows_total > self._max_rows:
                    raise CsvStructureError(f"File has more than {self._max_rows} data rows")
                parsed, skipped = self._parse_values(line_number, values, header, issues)
                if parsed is not None:
                    rows.append(parsed)
                elif not skipped:
                    self.stats.rows_invalid += 1
                processed += 1
                if processed >= self._batch_size:
                    break
        except csv.Error as exc:
            raise CsvStructureError(f"Malformed CSV: {exc}") from exc
        if processed == 0:
            return None
        return ParsedBatch(rows=rows, issues=issues)

    def _parse_values(
        self, line_number: int, values: list[str], header: HeaderMap, issues: list[Issue]
    ) -> tuple[ParsedRow | None, bool]:
        record = {
            column: values[index] if index < len(values) else "" for column, index in header.columns.items()
        }
        outcome = parse_record(line_number, record)
        width = len(header.raw_headers)
        if len(values) > width and any(v.strip() for v in values[width:]):
            outcome.parsed = None
            outcome.issues.insert(
                0,
                Issue(
                    line_number,
                    Severity.error,
                    f"Row has {len(values)} values but the header has {width}; "
                    "values are probably shifted by an unquoted comma, so the row was rejected",
                ),
            )
        elif len(values) < width:
            outcome.issues.append(
                Issue(
                    line_number, Severity.warning, f"Row has {len(values)} values but the header has {width}"
                )
            )
        skipped = False
        parsed = outcome.parsed
        if parsed is not None:
            signature = _row_signature(parsed)
            seen = self._first_sku_row.get(parsed.sku)
            if seen is None:
                self._first_sku_row[parsed.sku] = (line_number, signature)
            else:
                first, first_signature = seen
                self.stats.duplicates += 1
                skipped = signature == first_signature
                if skipped:
                    message = f"Duplicate SKU {parsed.sku}: identical to row {first}; nothing to import"
                else:
                    message = (
                        f"Duplicate SKU {parsed.sku}: conflicts with row {first} (different values); "
                        "only the first row is imported, review which one is correct"
                    )
                outcome.issues.insert(
                    0,
                    Issue(
                        line_number,
                        Severity.warning if skipped else Severity.error,
                        message,
                        "sku",
                        parsed.sku,
                    ),
                )
                outcome.parsed = None
        issues.extend(outcome.issues)
        return outcome.parsed, skipped


@dataclass(slots=True)
class ParseResult:
    rows: list[ParsedRow]
    issues: list[Issue]
    stats: ParseStats

    @property
    def rows_total(self) -> int:
        return self.stats.rows_total

    @property
    def rows_invalid(self) -> int:
        return self.stats.rows_invalid

    @property
    def blank_rows(self) -> int:
        return self.stats.blank_rows

    @property
    def duplicates(self) -> int:
        return self.stats.duplicates

    @property
    def delimiter(self) -> str:
        return self.stats.delimiter

    @property
    def encoding(self) -> str:
        return self.stats.encoding


def parse_csv(data: bytes, max_rows: int, batch_size: int = 500) -> ParseResult:
    parser = CsvStream(io.BytesIO(data), max_rows=max_rows, batch_size=batch_size)
    issues = parser.open()
    rows: list[ParsedRow] = []
    while (batch := parser.next_batch()) is not None:
        rows.extend(batch.rows)
        issues.extend(batch.issues)
    return ParseResult(rows=rows, issues=issues, stats=parser.stats)
