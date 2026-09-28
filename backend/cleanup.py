from __future__ import annotations

import os
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .db import MaintenanceRun, Product, now_serbia
from .images import delete_image

CLEANUP_OLD_HOURS = int(os.getenv("CLEANUP_OLD_HOURS", "72"))


def cleanup_cutoff() -> datetime:
    return now_serbia().replace(tzinfo=None) - timedelta(hours=CLEANUP_OLD_HOURS)


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


async def cleanup_old_products(db: AsyncSession, cutoff: datetime | None = None) -> int:
    """Soft-delete products older than ``cutoff`` and free their ImageKit files.

    Rows are kept (is_active=False) for history; images are deleted so ImageKit
    does not accumulate orphaned files. Semantics mirror ``_clear_image``: the
    image_url is cleared only when a real ImageKit file existed. Returns the
    number of soft-deleted products.
    """
    cutoff = cutoff or cleanup_cutoff()
    rows = (await db.execute(select(Product).where(Product.creation_date < cutoff))).scalars().all()
    for product in rows:
        if product.image_file_id:
            await delete_image(product.image_file_id)
            product.image_url = None
        product.image_file_id = None
        product.is_active = False
    await db.commit()
    return len(rows)