from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String, Text, Integer, Enum
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from collections.abc import AsyncGenerator

DATABASE_URL = "sqlite+aiosqlite:///nebacaj.db"

engine = create_async_engine(DATABASE_URL, echo=True)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class StoreType(StrEnum):
    market = "market"
    bakery = "bakery"
    restaurant = "restaurant"
    other = "other"


class Store(Base):
    __tablename__ = "stores"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    link: Mapped[str | None] = mapped_column(Text, nullable=True)
    phone_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    town: Mapped[str] = mapped_column(String, nullable=False)
    street: Mapped[str] = mapped_column(String, nullable=False)
    street_number: Mapped[str] = mapped_column(String, nullable=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    store_type: Mapped[StoreType] = mapped_column(
        Enum(
            StoreType.market,
            StoreType.bakery,
            StoreType.restaurant,
            StoreType.other,
            name="store_type",
        ),
        nullable=False,
    )


class Product(Base):
    __tablename__ = "products"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    store_id: Mapped[str] = mapped_column(String(36), ForeignKey("stores.id"), nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=True)
    old_price: Mapped[float] = mapped_column(Float, nullable=False)
    new_price: Mapped[float] = mapped_column(Float, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    expiration_date: Mapped[datetime] = mapped_column(DateTime, nullable=False)


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        yield session
