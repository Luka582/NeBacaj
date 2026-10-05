from __future__ import annotations

import asyncio
import logging
import os
import sqlite3
import tempfile
from contextlib import asynccontextmanager
from datetime import datetime, time, timedelta
from math import asin, cos, radians, sin, sqrt
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import ValidationError
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .cleanup import cleanup_cutoff, cleanup_old_products, claim_run, run_key_for
from .db import MaintenanceRun, Store, Product, User, UserRole, RecoveryCode, StoreType, SERBIA_TZ, async_session, get_session, init_db, now_serbia
from .emailer import send_recovery_code, send_temporary_password
from .images import delete_image, upload_image
from .schemas import (
    ChangePasswordRequest,
    LoginRequest,
    ProductCreate,
    ProductMinimalResponse,
    ProductResponse,
    ProductSearchResult,
    ProductUpdate,
    RecoverAccount,
    RequestRecoveryCode,
    StoreCreate,
    StoreMinimalResponse,
    StoreResponse,
    StoreUpdate,
    TokenResponse,
    UserCreate,
    UserResponse,
    UserUpdate,
)
from .security import (
    create_access_token,
    generate_recovery_code,
    generate_temp_password,
    get_current_user,
    get_current_user_allowing_password_change,
    hash_password,
    require_admin,
    verify_password,
)


logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()

    global _scheduler

    async def maintenance_job() -> None:
        run_key = run_key_for(now_serbia())
        async with async_session() as db:
            if not await claim_run(db, run_key):
                return
            cutoff = cleanup_cutoff()
            deleted = await cleanup_old_products(db, cutoff)
            print(
                f"[maintenance] {run_key}: soft-deleted {deleted} products older than "
                f"{cutoff:%Y-%m-%d %H:%M} or past their expiration date"
            )

    enabled = os.getenv("CLEANUP_ENABLED", "1").lower() not in {"0", "false", "no"}
    if enabled:
        scheduler = AsyncIOScheduler(timezone=SERBIA_TZ)
        scheduler.add_job(
            maintenance_job,
            CronTrigger(hour=3, minute=0, timezone=SERBIA_TZ),
            misfire_grace_time=6 * 3600,
            coalesce=True,
            id="cleanup_old_products",
        )
        scheduler.start()
        _scheduler = scheduler

        async with async_session() as db:
            run_key = run_key_for(now_serbia())
            existing = (
                await db.execute(select(MaintenanceRun).where(MaintenanceRun.run_key == run_key))
            ).scalar_one_or_none()
        if existing is None:
            await maintenance_job()

    try:
        yield
    finally:
        if _scheduler is not None:
            _scheduler.shutdown(wait=False)
            _scheduler = None


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SERBIA_TZ = ZoneInfo("Europe/Belgrade")

RECOVERY_CODE_TTL_MINUTES = 10
RECOVERY_CODE_COOLDOWN_SECONDS = 60
_recovery_code_cooldown: dict[str, float] = {}

LOGIN_MAX_ATTEMPTS = 5
LOGIN_COOLDOWN_SECONDS = 300
_login_attempts: dict[str, list[float]] = {}
DUMMY_PASSWORD_HASH = hash_password("nebacaj-dummy-password-for-timing")

MAX_IMAGE_BYTES = 10 * 1024 * 1024

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


def _require_store_open(store: Store) -> None:
    reference = now_serbia()
    if _active_shift(store, reference.weekday(), reference.hour * 60 + reference.minute) is None:
        raise HTTPException(status_code=409, detail="Store is closed")


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
                image_url=s.image_url,
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
    store_type: StoreType | None = Query(default=None, description="Restrict search to a single store type"),
    only_opened: bool = Query(default=True, description="Return only products from currently open stores"),
    today_only: bool = Query(default=True, description="Return only products posted during the store's current working shift"),
    db: AsyncSession = Depends(get_session),
) -> list[ProductSearchResult]:
    """GET /products/search?q=&town=&lat=&lng=&limit=&store_type=&only_opened=&today_only=

    Lists active products from active stores, optionally filtered by name (q), store town, and/or store
    type. Products from deactivated stores are never returned.

    By default results are scoped to the current working shift, matching ``GET /products/{store_id}`` and
    the ``today_products_count`` shown on the map: ``only_opened=false`` keeps products from any active
    store, and ``today_only=false`` keeps a store's products regardless of which shift posted them. When
    both lat and lng are provided, results are sorted by distance to that point (closest first, newest
    breaking ties); otherwise the newest products come first. Returns up to ``limit`` results (default 100).
    """
    stmt = (
        select(Product, Store)
        .join(Store, Product.store_id == Store.id)
        .where(Product.is_active.is_(True), Store.is_active.is_(True))
    )
    if q:
        stmt = stmt.where(Product.name.ilike(f"%{q}%"))
    if town:
        stmt = stmt.where(Store.town == town)
    if store_type:
        stmt = stmt.where(Store.store_type == store_type)

    rows = (await db.execute(stmt)).all()

    if only_opened or today_only:
        reference = datetime.now(SERBIA_TZ)
        today = reference.weekday()
        current_minutes = reference.hour * 60 + reference.minute
        kept: list[tuple[Product, Store]] = []
        for product, store in rows:
            if only_opened and _active_shift(store, today, current_minutes) is None:
                continue
            if today_only:
                window = _shift_window(store, reference)
                if window is None:
                    continue
                start, end = window
                if not start <= product.creation_date < end:
                    continue
            kept.append((product, store))
        rows = kept

    def to_result(product: Product, store: Store, distance_km: float | None) -> ProductSearchResult:
        return ProductSearchResult(
            product_id=product.id,
            product_name=product.name,
            amount=product.amount,
            old_price=product.old_price,
            new_price=product.new_price,
            image_url=product.image_url,
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


def _normalize_email(email: str) -> str:
    return email.strip().lower()


async def _get_store_or_404(store_id: str, db: AsyncSession) -> Store:
    result = await db.execute(select(Store).where(Store.id == store_id))
    store = result.scalar_one_or_none()
    if store is None:
        raise HTTPException(status_code=404, detail="Store not found")
    return store


async def _get_product_or_404(product_id: str, db: AsyncSession) -> Product:
    result = await db.execute(select(Product).where(Product.id == product_id))
    product = result.scalar_one_or_none()
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


async def _get_user_or_404(user_id: str, db: AsyncSession) -> User:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def _ensure_store_access(user: User, store_id: str) -> None:
    if user.role != UserRole.admin and user.store_id != store_id:
        raise HTTPException(status_code=403, detail="You do not manage this store")


async def _email_temp_password(email: str, temp_password: str) -> None:
    """Email the temp password, failing closed (502) when it cannot be delivered."""
    try:
        sent = await asyncio.to_thread(send_temporary_password, email, temp_password)
    except Exception:
        logger.exception("Failed to email temporary password to %s", email)
        raise HTTPException(
            502,
            "The temporary password email could not be sent. The account was not changed.",
        )
    if not sent:
        logger.warning("SMTP not configured; could not email temporary password to %s", email)
        raise HTTPException(
            502,
            "SMTP is not configured. The temporary password email could not be sent.",
        )


async def _email_recovery_code(email: str, code: str, expires_minutes: int) -> None:
    try:
        await asyncio.to_thread(send_recovery_code, email, code, expires_minutes)
    except Exception:
        logger.exception("Failed to email recovery code to %s", email)


def _parse_form_json(data: str, model):
    try:
        return model.model_validate_json(data)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc


def _normalize_serbia_wall(value: datetime) -> datetime:
    return value.astimezone(SERBIA_TZ).replace(tzinfo=None) if value.tzinfo is not None else value


def _validate_expiration_or_422(expiration: datetime | None, creation: datetime) -> None:
    if expiration is None:
        return
    exp = _normalize_serbia_wall(expiration)
    cr = _normalize_serbia_wall(creation)
    if exp < cr:
        raise HTTPException(status_code=422, detail="expiration_date must be greater than or equal to creation_date")


IMAGE_MAGIC: list[tuple[bytes, str]] = [
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"RIFF", "image/webp"),
]

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}

MIME_TO_EXTENSION = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
}


def _sniff_image_mime(data: bytes) -> str | None:
    for magic, mime in IMAGE_MAGIC:
        if data.startswith(magic):
            if magic == b"RIFF" and data[8:12] != b"WEBP":
                continue
            return mime
    return None


def _image_suffix(image: UploadFile, mime: str | None) -> str:
    suffix = Path(image.filename or "").suffix.lower()
    if suffix in IMAGE_EXTENSIONS:
        return suffix
    return MIME_TO_EXTENSION.get(mime or "", ".jpg")


async def _read_valid_image(image: UploadFile) -> tuple[bytes, str]:
    data = await image.read(MAX_IMAGE_BYTES + 1)
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded image is empty")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (max 10 MB)")
    mime = _sniff_image_mime(data)
    if mime is None:
        raise HTTPException(status_code=400, detail="Uploaded file is not a recognized image")
    return data, mime


async def _apply_image(
    entity: Store | Product,
    folder: str,
    image: UploadFile | None,
    image_url: str | None,
    image_url_set: bool,
) -> None:
    old_file_id = entity.image_file_id
    if image is not None:
        if image_url_set:
            raise HTTPException(status_code=400, detail="Provide either image_url or an image file, not both")
        data, mime = await _read_valid_image(image)
        try:
            url, file_id = await upload_image(
                data,
                f"{entity.id}-{uuid4().hex[:8]}{_image_suffix(image, mime)}",
                folder,
                mime,
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Image upload failed") from exc
        entity.image_url = url
        entity.image_file_id = file_id
        if old_file_id and old_file_id != file_id:
            await delete_image(old_file_id)
    elif image_url_set:
        entity.image_url = image_url
        entity.image_file_id = None
        if old_file_id:
            await delete_image(old_file_id)


async def _clear_image(entity: Store | Product) -> None:
    if entity.image_file_id:
        await delete_image(entity.image_file_id)
        entity.image_url = None
    entity.image_file_id = None


def _prune_login_attempts() -> None:
    cutoff = datetime.now(SERBIA_TZ).timestamp() - LOGIN_COOLDOWN_SECONDS
    stale = [key for key, stamps in _login_attempts.items() if not stamps or max(stamps) < cutoff]
    for key in stale:
        del _login_attempts[key]


@app.post("/auth/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_session),
) -> TokenResponse:
    """POST /auth/login — authenticate and receive a bearer token."""
    email = _normalize_email(body.email)
    client_ip = request.client.host if request.client else ""
    key = f"{client_ip}|{email}"
    now = datetime.now(SERBIA_TZ).timestamp()
    _prune_login_attempts()
    attempts = _login_attempts.get(key, [])
    if len(attempts) >= LOGIN_MAX_ATTEMPTS and now - attempts[-1] < LOGIN_COOLDOWN_SECONDS:
        raise HTTPException(
            status_code=429,
            detail="Too many failed attempts, please wait before trying again",
        )

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    password_hash = user.password_hash if user is not None else DUMMY_PASSWORD_HASH
    if not verify_password(body.password, password_hash):
        attempts.append(now)
        _login_attempts[key] = attempts[-LOGIN_MAX_ATTEMPTS:]
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Account disabled")
    return TokenResponse(
        access_token=create_access_token(user),
        role=user.role,
        must_change_password=user.must_change_password,
    )


@app.get("/auth/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user_allowing_password_change)) -> User:
    """GET /auth/me — return the currently authenticated user."""
    return user


@app.post("/auth/change-password")
async def change_password(
    body: ChangePasswordRequest,
    user: User = Depends(get_current_user_allowing_password_change),
    db: AsyncSession = Depends(get_session),
):
    """POST /auth/change-password — change the current user's password."""
    if not verify_password(body.old_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    await db.commit()
    return {"detail": "Password changed"}


@app.post("/auth/request-recovery-code")
async def request_recovery_code(
    body: RequestRecoveryCode,
    db: AsyncSession = Depends(get_session),
):
    """POST /auth/request-recovery-code — email a one-time code to recover the account.

    Always returns the same response whether the email exists or not, to avoid account probing.
    """
    email = _normalize_email(body.email)
    now = datetime.now(SERBIA_TZ).timestamp()
    if now - _recovery_code_cooldown.get(email, 0) < RECOVERY_CODE_COOLDOWN_SECONDS:
        raise HTTPException(status_code=429, detail="Too many requests, please wait before trying again")

    _recovery_code_cooldown[email] = now
    data = await db.execute(select(User).where(User.email == email))
    user = data.scalar_one_or_none()
    if user is not None and user.is_active:
        await db.execute(delete(RecoveryCode).where(RecoveryCode.user_id == user.id))
        code = generate_recovery_code()
        db.add(
            RecoveryCode(
                user_id=user.id,
                code_hash=hash_password(code),
                expires_at=now_serbia().replace(tzinfo=None) + timedelta(minutes=RECOVERY_CODE_TTL_MINUTES),
            )
        )
        await db.commit()
        await _email_recovery_code(user.email, code, RECOVERY_CODE_TTL_MINUTES)
    return {"detail": "If that email exists, a recovery code has been sent"}


@app.post("/auth/recover-account", response_model=TokenResponse)
async def recover_account(
    body: RecoverAccount,
    db: AsyncSession = Depends(get_session),
) -> TokenResponse:
    """POST /auth/recover-account — redeem a one-time code and set a new password (logs the user in)."""
    email = _normalize_email(body.email)
    data = await db.execute(select(User).where(User.email == email))
    user = data.scalar_one_or_none()
    invalid = HTTPException(status_code=400, detail="Invalid or expired recovery code")
    if user is None or not user.is_active:
        raise invalid

    result = await db.execute(
        select(RecoveryCode)
        .where(RecoveryCode.user_id == user.id)
        .order_by(RecoveryCode.created_at.desc())
    )
    recovery = result.scalars().first()
    if recovery is None or recovery.expires_at < now_serbia().replace(tzinfo=None):
        raise invalid
    if not verify_password(body.code, recovery.code_hash):
        raise invalid

    await db.delete(recovery)
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    await db.commit()
    return TokenResponse(
        access_token=create_access_token(user),
        role=user.role,
        must_change_password=False,
    )


@app.post("/stores", response_model=StoreResponse, dependencies=[Depends(require_admin)])
async def create_store(
    data: str = Form(...),
    image: UploadFile | None = File(default=None),
    db: AsyncSession = Depends(get_session),
) -> StoreResponse:
    """POST /stores — create a store (admin only). Multipart: `data` JSON + optional `image` file."""
    body = _parse_form_json(data, StoreCreate)
    store = Store(**body.model_dump(exclude={"image_url"}))
    db.add(store)
    await db.flush()
    await _apply_image(store, "/stores", image, body.image_url, "image_url" in body.model_fields_set)
    await db.commit()
    return StoreResponse.model_validate(store)


@app.put("/stores/{store_id}", response_model=StoreResponse, dependencies=[Depends(require_admin)])
async def update_store(
    store_id: str,
    data: str = Form(...),
    image: UploadFile | None = File(default=None),
    db: AsyncSession = Depends(get_session),
) -> StoreResponse:
    """PUT /stores/{id} — update a store (admin only). Multipart: `data` JSON + optional `image` file."""
    store = await _get_store_or_404(store_id, db)
    body = _parse_form_json(data, StoreUpdate)
    fields = body.model_dump(exclude_unset=True)
    image_url_set = "image_url" in fields
    fields.pop("image_url", None)
    for field, value in fields.items():
        setattr(store, field, value)
    await _apply_image(store, "/stores", image, body.image_url, image_url_set)
    await db.commit()
    return StoreResponse.model_validate(store)


@app.delete("/stores/{store_id}", status_code=204, dependencies=[Depends(require_admin)])
async def delete_store(store_id: str, db: AsyncSession = Depends(get_session)) -> None:
    """DELETE /stores/{id} — soft-delete a store, along with its products and workers (admin only)."""
    store = await _get_store_or_404(store_id, db)
    store.is_active = False
    await _clear_image(store)

    products = (
        await db.execute(
            select(Product).where(Product.store_id == store_id, Product.is_active.is_(True))
        )
    ).scalars().all()
    for product in products:
        product.is_active = False
        await _clear_image(product)

    workers = (
        await db.execute(
            select(User).where(
                User.role == UserRole.worker,
                User.store_id == store_id,
                User.is_active.is_(True),
            )
        )
    ).scalars().all()
    for worker in workers:
        worker.is_active = False

    await db.commit()


@app.get("/workers", response_model=list[UserResponse], dependencies=[Depends(require_admin)])
async def list_workers(db: AsyncSession = Depends(get_session)) -> list[User]:
    """GET /workers — list all worker accounts (admin only)."""
    result = await db.execute(select(User).where(User.role == UserRole.worker).order_by(User.created_at.desc()))
    return result.scalars().all()


@app.post("/workers", response_model=UserResponse, dependencies=[Depends(require_admin)])
async def create_worker(body: UserCreate, db: AsyncSession = Depends(get_session)) -> UserResponse:
    """POST /workers — create a worker account, email them a temporary password (admin only)."""
    email = _normalize_email(body.email)
    if "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email")
    existing = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="A user with this email already exists")
    await _get_store_or_404(body.store_id, db)

    temp_password = generate_temp_password()
    await _email_temp_password(email, temp_password)

    user = User(
        email=email,
        name=body.name,
        role=UserRole.worker,
        store_id=body.store_id,
        password_hash=hash_password(temp_password),
        must_change_password=True,
    )
    db.add(user)
    await db.commit()
    return UserResponse.model_validate(user)


@app.put("/workers/{worker_id}", response_model=UserResponse, dependencies=[Depends(require_admin)])
async def update_worker(worker_id: str, body: UserUpdate, db: AsyncSession = Depends(get_session)) -> UserResponse:
    """PUT /workers/{id} — update a worker's details (admin only)."""
    user = await _get_user_or_404(worker_id, db)
    data = body.model_dump(exclude_unset=True)

    if "email" in data:
        email = _normalize_email(data["email"])
        if "@" not in email:
            raise HTTPException(status_code=400, detail="Invalid email")
        conflicting = (
            await db.execute(select(User).where(User.email == email, User.id != worker_id))
        ).scalar_one_or_none()
        if conflicting is not None:
            raise HTTPException(status_code=409, detail="A user with this email already exists")
        data["email"] = email

    if data.get("role") == UserRole.admin:
        data["store_id"] = None
    elif "store_id" in data and data["store_id"] is not None:
        await _get_store_or_404(data["store_id"], db)

    for field, value in data.items():
        setattr(user, field, value)
    await db.commit()
    return UserResponse.model_validate(user)


@app.delete("/workers/{worker_id}", status_code=204, dependencies=[Depends(require_admin)])
async def delete_worker(worker_id: str, db: AsyncSession = Depends(get_session)) -> None:
    """DELETE /workers/{id} — soft-delete a worker account (admin only)."""
    user = await _get_user_or_404(worker_id, db)
    user.is_active = False
    await db.commit()


@app.post("/workers/{worker_id}/reset-password", response_model=UserResponse, dependencies=[Depends(require_admin)])
async def reset_worker_password(worker_id: str, db: AsyncSession = Depends(get_session)) -> UserResponse:
    """POST /workers/{id}/reset-password — generate a new temporary password and email it (admin only)."""
    user = await _get_user_or_404(worker_id, db)
    temp_password = generate_temp_password()
    await _email_temp_password(user.email, temp_password)

    user.password_hash = hash_password(temp_password)
    user.must_change_password = True
    await db.commit()
    return UserResponse.model_validate(user)


@app.post("/products", response_model=ProductResponse)
async def create_product(
    data: str = Form(...),
    image: UploadFile | None = File(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> ProductResponse:
    """POST /products — create a product in a store the current user manages."""
    body = _parse_form_json(data, ProductCreate)
    _ensure_store_access(user, body.store_id)
    store = await _get_store_or_404(body.store_id, db)
    _require_store_open(store)
    product = Product(**body.model_dump(exclude={"image_url"}))
    db.add(product)
    await db.flush()
    _validate_expiration_or_422(body.expiration_date, product.creation_date)
    await _apply_image(product, "/products", image, body.image_url, "image_url" in body.model_fields_set)
    await db.commit()
    return ProductResponse.model_validate(product)


@app.put("/products/{product_id}", response_model=ProductResponse)
async def update_product(
    product_id: str,
    data: str = Form(...),
    image: UploadFile | None = File(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> ProductResponse:
    """PUT /products/{id} — update a product (admin, or the worker managing its store)."""
    product = await _get_product_or_404(product_id, db)
    _ensure_store_access(user, product.store_id)
    store = await _get_store_or_404(product.store_id, db)
    _require_store_open(store)
    body = _parse_form_json(data, ProductUpdate)
    fields = body.model_dump(exclude_unset=True)
    image_url_set = "image_url" in fields
    fields.pop("image_url", None)
    if user.role != UserRole.admin and "store_id" in fields and fields["store_id"] != product.store_id:
        raise HTTPException(status_code=403, detail="You cannot move a product to another store")
    if "store_id" in fields:
        await _get_store_or_404(fields["store_id"], db)
    for field, value in fields.items():
        setattr(product, field, value)
    _validate_expiration_or_422(product.expiration_date, product.creation_date)
    await _apply_image(product, "/products", image, body.image_url, image_url_set)
    await db.commit()
    return ProductResponse.model_validate(product)


@app.delete("/products/{product_id}", status_code=204)
async def delete_product(
    product_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> None:
    """DELETE /products/{id} — soft-delete a product (admin, or the worker managing its store)."""
    product = await _get_product_or_404(product_id, db)
    _ensure_store_access(user, product.store_id)
    product.is_active = False
    await _clear_image(product)
    await db.commit()


def _copy_db_without_products(src_path: Path, dst_path: Path) -> None:
    """Copy schema plus every table except product rows. Blocking: run in a thread."""
    src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
    dst = sqlite3.connect(str(dst_path))
    try:
        src.row_factory = sqlite3.Row
        dst.execute("PRAGMA foreign_keys=ON")

        # Ordered so that foreign keys always resolve: every reference here points at
        # stores or users, both of which are copied before their dependents.
        table_order = ("stores", "users", "products", "recovery_codes", "maintenance_runs")
        for tname in table_order:
            s = src.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (tname,)).fetchone()
            if s and s[0]:
                dst.execute(s[0])
            if tname == "products":
                continue  # keep the table, drop the rows
            for row in src.execute(f"SELECT * FROM {tname}"):
                cols = row.keys()
                ph = ",".join("?" for _ in cols)
                dst.execute(f"INSERT INTO {tname} ({','.join(cols)}) VALUES ({ph})", [row[c] for c in cols])

        # sqlite_master has no SQL for implicit indexes, so nothing else to skip.
        for idx in src.execute("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL"):
            sql = idx[0]
            if sql and sql.strip().upper().startswith("CREATE INDEX"):
                try:
                    dst.execute(sql)
                except sqlite3.OperationalError:
                    pass  # e.g. an index whose table is absent in the export

        for trig in src.execute("SELECT sql FROM sqlite_master WHERE type='trigger' AND sql IS NOT NULL"):
            sql = trig[0]
            if sql:
                try:
                    dst.execute(sql)
                except sqlite3.OperationalError:
                    pass

        dst.commit()
    finally:
        dst.close()
        src.close()


class _TempDbFileResponse(FileResponse):
    """FileResponse that deletes its temp file even if the client aborts mid-download.

    FileResponse only runs a background task after the body is fully sent, so an
    interrupted download would otherwise leave the dump behind in the temp directory.
    """

    async def __call__(self, scope, receive, send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            Path(self.path).unlink(missing_ok=True)


@app.get("/admin/export-db")
async def export_db(user: User = Depends(require_admin)):
    """Export entire DB without product data (manual backup).

    Keeps schema+data for stores, users, recovery_codes, maintenance_runs; products table empty.
    The copy runs in a thread and the file is streamed, so neither the event loop nor
    memory scales with the database size.
    """
    src_path = Path("nebacaj.db").resolve()
    if not src_path.exists():
        raise HTTPException(status_code=404, detail="Database file not found")
    with tempfile.NamedTemporaryFile(delete=False, suffix=".db") as tf:
        dst_path = Path(tf.name)
    try:
        await asyncio.to_thread(_copy_db_without_products, src_path, dst_path)
    except BaseException:
        dst_path.unlink(missing_ok=True)
        raise

    # This dump contains password and recovery-code hashes, so record who took it.
    logger.warning(
        "DB export requested by admin %s (%d bytes, products excluded)",
        user.email,
        dst_path.stat().st_size,
    )
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    # FileResponse streams lazily, after this handler returns, so the temp file has to
    # outlive it; _TempDbFileResponse removes it once the body is done being sent.
    return _TempDbFileResponse(
        dst_path,
        media_type="application/vnd.sqlite3",
        filename=f"nebacaj_db_no_products_{ts}.db",
    )


@app.post("/products/{product_id}/reactivate", response_model=ProductResponse)
async def reactivate_product(
    product_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> ProductResponse:
    """POST /products/{id}/reactivate — repost a product as today's (admin, or the worker managing its store).

    Reactivation marks the product active and moves its creation date to now, so it lands in the
    store's current working shift and shows up in today's product lists again.
    """
    product = await _get_product_or_404(product_id, db)
    _ensure_store_access(user, product.store_id)
    store = await _get_store_or_404(product.store_id, db)
    _require_store_open(store)
    product.is_active = True
    product.creation_date = now_serbia()
    product.expiration_date = None
    await db.commit()
    return ProductResponse.model_validate(product)
