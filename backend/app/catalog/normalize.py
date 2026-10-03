import re
import unicodedata

UNCATEGORIZED = "Uncategorized"
SKU_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9._/-]{0,63}$")
_WHITESPACE = re.compile(r"\s+")
_MARKUP = re.compile(r"<\s*/?\s*[A-Za-z][^>]*>")


def collapse_whitespace(value: str) -> str:
    return _WHITESPACE.sub(" ", unicodedata.normalize("NFKC", value)).strip()


def normalize_sku(value: str) -> str:
    return _WHITESPACE.sub("", unicodedata.normalize("NFKC", value)).upper()


def is_valid_sku(value: str) -> bool:
    return bool(SKU_PATTERN.fullmatch(value))


def category_key(value: str) -> str:
    return collapse_whitespace(value).casefold()


def category_display(value: str) -> str:
    cleaned = collapse_whitespace(value)
    if not cleaned:
        return UNCATEGORIZED
    if cleaned.isupper() or cleaned.islower():
        return " ".join(word[:1].upper() + word[1:].lower() for word in cleaned.split(" "))
    return cleaned


def contains_markup(value: str) -> bool:
    return bool(_MARKUP.search(value))
