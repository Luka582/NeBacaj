from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, time, timedelta
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
    ProductSearchResult,
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

DAY_DURATION_COLUMNS = {
    0: Store.working_minutes_mon,
    1: Store.working_minutes_tue,
    2: Store.working_minutes_wed,
    3: Store.working_minutes_thu,
    4: Store.working_minutes_fri,
    5: Store.working_minutes_sat,
    6: Store.working_minutes_sun,
}


def _schedule(store: Store, weekday: int) -> tuple[int, int]:
    """Return (opening_minute, closing_minute) of the shift that starts on ``weekday``."""
    opening = int(getattr(store, DAY_OPEN_COLUMNS[weekday].key))
    duration = int(getattr(store, DAY_DURATION_COLUMNS[weekday].key))
    return opening, opening + duration


def _active_shift(store: Store, today: int, current_minutes: int) -> tuple[int, int] | None:
    """Return the (opening_minute, closing_minute) of the shift that is currently active, or None."""
    today_open, today_close = _schedule(store, today)
    if today_open <= current_minutes < today_close:
        return (today_open, today_close)

    yesterday = (today - 1) % 7
    y_open, y_close = _schedule(store, yesterday)
    if y_close > 1440 and current_minutes < y_close - 1440:
        return (y_open, y_close)

    return None


def _shift_window(store: Store, reference: datetime) -> tuple[datetime, datetime] | None:
    """Return the (start, end) datetimes of the store's currently active shift, or None if closed."""
    today = reference.weekday()
    current_minutes = reference.hour * 60 + reference.minute
    yesterday = (today - 1) % 7
    today_date = reference.date()

    today_open, today_close = _schedule(store, today)
    if today_open <= current_minutes < today_close:
        start_date = today_date
        opening, closing = today_open, today_close
    else:
        y_open, y_close = _schedule(store, yesterday)
        if y_close > 1440 and current_minutes < y_close - 1440:
            start_date = today_date - timedelta(days=1)
            opening, closing = y_open, y_close
        else:
            return None

    shift_start = datetime.combine(start_date, time()) + timedelta(minutes=opening)
    return shift_start, shift_start + timedelta(minutes=closing - opening)


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

    A store counts as open if it is within its own shift today OR within the overnight extension of
    yesterday's shift (a store that closes after midnight). ``today_opening_minute`` /
    ``today_closing_minute`` reflect the currently active shift, and ``today_products_count`` counts
    products posted during that shift (0 for closed stores).

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

    result = await db.execute(stmt)
    stores = result.scalars().all()

    now = datetime.now(SERBIA_TZ)
    today = now.weekday()
    current_minutes = now.hour * 60 + now.minute

    if only_opened:
        stores = [s for s in stores if _active_shift(s, today, current_minutes) is not None]

    if latitude is not None and longitude is not None:
        stores.sort(key=lambda s: haversine_km(latitude, longitude, s.latitude, s.longitude))

    broad_start = now - timedelta(hours=48)
    recent_result = await db.execute(
        select(Product.store_id, Product.creation_date)
        .where(Product.is_active.is_(True), Product.creation_date >= broad_start)
    )
    recent_rows = recent_result.all()

    count_map: dict[str, int] = {}
    for s in stores:
        window = _shift_window(s, now)
        if window is None:
            count_map[s.id] = 0
            continue
        start, end = window
        count_map[s.id] = sum(1 for store_id, created in recent_rows if store_id == s.id and start <= created < end)

    response = []
    for s in stores:
        opening, closing = _active_shift(s, today, current_minutes) or _schedule(s, today)
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
                today_products_count=count_map.get(s.id, 0),
                today_opening_minute=opening,
                today_closing_minute=closing,
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


@app.get("/products/search", response_model=list[ProductSearchResult])
async def search_products(
    q: str | None = Query(default=None, min_length=1, description="Search query for product name; omit to list all products"),
    town: str | None = Query(default=None, description="Restrict search to a single town"),
    lat: float | None = Query(default=None, ge=-90, le=90, description="Reference latitude for distance sorting"),
    lng: float | None = Query(default=None, ge=-180, le=180, description="Reference longitude for distance sorting"),
    limit: int = Query(default=100, ge=1, le=500, description="Maximum number of results"),
    db: AsyncSession = Depends(get_session),
) -> list[ProductSearchResult]:
    """GET /products/search?q=&town=&lat=&lng=&limit=

    Lists active products, optionally filtered by name (q) and/or store town. When both lat and lng
    are provided, results are sorted by distance to that point (closest first, newest breaking ties);
    otherwise the newest products come first. Returns up to ``limit`` results (default 100).
    """
    stmt = (
        select(Product, Store)
        .join(Store, Product.store_id == Store.id)
        .where(Product.is_active.is_(True))
    )
    if q:
        stmt = stmt.where(Product.name.ilike(f"%{q}%"))
    if town:
        stmt = stmt.where(Store.town == town)

    rows = (await db.execute(stmt)).all()

    def to_result(product: Product, store: Store, distance_km: float | None) -> ProductSearchResult:
        return ProductSearchResult(
            product_id=product.id,
            product_name=product.name,
            amount=product.amount,
            old_price=product.old_price,
            new_price=product.new_price,
            store_id=store.id,
            store_name=store.name,
            town=store.town,
            street=store.street,
            street_number=store.street_number,
            latitude=store.latitude,
            longitude=store.longitude,
            distance_km=distance_km,
        )

    if lat is not None and lng is not None:
        dists = {product.id: haversine_km(lat, lng, store.latitude, store.longitude) for product, store in rows}
        rows.sort(key=lambda r: r[0].creation_date, reverse=True)
        rows.sort(key=lambda r: dists[r[0].id])
        return [to_result(product, store, round(dists[product.id], 2)) for product, store in rows[:limit]]

    rows.sort(key=lambda r: r[0].creation_date, reverse=True)
    return [to_result(product, store, None) for product, store in rows[:limit]]


@app.get("/products/{store_id}", response_model=list[ProductMinimalResponse])
async def get_products(
    store_id: str,
    is_active: bool = Query(default=True, description="Filter by active status"),
    today_only: bool = Query(default=True, description="Return only products posted during the store's current working shift"),
    db: AsyncSession = Depends(get_session),
) -> list[ProductMinimalResponse]:
    """GET /products/{id} — list products belonging to the given store.

    When ``today_only`` is set, products are scoped to the store's currently active working shift
    (a shift may extend past midnight). A closed store has no active shift, so it returns no products.
    """
    stmt = select(Product).where(Product.store_id == store_id, Product.is_active == is_active)

    if today_only:
        store_result = await db.execute(select(Store).where(Store.id == store_id))
        store = store_result.scalar_one_or_none()
        window = _shift_window(store, datetime.now(SERBIA_TZ)) if store is not None else None
        if window is None:
            return []
        start, end = window
        stmt = stmt.where(Product.creation_date >= start, Product.creation_date < end)

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
