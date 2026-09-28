from __future__ import annotations

import os
from datetime import datetime, timedelta

from sqlalchemy import delete, select
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
    """Hard-delete products older than ``cutoff`` and free their ImageKit files.

    Returns the number of deleted products. Deleting rows is safe: nothing references
    ``products``. ``delete_image`` is best-effort, so double-deletes are harmless.
    """
    cutoff = cutoff or cleanup_cutoff()
    rows = (await db.execute(select(Product).where(Product.creation_date < cutoff))).scalars().all()
    for product in rows:
        await delete_image(product.image_file_id)
    await db.execute(delete(Product).where(Product.id.in_([p.id for p in rows])))
    await db.commit()
    return len(rows)