import pytest

from app.inventory.handlers import desired_level
from app.inventory.models import AlertLevel
from app.inventory.service import ReservationLine, merge_lines
from app.orders.models import TRANSITIONS, OrderStatus, sources_for
from app.payments.provider import card_brand, luhn_valid


def test_terminal_states_have_no_exits() -> None:
    for status in (OrderStatus.paid, OrderStatus.payment_failed, OrderStatus.expired):
        assert TRANSITIONS[status] == frozenset()


def test_only_pending_orders_can_move() -> None:
    for target in (OrderStatus.paid, OrderStatus.payment_failed, OrderStatus.expired):
        assert sources_for(target) == [OrderStatus.pending_payment]
    assert sources_for(OrderStatus.pending_payment) == []


def test_merge_lines_sums_duplicates_and_sorts_to_prevent_deadlocks() -> None:
    merged = merge_lines(
        [ReservationLine(9, 1), ReservationLine(2, 3), ReservationLine(9, 4), ReservationLine(5, 1)]
    )
    assert merged == [ReservationLine(2, 3), ReservationLine(5, 1), ReservationLine(9, 5)]


@pytest.mark.parametrize(
    ("stock", "expected"),
    [
        (None, None),
        (0, AlertLevel.out_of_stock),
        (1, AlertLevel.low),
        (4, AlertLevel.low),
        (5, None),
        (50, None),
    ],
)
def test_alert_level_for_stock(stock: int | None, expected: AlertLevel | None) -> None:
    assert desired_level(stock, threshold=5) == expected


@pytest.mark.parametrize(
    ("number", "valid"),
    [
        ("4242424242424242", True),
        ("4000000000000002", True),
        ("4000000000000101", True),
        ("4242424242424241", False),
        ("1234", False),
        ("abcd", False),
    ],
)
def test_luhn(number: str, valid: bool) -> None:
    assert luhn_valid(number) is valid


@pytest.mark.parametrize(
    ("number", "brand"),
    [("4242424242424242", "visa"), ("5555555555554444", "mastercard"), ("378282246310005", "amex")],
)
def test_card_brand(number: str, brand: str) -> None:
    assert card_brand(number) == brand
