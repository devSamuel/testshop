from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum
from typing import Protocol


class ChargeStatus(StrEnum):
    succeeded = "succeeded"
    declined = "declined"
    not_found = "not_found"


@dataclass(frozen=True, slots=True)
class Card:
    number: str
    exp_month: int
    exp_year: int
    cvc: str

    @property
    def last4(self) -> str:
        return self.number[-4:]


@dataclass(frozen=True, slots=True)
class ChargeResult:
    status: ChargeStatus
    reference: str | None = None
    decline_reason: str | None = None


class PaymentProvider(Protocol):
    async def charge(
        self, *, idempotency_key: str, amount: Decimal, currency: str, card: Card
    ) -> ChargeResult: ...

    async def get_status(self, idempotency_key: str) -> ChargeResult: ...


def luhn_valid(number: str) -> bool:
    if not number.isdigit() or not 12 <= len(number) <= 19:
        return False
    total = 0
    for index, char in enumerate(reversed(number)):
        digit = int(char)
        if index % 2 == 1:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
    return total % 10 == 0


def card_brand(number: str) -> str:
    if number.startswith("4"):
        return "visa"
    if number[:2] in {"51", "52", "53", "54", "55"} or "2221" <= number[:4] <= "2720":
        return "mastercard"
    if number[:2] in {"34", "37"}:
        return "amex"
    return "card"
