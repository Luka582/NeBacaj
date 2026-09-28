from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String, Text, Integer, Enum
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from collections.abc import AsyncGenerator

DATABASE_URL = "sqlite+aiosqlite:///nebacaj.db"

SERBIA_TZ = ZoneInfo("Europe/Belgrade")


def now_serbia() -> datetime:
    return datetime.now(SERBIA_TZ)

engine = create_async_engine(DATABASE_URL, echo=True)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class StoreType(StrEnum):
    market = "market"
    bakery = "bakery"
    restaurant = "restaurant"
    other = "other"


class UserRole(StrEnum):
    admin = "admin"
    worker = "worker"


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
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_file_id: Mapped[str | None] = mapped_column(Text, nullable=True)
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

    opening_minute_mon: Mapped[int] = mapped_column(Integer, nullable=False)
    working_minutes_mon: Mapped[int] = mapped_column(Integer, nullable=False)
    opening_minute_tue: Mapped[int] = mapped_column(Integer, nullable=False)
    working_minutes_tue: Mapped[int] = mapped_column(Integer, nullable=False)
    opening_minute_wed: Mapped[int] = mapped_column(Integer, nullable=False)
    working_minutes_wed: Mapped[int] = mapped_column(Integer, nullable=False)
    opening_minute_thu: Mapped[int] = mapped_column(Integer, nullable=False)
    working_minutes_thu: Mapped[int] = mapped_column(Integer, nullable=False)
    opening_minute_fri: Mapped[int] = mapped_column(Integer, nullable=False)
    working_minutes_fri: Mapped[int] = mapped_column(Integer, nullable=False)
    opening_minute_sat: Mapped[int] = mapped_column(Integer, nullable=False)
    working_minutes_sat: Mapped[int] = mapped_column(Integer, nullable=False)
    opening_minute_sun: Mapped[int] = mapped_column(Integer, nullable=False)
    working_minutes_sun: Mapped[int] = mapped_column(Integer, nullable=False)


class Product(Base):
    __tablename__ = "products"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    store_id: Mapped[str] = mapped_column(String(36), ForeignKey("stores.id"), nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=True)
    old_price: Mapped[float] = mapped_column(Float, nullable=False)
    new_price: Mapped[float] = mapped_column(Float, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_file_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    expiration_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    creation_date: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=now_serbia)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    email: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    role: Mapped[UserRole] = mapped_column(
        Enum(
            UserRole.admin,
            UserRole.worker,
            name="user_role",
        ),
        nullable=False,
    )
    store_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stores.id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=now_serbia)


class RecoveryCode(Base):
    __tablename__ = "recovery_codes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    code_hash: Mapped[str] = mapped_column(String, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=now_serbia)


class MaintenanceRun(Base):
    __tablename__ = "maintenance_runs"

    run_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    ran_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=now_serbia)


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for table in ("stores", "products"):
            columns = (await conn.exec_driver_sql(f"PRAGMA table_info({table})")).fetchall()
            if not any(column[1] == "image_file_id" for column in columns):
                await conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN image_file_id TEXT")


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        yield session
