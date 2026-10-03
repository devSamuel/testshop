import asyncio
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Numeric, String, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.payments.provider import Card, ChargeResult, ChargeStatus

APPROVE_CARD = "4242424242424242"
DECLINE_CARD = "4000000000000002"
SLOW_APPROVE_CARD = "4000000000000101"


class SimulatedCharge(Base):
    __tablename__ = "payment_sim_charges"

    idempotency_key: Mapped[str] = mapped_column(String(100), primary_key=True)
    reference: Mapped[str] = mapped_column(String(64), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    decline_reason: Mapped[str | None] = mapped_column(String(64))
    card_last4: Mapped[str] = mapped_column(String(4), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class FakePaymentProvider:
    def __init__(self, sessions: async_sessionmaker[AsyncSession], slow_seconds: float) -> None:
        self._sessions = sessions
        self._slow_seconds = slow_seconds

    async def charge(
        self, *, idempotency_key: str, amount: Decimal, currency: str, card: Card
    ) -> ChargeResult:
        declined = card.number == DECLINE_CARD
        async with self._sessions() as session, session.begin():
            await session.execute(
                pg_insert(SimulatedCharge)
                .values(
                    idempotency_key=idempotency_key,
                    reference=f"ch_{uuid.uuid4().hex[:24]}",
                    amount=amount,
                    currency=currency,
                    status=ChargeStatus.declined if declined else ChargeStatus.succeeded,
                    decline_reason="card_declined" if declined else None,
                    card_last4=card.last4,
                )
                .on_conflict_do_nothing(index_elements=[SimulatedCharge.idempotency_key])
            )
            stored = await session.get_one(SimulatedCharge, idempotency_key)
            result = _to_result(stored)
        if card.number == SLOW_APPROVE_CARD:
            await asyncio.sleep(self._slow_seconds)
        return result

    async def get_status(self, idempotency_key: str) -> ChargeResult:
        async with self._sessions() as session:
            stored = await session.scalar(
                select(SimulatedCharge).where(SimulatedCharge.idempotency_key == idempotency_key)
            )
        if stored is None:
            return ChargeResult(status=ChargeStatus.not_found)
        return _to_result(stored)


def _to_result(stored: SimulatedCharge) -> ChargeResult:
    return ChargeResult(
        status=ChargeStatus(stored.status), reference=stored.reference, decline_reason=stored.decline_reason
    )
