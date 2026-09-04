from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta
from random import choice, randint, uniform
from zoneinfo import ZoneInfo

from sqlalchemy import func, select

from .db import Product, Store, StoreType, async_session, engine, init_db

DB_FILE = "nebacaj.db"
SERBIA_TZ = ZoneInfo("Europe/Belgrade")

NOVI_SAD_STORES = [
    (45.2551, 19.8450),
    (45.2512, 19.8600),
    (45.2470, 19.8280),
    (45.2670, 19.8450),
    (45.2730, 19.8400),
    (45.2780, 19.8250),
    (45.2620, 19.8780),
    (45.2500, 19.8730),
    (45.2400, 19.8500),
    (45.2750, 19.8600),
    (45.2590, 19.8150),
    (45.2415, 19.8615),
    (45.2680, 19.8120),
    (45.2560, 19.8980),
    (45.2460, 19.8840),
    (45.2720, 19.8830),
    (45.2550, 19.8300),
    (45.2630, 19.8250),
    (45.2760, 19.8440),
    (45.2690, 19.8550),
]

BELGRADE_STORES = [
    (44.8230, 20.4300),
    (44.8050, 20.4780),
    (44.8140, 20.4850),
    (44.7990, 20.4550),
    (44.8360, 20.4560),
    (44.7850, 20.4480),
    (44.8420, 20.5010),
    (44.8180, 20.4130),
    (44.8060, 20.4520),
    (44.8290, 20.4700),
    (44.7930, 20.4900),
    (44.8140, 20.4310),
    (44.8520, 20.4100),
    (44.7890, 20.4670),
    (44.8100, 20.4660),
    (44.8260, 20.4480),
    (44.8380, 20.4780),
    (44.8000, 20.4410),
    (44.8160, 20.4590),
    (44.8630, 20.4650),
]

SUBOTICA_STORES = [
    (46.1017, 19.6653),
    (46.0880, 19.6580),
    (46.1113, 19.6720),
    (46.0955, 19.6850),
    (46.1060, 19.6480),
    (46.0920, 19.7000),
]

NIS_STORES = [
    (43.3185, 21.8900),
    (43.3250, 21.9080),
    (43.3110, 21.8820),
    (43.3200, 21.9300),
    (43.3020, 21.8950),
    (43.3350, 21.8990),
]

KRAGUJEVAC_STORES = [
    (44.0120, 20.9110),
    (44.0200, 20.9250),
    (44.0080, 20.8980),
    (44.0180, 20.8800),
    (44.0040, 20.9200),
    (44.0250, 20.9050),
]

ZRENJANIN_STORES = [
    (45.3810, 20.3880),
    (45.3730, 20.4000),
    (45.3900, 20.3800),
    (45.3760, 20.3600),
    (45.3850, 20.4100),
    (45.3650, 20.3900),
]

NOVI_SAD_STREETS = ["Bulevar oslobođenja", "Svetozara Miletića", "Jevrejska", "Zmaj Jovina", "Bulevar cara Lazara", "Futoška", "Ulica Kralja Petra I", "Bulevar Mihajla Pupina"]
BELGRADE_STREETS = ["Knez Mihailova", "Bulevar kralja Aleksandra", "Terazije", "Vuka Karadžića", "Bulevar Mihajla Pupina", "Ulica Kralja Milana", "Ulica Kneza Miloša", "Bulevar oslobođenja"]
SUBOTICA_STREETS = ["Ulica cara Dušana", "Ulica Matije Korvina", "Šandora Petefija", "Ulica Kralja Petra"]
NIS_STREETS = ["Obrenovićeva", "Ulica Vojvode Putnika", "Ulica Nikole Pašića", "Bulevar Nemanjića", "Ulica Čair"]
KRAGUJEVAC_STREETS = ["Ulica Svetozara Markovića", "Ulica Kralja Aleksandra", "Ulica Đure Pucara", "Ulica Ljube Nenadovića"]
ZRENJANIN_STREETS = ["Ulica Kralja Aleksandra", "Ulica Subotička", "Ulica Kralja Petra Prvog", "Ulica Miloša Crnjanskog"]

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
    def _opening() -> int:
        return randint(0, 600)
    def _closing() -> int:
        return randint(1140, 1440)
    return Store(
        link=f"https://primer.rs/{(coords[0] + coords[1]):.4f}",
        phone_number=randint(200000000, 999999999),
        town=town,
        street=choice(streets),
        street_number=str(randint(1, 200)),
        latitude=coords[0],
        longitude=coords[1],
        name=_pick_store_name(store_type),
        description="Opis prodavnice",
        is_active=is_active,
        store_type=store_type,
        opening_minute_mon=_opening(),
        closing_minute_mon=_closing(),
        opening_minute_tue=_opening(),
        closing_minute_tue=_closing(),
        opening_minute_wed=_opening(),
        closing_minute_wed=_closing(),
        opening_minute_thu=_opening(),
        closing_minute_thu=_closing(),
        opening_minute_fri=_opening(),
        closing_minute_fri=_closing(),
        opening_minute_sat=_opening(),
        closing_minute_sat=_closing(),
        opening_minute_sun=_opening(),
        closing_minute_sun=_closing(),
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
        expiration_date=datetime.now(SERBIA_TZ) + timedelta(days=randint(1, 30), hours=randint(0, 23)) if randint(0, 1) else None,
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
            ("Subotica", SUBOTICA_STREETS, SUBOTICA_STORES),
            ("Niš", NIS_STREETS, NIS_STORES),
            ("Kragujevac", KRAGUJEVAC_STREETS, KRAGUJEVAC_STORES),
            ("Zrenjanin", ZRENJANIN_STREETS, ZRENJANIN_STORES),
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
