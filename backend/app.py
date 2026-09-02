from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime
from math import asin, cos, radians, sin, sqrt
from zoneinfo import ZoneInfo

from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
    latitude: float | None = Query(default=None, description="Latitude of the reference point"),
    longitude: float | None = Query(default=None, description="Longitude of the reference point"),
    db: AsyncSession = Depends(get_session),
) -> list[StoreMinimalResponse]:
    """GET /stores — list all stores, optionally filtered by town, active status, and whether they are open now.

    If latitude and longitude are both provided, results are sorted ascending by haversine distance
    from the reference point (closest first). Providing only one of them is invalid.
    """
    if (latitude is None) != (longitude is None):
        raise HTTPException(
            status_code=400,
            detail="Both 'latitude' and 'longitude' query parameters must be provided together.",
        )

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

    if latitude is not None and longitude is not None:
        def haversine_km(store_lat: float, store_lon: float) -> float:
            R = 6371.0
            lat1, lon1 = radians(latitude), radians(longitude)
            lat2, lon2 = radians(store_lat), radians(store_lon)
            dlat, dlon = lat2 - lat1, lon2 - lon1
            a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
            return 2 * R * asin(sqrt(a))

        stores.sort(key=lambda s: haversine_km(s.latitude, s.longitude))

    return [StoreMinimalResponse.model_validate(s) for s in stores]


@app.get("/products/{store_id}", response_model=list[ProductMinimalResponse])
async def get_products(
    store_id: str,
    is_active: bool = Query(default=True, description="Filter by active status"),
    today_only: bool = Query(default=True, description="Return only products posted today (Serbian time)"),
    db: AsyncSession = Depends(get_session),
) -> list[ProductMinimalResponse]:
    """GET /products/{id} — list products belonging to the given store, filtered by active status and posting day."""
    stmt = select(Product).where(Product.store_id == store_id, Product.is_active == is_active)

    if today_only:
        now = datetime.now(SERBIA_TZ)
        start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        stmt = stmt.where(Product.creation_date >= start_of_day)

    result = await db.execute(stmt)
    products = result.scalars().all()
    return [ProductMinimalResponse.model_validate(p) for p in products]


@app.get("/towns", response_model=list[str])
async def get_towns(db: AsyncSession = Depends(get_session)) -> list[str]:
    """GET /towns — list all town names, sorted by number of stores descending (most stores first)."""
    stmt = (
        select(Store.town)
        .group_by(Store.town)
        .order_by(func.count(Store.id).desc())
    )
    result = await db.execute(stmt)
    return result.scalars().all()
