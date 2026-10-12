from __future__ import annotations

import os
from datetime import datetime
from enum import StrEnum
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String, Text, Integer, Enum, event
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from collections.abc import AsyncGenerator

DATABASE_URL = "sqlite+aiosqlite:///nebacaj.db"

SERBIA_TZ = ZoneInfo("Europe/Belgrade")


def now_serbia() -> datetime:
    return datetime.now(SERBIA_TZ)

engine = create_async_engine(DATABASE_URL, echo=os.getenv("SQL_ECHO") == "1")
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@event.listens_for(engine.sync_engine, "connect")
def _configure_sqlite(dbapi_connection, connection_record) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    # WAL lets readers and the single writer run concurrently instead of blocking
    # each other; it is persistent (stored in the DB header). busy_timeout makes a
    # lock collision wait instead of failing immediately with "database is locked".
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()


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
    announcement_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    announcement_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    announcement_image_file_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    announcement_periodic: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    announcement_activated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    announcement_open_min_mon: Mapped[int | None] = mapped_column(Integer, nullable=True)
    announcement_work_min_mon: Mapped[int | None] = mapped_column(Integer, nullable=True)
    announcement_open_min_tue: Mapped[int | None] = mapped_column(Integer, nullable=True)
    announcement_work_min_tue: Mapped[int | None] = mapped_column(Integer, nullable=True)
    announcement_open_min_wed: Mapped[int | None] = mapped_column(Integer, nullable=True)
    announcement_work_min_wed: Mapped[int | None] = mapped_column(Integer, nullable=True)
    announcement_open_min_thu: Mapped[int | None] = mapped_column(Integer, nullable=True)
    announcement_work_min_thu: Mapped[int | None] = mapped_column(Integer, nullable=True)
    announcement_open_min_fri: Mapped[int | None] = mapped_column(Integer, nullable=True)
    announcement_work_min_fri: Mapped[int | None] = mapped_column(Integer, nullable=True)
    announcement_open_min_sat: Mapped[int | None] = mapped_column(Integer, nullable=True)
    announcement_work_min_sat: Mapped[int | None] = mapped_column(Integer, nullable=True)
    announcement_open_min_sun: Mapped[int | None] = mapped_column(Integer, nullable=True)
    announcement_work_min_sun: Mapped[int | None] = mapped_column(Integer, nullable=True)
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
    store_id: Mapped[str] = mapped_column(String(36), ForeignKey("stores.id"), nullable=False, index=True)
    amount: Mapped[int] = mapped_column(Integer, nullable=True)
    old_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    new_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_file_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    expiration_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    creation_date: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=now_serbia, index=True)


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
    store_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stores.id"), nullable=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=now_serbia)
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class RecoveryCode(Base):
    __tablename__ = "recovery_codes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
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

        product_columns = (await conn.exec_driver_sql("PRAGMA table_info(products)")).fetchall()
        if any(column[1] == "old_price" and column[3] == 1 for column in product_columns):
            await conn.exec_driver_sql("ALTER TABLE products RENAME TO products_legacy")
            await conn.run_sync(Base.metadata.create_all)
            await conn.exec_driver_sql(
                "INSERT INTO products (id, store_id, amount, old_price, new_price, name, description, image_url, image_file_id, is_active, expiration_date, creation_date) "
                "SELECT id, store_id, amount, old_price, new_price, name, description, image_url, image_file_id, is_active, expiration_date, creation_date FROM products_legacy"
            )
            await conn.exec_driver_sql("DROP TABLE products_legacy")

        user_columns = (await conn.exec_driver_sql("PRAGMA table_info(users)")).fetchall()
        if not any(column[1] == "password_changed_at" for column in user_columns):
            await conn.exec_driver_sql("ALTER TABLE users ADD COLUMN password_changed_at DATETIME")

        for stmt in (
            "CREATE INDEX IF NOT EXISTS ix_products_store_id ON products (store_id)",
            "CREATE INDEX IF NOT EXISTS ix_products_creation_date ON products (creation_date)",
            "CREATE INDEX IF NOT EXISTS ix_users_store_id ON users (store_id)",
            "CREATE INDEX IF NOT EXISTS ix_recovery_codes_user_id ON recovery_codes (user_id)",
        ):
            await conn.exec_driver_sql(stmt)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        yield session
