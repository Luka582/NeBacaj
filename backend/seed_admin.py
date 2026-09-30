from __future__ import annotations

import asyncio
import getpass
import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import select

from .db import User, UserRole, async_session, init_db
from .security import hash_password

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def _prompt_password() -> str:
    while True:
        password = getpass.getpass("Admin password (min 8 characters): ")
        if len(password) < 8:
            print("Password must be at least 8 characters long.")
            continue
        repeat = getpass.getpass("Repeat password: ")
        if password != repeat:
            print("Passwords do not match, try again.")
            continue
        return password


async def _run() -> None:
    await init_db()
    email = os.getenv("ADMIN_EMAIL", "").strip().lower()
    if not email:
        print("Set ADMIN_EMAIL in .env first.")
        return
    async with async_session() as session:
        result = await session.execute(select(User).where(User.email == email))
        existing = result.scalar_one_or_none()
        if existing is not None:
            print(f"Admin {email} already exists")
            return

    password = _prompt_password()

    async with async_session() as session:
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