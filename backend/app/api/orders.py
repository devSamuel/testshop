from typing import Annotated

from fastapi import APIRouter, Header, Query, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import func, select

from app.api.deps import ContainerDep, SessionDep
from app.core.errors import NotFoundError, problem
from app.inventory.service import ReservationLine
from app.orders.checkout import CheckoutCommand, CheckoutResult
from app.orders.models import Order, OrderStatus
from app.orders.schemas import CheckoutIn, OrderOut, OrderPage
from app.payments.provider import Card

router = APIRouter(prefix="/api/orders", tags=["orders"])

IdempotencyKey = Annotated[
    str,
    Header(
        alias="Idempotency-Key",
        min_length=8,
        max_length=100,
        description="Unique per checkout attempt; retries with the same key never create a second order",
    ),
]


@router.post(
    "",
    response_model=OrderOut,
    status_code=status.HTTP_201_CREATED,
    responses={
        200: {"model": OrderOut, "description": "Idempotent replay of an existing order"},
        202: {"model": OrderOut, "description": "Payment still processing; poll the order"},
        402: {"description": "Payment declined (problem+json with the order)"},
        409: {"description": "Insufficient stock"},
    },
)
async def place_order(
    body: CheckoutIn, idempotency_key: IdempotencyKey, container: ContainerDep, response: Response
) -> OrderOut | JSONResponse:
    outcome = await container.checkout.place_order(
        CheckoutCommand(
            idempotency_key=idempotency_key,
            email=str(body.email),
            lines=[ReservationLine(product_id=i.product_id, quantity=i.quantity) for i in body.items],
            card=Card(
                number=body.card.number,
                exp_month=body.card.exp_month,
                exp_year=body.card.exp_year,
                cvc=body.card.cvc,
            ),
        )
    )
    order = OrderOut.of(outcome.order)
    location = f"/api/orders/{order.id}"
    if outcome.result is CheckoutResult.replayed:
        return JSONResponse(
            order.model_dump(mode="json"),
            status_code=status.HTTP_200_OK,
            headers={"Idempotent-Replayed": "true", "Location": location},
        )
    if order.status == OrderStatus.payment_failed:
        failed = problem(
            status.HTTP_402_PAYMENT_REQUIRED,
            "payment-declined",
            "Payment declined",
            "The card was declined; the reserved stock was released",
            "/api/orders",
            order=order.model_dump(mode="json"),
        )
        failed.headers["Location"] = location
        return failed
    response.headers["Location"] = location
    if order.status == OrderStatus.pending_payment:
        response.status_code = status.HTTP_202_ACCEPTED
    return order


@router.get("", response_model=OrderPage)
async def list_orders(
    session: SessionDep,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    status_filter: Annotated[OrderStatus | None, Query(alias="status")] = None,
) -> OrderPage:
    conditions = [Order.status == status_filter] if status_filter else []
    total = await session.scalar(select(func.count()).select_from(Order).where(*conditions)) or 0
    orders = (
        await session.scalars(
            select(Order)
            .where(*conditions)
            .order_by(Order.id.desc())
            .limit(page_size)
            .offset((page - 1) * page_size)
        )
    ).all()
    return OrderPage(items=[OrderOut.of(o) for o in orders], total=total, page=page, page_size=page_size)


@router.get("/{order_id}", response_model=OrderOut)
async def get_order(order_id: int, session: SessionDep) -> OrderOut:
    order = await session.get(Order, order_id)
    if order is None:
        raise NotFoundError(f"Order {order_id} does not exist")
    return OrderOut.of(order)
