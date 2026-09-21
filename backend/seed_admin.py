from __future__ import annotations

import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import select

from .db import User, UserRole, async_session, init_db
from .security import hash_password

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


async def _run() -> None:
    await init_db()
    email = os.getenv("ADMIN_EMAIL", "").strip().lower()
    password = os.getenv("ADMIN_PASSWORD", "")
    if not email or not password:
        print("Set ADMIN_EMAIL and ADMIN_PASSWORD in .env first.")
        return
    async with async_session() as session:
        result = await session.execute(select(User).where(User.email == email))
        existing = result.scalar_one_or_none()
        if existing is not None:
            print(f"Admin {email} already exists")
            return
        session.add(
            User(
                email=email,
                password_hash=hash_password(password),
                role=UserRole.admin,
                name="Admin",
            )
        )
        await session.commit()
        print(f"Created admin {email}")


if __name__ == "__main__":
    asyncio.run(_run())