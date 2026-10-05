from __future__ import annotations

import os
from datetime import datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .db import MaintenanceRun, Product, now_serbia
from .images import delete_image

CLEANUP_OLD_HOURS = int(os.getenv("CLEANUP_OLD_HOURS", "72"))


def cleanup_cutoff() -> datetime:
    return now_serbia().replace(tzinfo=None) - timedelta(hours=CLEANUP_OLD_HOURS)


def now_naive() -> datetime:
    """Current Serbia time as a naive datetime, matching how dates are stored."""
    return now_serbia().replace(tzinfo=None)


def run_key_for(dt: datetime) -> str:
    return f"cleanup:{dt.date().isoformat()}"


async def claim_run(db: AsyncSession, run_key: str) -> bool:
    """Claim the maintenance run for ``run_key``.

    Returns False when another instance already claimed it (multi-worker / multi-computer safe).
    """
    db.add(MaintenanceRun(run_key=run_key))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return False
    return True


async def cleanup_old_products(
    db: AsyncSession,
    cutoff: datetime | None = None,
    now: datetime | None = None,
) -> int:
    """Soft-delete products that are older than ``cutoff`` or past their expiration date.

    Two independent rules soft-delete a product:

    * **Age** — ``creation_date`` older than ``cutoff`` (``CLEANUP_OLD_HOURS``, default 72h).
    * **Expiration** — ``expiration_date`` at or before ``now`` (defaults to the current
      Serbia time). Products with no ``expiration_date`` never expire this way.

    Rows are kept (is_active=False) for history; images are deleted so ImageKit does not
    accumulate orphaned files. Semantics mirror ``_clear_image``: the image_url is cleared
    only when a real ImageKit file existed. Only products that are still active are touched,
    so repeat runs are no-ops. Returns the number of soft-deleted products.
    """
    cutoff = cutoff or cleanup_cutoff()
    now = now or now_naive()
    rows = (
        await db.execute(
            select(Product).where(
                Product.is_active.is_(True),
                or_(
                    Product.creation_date < cutoff,
                    Product.expiration_date <= now,
                ),
            )
        )
    ).scalars().all()
    for product in rows:
        if product.image_file_id:
            await delete_image(product.image_file_id)
            product.image_url = None
        product.image_file_id = None
        product.is_active = False
    await db.commit()
    return len(rows)