from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import FastAPI, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import Store, Product, get_session, init_db
from .schemas import (
    StoreResponse,
    StoreMinimalResponse,
    ProductResponse,
    ProductMinimalResponse,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()
    yield


app = FastAPI(lifespan=lifespan)

SERBIA_TZ = ZoneInfo("Europe/Belgrade")

DAY_OPEN_COLUMNS = {
    0: Store.opening_minute_mon,
    1: Store.opening_minute_tue,
    2: Store.opening_minute_wed,
    3: Store.opening_minute_thu,
    4: Store.opening_minute_fri,
    5: Store.opening_minute_sat,
    6: Store.opening_minute_sun,
}

DAY_CLOSE_COLUMNS = {
    0: Store.closing_minute_mon,
    1: Store.closing_minute_tue,
    2: Store.closing_minute_wed,
    3: Store.closing_minute_thu,
    4: Store.closing_minute_fri,
    5: Store.closing_minute_sat,
    6: Store.closing_minute_sun,
}


@app.get("/store/{store_id}", response_model=StoreResponse)
async def get_store(store_id: str, db: AsyncSession = Depends(get_session)) -> StoreResponse:
    """GET /store/{id} — fetch a single store by its id, or 404 if not found."""
    result = await db.execute(select(Store).where(Store.id == store_id))
    store = result.scalar_one_or_none()
    if store is None:
        raise HTTPException(status_code=404, detail="Store not found")
    return StoreResponse.model_validate(store)


@app.get("/product/{product_id}", response_model=ProductResponse)
async def get_product(product_id: str, db: AsyncSession = Depends(get_session)) -> ProductResponse:
    """GET /product/{id} — fetch a single product by its id, or 404 if not found."""
    result = await db.execute(select(Product).where(Product.id == product_id))
    product = result.scalar_one_or_none()
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return ProductResponse.model_validate(product)


@app.get("/stores", response_model=list[StoreMinimalResponse])
async def get_stores(
    town: str | None = Query(default=None, description="Filter stores by town"),
    is_active: bool = Query(default=True, description="Filter by active status"),
    only_opened: bool = Query(default=True, description="Return only currently open stores"),
    db: AsyncSession = Depends(get_session),
) -> list[StoreMinimalResponse]:
    """GET /stores — list all stores, optionally filtered by town, active status, and whether they are open now."""
    stmt = select(Store).where(Store.is_active == is_active)
    if town is not None:
        stmt = stmt.where(Store.town == town)

    if only_opened:
        now = datetime.now(SERBIA_TZ)
        today = now.weekday()
        current_minutes = now.hour * 60 + now.minute
        open_col = DAY_OPEN_COLUMNS[today]
        close_col = DAY_CLOSE_COLUMNS[today]
        stmt = stmt.where(open_col <= current_minutes, current_minutes < close_col)

    result = await db.execute(stmt)
    stores = result.scalars().all()
    return [StoreMinimalResponse.model_validate(s) for s in stores]


@app.get("/products/{store_id}", response_model=list[ProductMinimalResponse])
async def get_products(
    store_id: str,
    is_active: bool = Query(default=True, description="Filter by active status"),
    db: AsyncSession = Depends(get_session),
) -> list[ProductMinimalResponse]:
    """GET /products/{id} — list products belonging to the given store, filtered by active status."""
    stmt = select(Product).where(Product.store_id == store_id, Product.is_active == is_active)
    result = await db.execute(stmt)
    products = result.scalars().all()
    return [ProductMinimalResponse.model_validate(p) for p in products]
