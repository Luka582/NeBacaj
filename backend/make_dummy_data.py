from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta
from random import choice, randint, uniform

from sqlalchemy import func, select

from .db import Product, Store, StoreType, async_session, engine, init_db

DB_FILE = "nebacaj.db"

NOVI_SAD_STORES = [
    (45.2452, 19.8427),
    (45.2545, 19.8424),
    (45.2671, 19.8335),
    (45.2640, 19.8322),
    (45.2519, 19.8368),
]

BELGRADE_STORES = [
    (44.7866, 20.4489),
    (44.8125, 20.4612),
    (44.7982, 20.4693),
    (44.8206, 20.4622),
    (44.8310, 20.4250),
]

NOVI_SAD_STREETS = ["Bulevar oslobođenja", "Svetozara Miletića", "Jevrejska", "Zmaj Jovina", "Bulevar cara Lazara"]
BELGRADE_STREETS = ["Knez Mihailova", "Bulevar kralja Aleksandra", "Terazije", "Vuka Karadžića", "Bulevar Mihajla Pupina"]

MARKET_NAMES = ["Maxi market", "Idea market", "Aroma market", "DIS market", "Univerexport market"]
BAKERY_NAMES = ["Pekara Srem", "Pekara Mitra", "Pekara Razvoj", "Mlinpek", "Pekara Bulevar"]
RESTAURANT_NAMES = ["Restoran Šaran", "Plava frajla", "Restoran Aqua Doria", "Triglav", "Restoran Le Petit"]
OTHER_NAMES = ["Prodavnica Tehnomedija", "Kiosk Delta", "Zlatara Venera", "Knjižara Plato", "Apoteka Farmanca"]

PRODUCT_NAMES = ["Hleb", "Mleko", "Jogurt", "Sir", "Jaja", "Kafa", "Čokolada", "Voćni jogurt", "Kifla", "Burek"]


def _pick_store_name(store_type: StoreType) -> str:
    if store_type == StoreType.market:
        return choice(MARKET_NAMES)
    if store_type == StoreType.bakery:
        return choice(BAKERY_NAMES)
    if store_type == StoreType.restaurant:
        return choice(RESTAURANT_NAMES)
    return choice(OTHER_NAMES)


def _make_store(town: str, streets: list[str], coords: tuple[float, float], is_active: bool) -> Store:
    store_type = choice(list(StoreType))
    return Store(
        link=f"https://primer.rs/{(coords[0] + coords[1]):.4f}",
        phone_number=randint(200000000, 999999999),
        town=town,
        street=choice(streets),
        street_number=str(randint(1, 200)),
        latitude=coords[0],
        longitude=coords[1],
        name=_pick_store_name(store_type),
        description="Opis proizvoda - Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis eu gravida lorem, vitae semper lectus. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Phasellus pulvinar sem lectus, quis tincidunt libero viverra ac. Mauris condimentum augue vulputate tempus scelerisque. Donec id lobortis nulla, in sodales magna. In vel blandit massa, molestie hendrerit urna.",
        is_active=is_active,
        store_type=store_type,
    )


def _make_product(store: Store, index: int) -> Product:
    amount = randint(1, 30) if randint(0, 1) else None
    old_price=round(uniform(5, 150), 2)
    new_price=round(uniform(1, old_price), 2)
    return Product(
        store_id=store.id,
        amount=amount,
        old_price=old_price,
        new_price=new_price,
        name=f"{choice(PRODUCT_NAMES)} #{index}",
        description="Opis proizvoda - Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis eu gravida lorem, vitae semper lectus. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Phasellus pulvinar sem lectus, quis tincidunt libero viverra ac. Mauris condimentum augue vulputate tempus scelerisque. Donec id lobortis nulla, in sodales magna. In vel blandit massa, molestie hendrerit urna." if randint(0, 1) else None,
        is_active=store.is_active,
        expiration_date=datetime.now() + timedelta(days=randint(1, 30), hours=randint(0, 23)),
    )


async def populate() -> None:
    await init_db()

    async with async_session() as session:
        existing = await session.scalar(select(func.count()).select_from(Store))
        if existing and existing > 0:
            print("Baza podataka je već popunjena. Preskačem.")
            return

        stores = []
        for town, streets, coords in [
            ("Novi Sad", NOVI_SAD_STREETS, NOVI_SAD_STORES),
            ("Beograd", BELGRADE_STREETS, BELGRADE_STORES),
        ]:
            for i, coord in enumerate(coords):
                is_active = i != 0
                store = _make_store(town, streets, coord, is_active)
                session.add(store)
                stores.append(store)

        await session.flush()

        for store in stores:
            for i in range(randint(0, 8)):
                session.add(_make_product(store, i + 1))

        await session.commit()
        print(f"Baza podataka popunjena sa {len(stores)} prodavnica i njihovih proizvoda.")


async def main() -> None:
    if os.path.exists(DB_FILE):
        print(f"Fajl baze podataka '{DB_FILE}' već postoji. Preskačem popunjavanje.")
        return
    await populate()
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
