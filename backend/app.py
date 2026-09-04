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


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    p1, l1 = radians(lat1), radians(lng1)
    p2, l2 = radians(lat2), radians(lng2)
    dlat, dlng = p2 - p1, l2 - l1
    a = sin(dlat / 2) ** 2 + cos(p1) * cos(p2) * sin(dlng / 2) ** 2
    return 2 * R * asin(sqrt(a))


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
        stores.sort(key=lambda s: haversine_km(latitude, longitude, s.latitude, s.longitude))

    now = datetime.now(SERBIA_TZ)
    today = now.weekday()
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)

    counts_result = await db.execute(
        select(Product.store_id, func.count(Product.id))
        .where(Product.is_active.is_(True), Product.creation_date >= start_of_day)
        .group_by(Product.store_id)
    )
    count_map = dict(counts_result.all())

    open_col = DAY_OPEN_COLUMNS[today]
    close_col = DAY_CLOSE_COLUMNS[today]

    response = []
    for s in stores:
        response.append(
            StoreMinimalResponse(
                id=s.id,
                town=s.town,
                street=s.street,
                street_number=s.street_number,
                latitude=s.latitude,
                longitude=s.longitude,
                name=s.name,
                store_type=s.store_type,
                today_products_count=int(count_map.get(s.id, 0)),
                today_opening_minute=int(getattr(s, open_col.key)),
                today_closing_minute=int(getattr(s, close_col.key)),
            )
        )
    return response


@app.get("/town/{latitude}/{longitude}", response_model=str)
async def get_town_from_coordinates(
    latitude: float,
    longitude: float,
    db: AsyncSession = Depends(get_session),
) -> str:
    """GET /town/{latitude}/{longitude} — return the town name most frequent among the 20 closest active stores."""
    result = await db.execute(select(Store).where(Store.is_active.is_(True)))
    stores = result.scalars().all()

    stores.sort(key=lambda s: haversine_km(latitude, longitude, s.latitude, s.longitude))

    closest = stores[:20]
    if not closest:
        raise HTTPException(status_code=404, detail="No stores found")

    counts: dict[str, int] = {}
    for store in closest:
        counts[store.town] = counts.get(store.town, 0) + 1

    return max(counts, key=lambda t: counts[t])


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
