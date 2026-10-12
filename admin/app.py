from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root))

import streamlit as st

from admin.api import Backend, BackendError, DEFAULT_BACKEND_URL

WEEKDAYS = [
    ("mon", "Monday"),
    ("tue", "Tuesday"),
    ("wed", "Wednesday"),
    ("thu", "Thursday"),
    ("fri", "Friday"),
    ("sat", "Saturday"),
    ("sun", "Sunday"),
]

STORE_TYPES = ["market", "bakery", "restaurant", "other"]
IMAGE_TYPES = ["jpg", "jpeg", "png", "webp"]
DEFAULT_HOURS = (8 * 60, 12 * 60)


def minutes_to_time(m: int) -> dt.time:
    m %= 1440
    return dt.time(m // 60, m % 60)


def fmt_minutes(m: int) -> str:
    m %= 1440
    return f"{m // 60:02d}:{m % 60:02d}"


def store_hours_from(store: dict) -> dict[str, tuple[int, int]]:
    return {
        day: (
            store.get(f"opening_minute_{day}", DEFAULT_HOURS[0]),
            store.get(f"working_minutes_{day}", DEFAULT_HOURS[1]),
        )
        for day, _ in WEEKDAYS
    }


def hours_to_payload(hours: dict[str, tuple[int, int]]) -> dict:
    payload = {}
    for day, (opening, duration) in hours.items():
        payload[f"opening_minute_{day}"] = opening
        payload[f"working_minutes_{day}"] = duration
    return payload


def seed(prefix: str, seed_id: Any, values: dict[str, Any]) -> None:
    if st.session_state.get(f"{prefix}_seed") == seed_id:
        return
    for key, value in values.items():
        st.session_state[f"{prefix}_{key}"] = value
    st.session_state[f"{prefix}_seed"] = seed_id


def seed_hours(prefix: str, seed_id: Any, hours: dict[str, tuple[int, int]]) -> None:
    if st.session_state.get(f"{prefix}_seed") == seed_id:
        return
    for day, _ in WEEKDAYS:
        opening, duration = hours[day]
        st.session_state[f"{prefix}_open_{day}"] = minutes_to_time(opening)
        st.session_state[f"{prefix}_dur_{day}"] = duration
    st.session_state[f"{prefix}_seed"] = seed_id


def presets_row(prefix: str) -> None:
    col1, col2 = st.columns(2)
    if col1.button("24/7", key=f"{prefix}_preset_247"):
        for day, _ in WEEKDAYS:
            st.session_state[f"{prefix}_open_{day}"] = dt.time(0, 0)
            st.session_state[f"{prefix}_dur_{day}"] = 1440
    if col2.button("09:00-17:00", key=f"{prefix}_preset_9to5"):
        for day, _ in WEEKDAYS:
            st.session_state[f"{prefix}_open_{day}"] = dt.time(9, 0)
            st.session_state[f"{prefix}_dur_{day}"] = 8 * 60


def render_hours(prefix: str) -> dict[str, tuple[int, int]]:
    result = {}
    for day, label in WEEKDAYS:
        left, middle, right = st.columns([2, 2, 2])
        with left:
            opening_time = st.time_input(f"Opening ({label})", key=f"{prefix}_open_{day}")
        with middle:
            duration = st.number_input(
                f"Minutes ({label})", min_value=0, max_value=1440, step=15, key=f"{prefix}_dur_{day}"
            )
        with right:
            opening = opening_time.hour * 60 + opening_time.minute
            closing = opening + duration
            if duration == 0:
                st.markdown("**Zatvoreno**")
            else:
                extra = " (+1d)" if closing >= 1440 else ""
                st.markdown(f"**Closes:** {fmt_minutes(closing)}{extra}")
        result[day] = (opening, duration)
    return result


def image_widgets(prefix: str, current_url: str | None, show_remove: bool = True):
    if current_url:
        try:
            st.image(current_url, width=160)
        except Exception:
            pass
    image = st.file_uploader("Upload image", type=IMAGE_TYPES, key=f"{prefix}_image")
    url = st.text_input("...or external image URL", key=f"{prefix}_url")
    remove = st.checkbox("Remove current image", key=f"{prefix}_remove") if show_remove else False
    return image, url.strip(), remove


def apply_image_choice(payload: dict, image, url: str, remove: bool) -> None:
    if image is not None:
        payload.pop("image_url", None)
    elif remove:
        payload["image_url"] = None
    elif url:
        payload["image_url"] = url


def handle_backend_error(error: BackendError) -> None:
    if error.status_code == 401:
        for key in ("token", "role", "email", "must_change_password"):
            st.session_state.pop(key, None)
        st.error("Session expired. Please log in again.")
        st.rerun()
        return
    st.error(error.detail)


def flash_message(kind: str, text: str) -> None:
    st.session_state["_flash"] = (kind, text)


def show_flash() -> None:
    flash = st.session_state.pop("_flash", None)
    if not flash:
        return
    getattr(st, flash[0])(flash[1])


def get_backend() -> Backend:
    return Backend(st.session_state.backend_url, st.session_state.token)


# --------------------------------------------------------------------- auth


def render_login() -> None:
    st.title("NeBacaj Admin")
    st.caption("Connect to the backend and log in with an admin account.")
    with st.form("login_form"):
        backend_url = st.text_input("Backend URL", value=st.session_state.backend_url)
        email = st.text_input("Email")
        password = st.text_input("Password", type="password")
        submitted = st.form_submit_button("Log in")
    if submitted:
        try:
            data = Backend(backend_url).login(email, password)
        except BackendError as error:
            st.error(error.detail)
            return
        if data.get("role") != "admin":
            st.error("Only admin accounts can use this panel.")
            return
        st.session_state.backend_url = backend_url.rstrip("/")
        st.session_state.token = data["access_token"]
        st.session_state.role = data["role"]
        st.session_state.email = email
        st.session_state.must_change_password = bool(data.get("must_change_password"))
        st.rerun()


def render_change_password(backend: Backend) -> None:
    st.title("Change password")
    st.warning("You must change your password before continuing.")
    with st.form("change_pass_form"):
        old = st.text_input("Current password", type="password")
        new = st.text_input("New password (min 8 characters)", type="password")
        repeat = st.text_input("Repeat new password", type="password")
        submitted = st.form_submit_button("Update password")
    if submitted:
        if new != repeat:
            st.error("Passwords do not match.")
        elif len(new) < 8:
            st.error("New password is too short (min 8 characters).")
        else:
            try:
                backend.change_password(old, new)
            except BackendError as error:
                st.error(error.detail)
                return
            st.session_state.must_change_password = False
            flash_message("success", "Password changed.")
            st.rerun()


def render_sidebar() -> str:
    with st.sidebar:
        st.markdown(f"**Backend:** {st.session_state.backend_url}")
        st.write(f"Logged in as `{st.session_state.get('email', '')}`")
        if st.button("Log out"):
            for key in ("token", "role", "email", "must_change_password"):
                st.session_state.pop(key, None)
            st.rerun()
    return st.sidebar.radio("Section", ["Stores", "Products", "Workers", "Database"])


# ------------------------------------------------------------------- stores


def page_stores(backend: Backend) -> None:
    st.subheader("Stores")
    try:
        active = backend.list_stores(True)
        inactive = backend.list_stores(False)
    except BackendError as error:
        handle_backend_error(error)
        return

    tab_list, tab_add = st.tabs(["Existing stores", "Add store"])

    with tab_list:
        all_stores = active + inactive
        if not all_stores:
            st.info("No stores found.")
            return
        inactive_ids = {s["id"] for s in inactive}

        def store_label(item: dict) -> str:
            base = f"{item['name']} — {item['town']}, {item['street']}"
            return base + (" (inactive)" if item["id"] in inactive_ids else "")

        store_ids = [s["id"] for s in all_stores]
        store_labels = {s["id"]: store_label(s) for s in all_stores}
        store_id = st.selectbox("Select store", store_ids, format_func=lambda x: store_labels.get(x, x))
        try:
            store = backend.get_store(store_id)
        except BackendError as error:
            handle_backend_error(error)
            return
        _render_store_edit(backend, store)

    with tab_add:
        _render_store_add(backend)


def _store_fields() -> tuple:
    return (
        "name", "town", "street", "street_number", "latitude", "longitude",
        "link", "phone_number", "description", "store_type", "is_active",
    )


def _store_basic_payload(prefix: str, submitted_values: dict[str, Any]) -> dict:
    payload = {}
    for field in _store_fields():
        value = submitted_values[field]
        if field in ("link", "description"):
            value = value or None
        if field == "phone_number":
            value = value if value else None
        payload[field] = value
    return payload


SERBIA_TZ = ZoneInfo("Europe/Belgrade")
DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def _serbia_now() -> dt.datetime:
    return dt.datetime.now(SERBIA_TZ)


def _store_open_now(store: dict) -> bool:
    now = _serbia_now()
    current = now.hour * 60 + now.minute
    today, prev = DAY_KEYS[now.weekday()], DAY_KEYS[(now.weekday() - 1) % 7]
    opening = store.get(f"opening_minute_{today}") or 0
    working = store.get(f"working_minutes_{today}") or 0
    if working > 0 and opening <= current < opening + working:
        return True
    opening = store.get(f"opening_minute_{prev}") or 0
    working = store.get(f"working_minutes_{prev}") or 0
    return working > 0 and opening + working > 1440 and current < opening + working - 1440


def _announcement_slot(store: dict, key: str) -> tuple[int, int] | None:
    opening = store.get(f"announcement_open_min_{key}")
    working = store.get(f"announcement_work_min_{key}")
    if isinstance(opening, (int, float)) and isinstance(working, (int, float)) and working > 0:
        return int(opening), int(working)
    return None


def announcement_active_now(store: dict) -> bool:
    if not store.get("announcement_periodic"):
        activated = store.get("announcement_activated_at")
        if not activated:
            return False
        try:
            ts = dt.datetime.fromisoformat(activated)
        except (TypeError, ValueError):
            return False
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=SERBIA_TZ)
        return ts.timestamp() > _serbia_now().timestamp() - 47 * 3600

    now = _serbia_now()
    current = now.hour * 60 + now.minute
    today = _announcement_slot(store, DAY_KEYS[now.weekday()])
    if today is not None and today[0] <= current < today[0] + today[1]:
        return True
    prev = _announcement_slot(store, DAY_KEYS[(now.weekday() - 1) % 7])
    return prev is not None and prev[0] + prev[1] > 1440 and current < prev[0] + prev[1] - 1440


def seed_announcement_schedule(prefix: str, seed_id: Any, store: dict) -> None:
    if st.session_state.get(f"{prefix}_ann_sched_seed") == seed_id:
        return
    for key, _ in WEEKDAYS:
        opening = store.get(f"announcement_open_min_{key}")
        working = store.get(f"announcement_work_min_{key}")
        enabled = opening is not None and working is not None
        st.session_state[f"{prefix}_ann_enabled_{key}"] = enabled
        st.session_state[f"{prefix}_ann_open_{key}"] = minutes_to_time(int(opening or 0))
        st.session_state[f"{prefix}_ann_dur_{key}"] = int(working or 0)
    st.session_state[f"{prefix}_ann_sched_seed"] = seed_id


def render_announcement_schedule(prefix: str, store: dict) -> dict[str, tuple[int, int] | None]:
    result: dict[str, tuple[int, int] | None] = {}
    for key, label in WEEKDAYS:
        enabled = st.checkbox(label, key=f"{prefix}_ann_enabled_{key}")
        left, right = st.columns(2)
        with left:
            opening_time = st.time_input("Start", key=f"{prefix}_ann_open_{key}", disabled=not enabled)
        with right:
            duration = st.number_input(
                "Minutes", min_value=0, max_value=1440, step=15, key=f"{prefix}_ann_dur_{key}", disabled=not enabled
            )
        if not enabled:
            result[key] = None
            continue
        opening = opening_time.hour * 60 + opening_time.minute
        result[key] = (opening, int(duration))
    return result


def announcement_schedule_errors(store: dict, schedule: dict[str, tuple[int, int] | None]) -> list[str]:
    errors = []
    for key, label in WEEKDAYS:
        entry = schedule.get(key)
        if entry is None:
            continue
        opening, duration = entry
        store_open = store.get(f"opening_minute_{key}")
        store_work = store.get(f"working_minutes_{key}")
        if not store_work or store_work <= 0:
            errors.append(f"{label}: prodavnica je tog dana zatvorena.")
        elif duration <= 0:
            errors.append(f"{label}: trajanje mora biti veće od 0 minuta.")
        elif store_open is None or opening < store_open or opening + duration > store_open + store_work:
            errors.append(f"{label}: termin mora biti u okviru radnog vremena prodavnice.")
    return errors


def announcement_schedule_payload(schedule: dict[str, tuple[int, int] | None]) -> dict[str, int | None]:
    payload: dict[str, int | None] = {}
    for key, _ in WEEKDAYS:
        entry = schedule.get(key)
        if entry is None:
            payload[f"open_min_{key}"] = None
            payload[f"work_min_{key}"] = None
        else:
            payload[f"open_min_{key}"] = entry[0]
            payload[f"work_min_{key}"] = entry[1]
    return payload


def _render_store_announcement(backend: Backend, store: dict) -> None:
    prefix = f"edit_ann_{store['id']}"
    periodic = bool(store.get("announcement_periodic"))
    status = "Aktivno" if announcement_active_now(store) else "Neaktivno"
    st.caption(f"Trenutno: **{status}** · režim: **{'Periodično' if periodic else 'Ručno'}**")

    tab_basic, tab_schedule, tab_manual = st.tabs(["Osnovno", "Raspored", "Aktivacija"])

    with tab_basic:
        seed(prefix, store["id"], {
            "description": store.get("announcement_description") or "",
            "periodic": periodic,
        })
        with st.form(f"form_{prefix}"):
            st.text_area("Tekst obaveštenja", key=f"{prefix}_description")
            st.checkbox("Periodično (ponavlja se po nedeljnom rasporedu)", key=f"{prefix}_periodic")
            image, url, remove = image_widgets(prefix, store.get("announcement_image_url"))
            submitted = st.form_submit_button("Sačuvaj obaveštenje")
        if submitted:
            payload = {
                "description": st.session_state[f"{prefix}_description"],
                "periodic": bool(st.session_state[f"{prefix}_periodic"]),
            }
            apply_image_choice(payload, image, url, remove)
            try:
                backend.update_announcement(store["id"], payload, image)
                flash_message("success", "Obaveštenje je sačuvano.")
                st.rerun()
            except BackendError as error:
                handle_backend_error(error)

    with tab_schedule:
        if not periodic:
            st.info("Raspored je dostupan samo u periodičnom režimu. Uključite „Periodično“ u kartici Osnovno.")
        else:
            seed_announcement_schedule(prefix, store["id"], store)
            st.markdown("**Nedeljni raspored obaveštenja**")
            schedule = render_announcement_schedule(prefix, store)
            errors = announcement_schedule_errors(store, schedule)
            for message in errors:
                st.error(message)
            if st.button("Sačuvaj raspored", key=f"{prefix}_save_schedule", disabled=bool(errors)):
                try:
                    backend.update_announcement(store["id"], announcement_schedule_payload(schedule))
                    flash_message("success", "Raspored obaveštenja je sačuvan.")
                    st.rerun()
                except BackendError as error:
                    handle_backend_error(error)

    with tab_manual:
        if periodic:
            st.info("Ručna aktivacija je dostupna samo u režimu „Ručno“.")
        else:
            open_now = _store_open_now(store)
            st.caption("Prodavnica je trenutno " + ("otvorena." if open_now else "zatvorena — aktivacija nije moguća."))
            col_on, col_off = st.columns(2)
            with col_on:
                activate = st.button("Aktiviraj", key=f"{prefix}_activate", disabled=not open_now)
            with col_off:
                deactivate = st.button("Deaktiviraj", key=f"{prefix}_deactivate", disabled=not open_now)
            if activate or deactivate:
                try:
                    backend.update_announcement(store["id"], {"manual_active": bool(activate)})
                    flash_message("success", "Obaveštenje je aktivirano." if activate else "Obaveštenje je deaktivirano.")
                    st.rerun()
                except BackendError as error:
                    handle_backend_error(error)


def _render_store_edit(backend: Backend, store: dict) -> None:
    prefix = f"edit_{store['id']}"
    seed(prefix, store["id"], {
        "name": store["name"],
        "town": store["town"],
        "street": store["street"],
        "street_number": store["street_number"],
        "latitude": store["latitude"],
        "longitude": store["longitude"],
        "link": store.get("link") or "",
        "phone_number": store.get("phone_number") or 0,
        "description": store.get("description") or "",
        "store_type": store["store_type"],
        "is_active": store["is_active"],
        "remove": False,
    })
    seed_hours(prefix, store["id"], store_hours_from(store))

    presets_row(prefix)
    with st.form(f"form_{prefix}"):
        col1, col2 = st.columns(2)
        with col1:
            name = st.text_input("Name", key=f"{prefix}_name")
            town = st.text_input("Town", key=f"{prefix}_town")
            street = st.text_input("Street", key=f"{prefix}_street")
            street_number = st.text_input("Street number", key=f"{prefix}_street_number")
            link = st.text_input("Link", key=f"{prefix}_link")
            phone_number = st.number_input("Phone number", min_value=0, key=f"{prefix}_phone_number")
        with col2:
            store_type = st.selectbox("Type", STORE_TYPES, key=f"{prefix}_store_type")
            latitude = st.number_input("Latitude", format="%.6f", key=f"{prefix}_latitude")
            longitude = st.number_input("Longitude", format="%.6f", key=f"{prefix}_longitude")
            is_active = st.checkbox("Active", key=f"{prefix}_is_active")
            description = st.text_area("Description", key=f"{prefix}_description")
        st.markdown("**Working hours**")
        hours = render_hours(prefix)
        image, url, remove = image_widgets(prefix, store.get("image_url"))
        submitted = st.form_submit_button("Save changes")

    if submitted:
        payload = _store_basic_payload(prefix, {
            "name": name, "town": town, "street": street, "street_number": street_number,
            "latitude": latitude, "longitude": longitude, "link": link,
            "phone_number": int(phone_number), "description": description,
            "store_type": store_type, "is_active": bool(is_active),
        })
        payload.update(hours_to_payload(hours))
        apply_image_choice(payload, image, url, remove)
        try:
            backend.update_store(store["id"], payload, image)
            st.success("Store updated.")
        except BackendError as error:
            handle_backend_error(error)

    st.divider()
    with st.expander("Obaveštenje"):
        _render_store_announcement(backend, store)

    confirm_key = f"{prefix}_confirm_delete"
    if st.button("Delete store AND its products and workers", key=f"{prefix}_delete"):
        st.session_state[confirm_key] = True
    elif st.session_state.get(confirm_key):
        try:
            product_count = len(backend.list_products(store["id"]))
        except BackendError:
            product_count = None
        try:
            worker_count = sum(
                1
                for w in backend.list_workers()
                if w.get("store_id") == store["id"] and w.get("is_active")
            )
        except BackendError:
            worker_count = None

        def _fmt_count(n: int | None) -> str:
            return "?" if n is None else str(n)

        st.warning(
            f"This deactivates the store, **{_fmt_count(product_count)} products** and "
            f"**{_fmt_count(worker_count)} worker accounts**, and permanently deletes every "
            "uploaded image. This cannot be undone. Continue?"
        )
        col_yes, col_no = st.columns(2)
        with col_yes:
            if st.button("Yes, delete", key=f"{prefix}_delete_yes"):
                try:
                    backend.delete_store(store["id"])
                    st.session_state.pop(confirm_key, None)
                    flash_message("success", "Store and its products/workers deleted.")
                    st.rerun()
                except BackendError as error:
                    handle_backend_error(error)
        with col_no:
            if st.button("Cancel", key=f"{prefix}_delete_cancel"):
                st.session_state.pop(confirm_key, None)
                st.rerun()


def _render_store_add(backend: Backend) -> None:
    prefix = "new_store"
    seed(prefix, "new_store", {
        "name": "", "town": "", "street": "", "street_number": "",
        "latitude": 44.8, "longitude": 20.5, "link": "",
        "phone_number": 0, "description": "", "store_type": "market",
        "is_active": True, "remove": False,
    })
    seed_hours(prefix, "new_store", {day: DEFAULT_HOURS for day, _ in WEEKDAYS})

    presets_row(prefix)
    with st.form("form_new_store"):
        col1, col2 = st.columns(2)
        with col1:
            name = st.text_input("Name", key=f"{prefix}_name")
            town = st.text_input("Town", key=f"{prefix}_town")
            street = st.text_input("Street", key=f"{prefix}_street")
            street_number = st.text_input("Street number", key=f"{prefix}_street_number")
            link = st.text_input("Link", key=f"{prefix}_link")
            phone_number = st.number_input("Phone number", min_value=0, key=f"{prefix}_phone_number")
        with col2:
            store_type = st.selectbox("Type", STORE_TYPES, key=f"{prefix}_store_type")
            latitude = st.number_input("Latitude", format="%.6f", key=f"{prefix}_latitude")
            longitude = st.number_input("Longitude", format="%.6f", key=f"{prefix}_longitude")
            is_active = st.checkbox("Active", key=f"{prefix}_is_active")
            description = st.text_area("Description", key=f"{prefix}_description")
        st.markdown("**Working hours**")
        hours = render_hours(prefix)
        image, url, _ = image_widgets(prefix, None, show_remove=False)
        submitted = st.form_submit_button("Create store")

    if submitted:
        if not (name.strip() and town.strip() and street.strip()):
            st.error("Name, town and street are required.")
            return
        payload = _store_basic_payload(prefix, {
            "name": name, "town": town, "street": street, "street_number": street_number,
            "latitude": latitude, "longitude": longitude, "link": link,
            "phone_number": int(phone_number), "description": description,
            "store_type": store_type, "is_active": bool(is_active),
        })
        payload.update(hours_to_payload(hours))
        apply_image_choice(payload, image, url, remove=False)
        try:
            backend.create_store(payload, image)
            flash_message("success", "Store created.")
            st.session_state[f"{prefix}_seed"] = None
            st.rerun()
        except BackendError as error:
            handle_backend_error(error)


# ---------------------------------------------------------------- products


def parse_expiration(text: str) -> str | None:
    text = text.strip()
    if not text:
        return None
    return dt.date.fromisoformat(text).isoformat()


def _price_value(value: Any) -> float:
    return float(value) if value is not None else 0.0


PRICE_CASES = ["free", "price", "discount", "none"]

PRICE_CASE_LABELS = {
    "free": "Besplatno",
    "price": "Cena",
    "discount": "Cena sa popustom",
    "none": "Bez cene",
}


def _price_case_from_product(product: dict) -> str:
    new_price = product.get("new_price")
    old_price = product.get("old_price")
    if new_price is None:
        return "none"
    if new_price == 0:
        return "free"
    if old_price is not None and old_price > new_price:
        return "discount"
    return "price"


def _price_pair(price_case: str, old_price: Any, new_price: Any) -> tuple[Any, Any]:
    if price_case == "free":
        return None, 0
    if price_case == "none":
        return None, None
    new_value = round(float(new_price), 2)
    old_value = round(float(old_price), 2) if price_case == "discount" else None
    return old_value, new_value


def _price_label(product: dict) -> str:
    new_price = product.get("new_price")
    old_price = product.get("old_price")
    if new_price is None:
        return "no price"
    if new_price == 0:
        return "free"
    if old_price is not None and old_price > new_price:
        return f"{old_price:.0f} -> {new_price:.0f} RSD"
    return f"{new_price:.0f} RSD"


def page_products(backend: Backend) -> None:
    st.subheader("Products")
    try:
        stores = backend.list_stores(True)
    except BackendError as error:
        handle_backend_error(error)
        return
    if not stores:
        st.info("No active stores yet.")
        return

    store_ids = [s["id"] for s in stores]
    store_labels = {s["id"]: f"{s['name']} — {s['town']}, {s['street']}" for s in stores}
    store_id = st.selectbox("Store", store_ids, format_func=lambda x: store_labels.get(x, x), key="product_store")

    try:
        active = backend.list_products(store_id, True)
        inactive = backend.list_products(store_id, False)
    except BackendError as error:
        handle_backend_error(error)
        return

    tab_list, tab_add = st.tabs(["Products", "Add product"])
    with tab_list:
        all_products = active + inactive
        if not all_products:
            st.info("No products in this store.")
        else:
            inactive_ids = {p["id"] for p in inactive}
            product_ids = [p["id"] for p in all_products]
            product_labels = {
                p["id"]: f"{p['name']} — {_price_label(p)}" + (" (inactive)" if p["id"] in inactive_ids else "")
                for p in all_products
            }
            product_id = st.selectbox("Select product", product_ids, format_func=lambda x: product_labels.get(x, x))
            try:
                product = backend.get_product(product_id)
            except BackendError as error:
                handle_backend_error(error)
                return
            _render_product_edit(backend, store_id, product)
    with tab_add:
        _render_product_add(backend, store_id, store_ids, store_labels)


def _render_product_edit(backend: Backend, store_id: str, product: dict) -> None:
    prefix = f"edit_prod_{product['id']}"
    seed(prefix, product["id"], {
        "name": product["name"],
        "old_price": _price_value(product["old_price"]),
        "new_price": _price_value(product["new_price"]),
        "amount": product.get("amount") or 0,
        "description": product.get("description") or "",
        "expiration": (product.get("expiration_date") or "")[:10],
        "is_active": product["is_active"],
        "price_case": _price_case_from_product(product),
        "remove": False,
    })
    price_case = st.segmented_control(
        "Price",
        options=PRICE_CASES,
        format_func=lambda k: PRICE_CASE_LABELS[k],
        key=f"{prefix}_price_case",
    )
    with st.form(f"form_{prefix}"):
        name = st.text_input("Name", key=f"{prefix}_name")
        old_price = None
        new_price = None
        if price_case in ("price", "discount"):
            new_price = st.number_input("Nova cena (RSD)", min_value=0.01, format="%.2f", key=f"{prefix}_new_price")
        if price_case == "discount":
            old_price = st.number_input("Stara cena (RSD)", min_value=0.01, format="%.2f", key=f"{prefix}_old_price")
        col1, col2 = st.columns(2)
        with col1:
            amount = st.number_input("Amount", min_value=0, key=f"{prefix}_amount")
            is_active = st.checkbox("Active", key=f"{prefix}_is_active")
        with col2:
            description = st.text_area("Description", key=f"{prefix}_description")
            expiration = st.text_input("Expiration (YYYY-MM-DD, optional)", key=f"{prefix}_expiration")
        image, url, remove = image_widgets(prefix, product.get("image_url"))
        submitted = st.form_submit_button("Save changes")

    if submitted:
        old_price_v, new_price_v = _price_pair(price_case, old_price, new_price)
        if price_case == "discount" and old_price_v <= new_price_v:
            st.error("Stara cena mora biti veća od nove cene.")
            return
        payload: dict[str, Any] = {
            "store_id": store_id,
            "name": name,
            "old_price": old_price_v,
            "new_price": new_price_v,
            "amount": int(amount) or None,
            "is_active": bool(is_active),
        }
        payload["description"] = description.strip() or None
        try:
            expiration_value = parse_expiration(expiration)
        except ValueError:
            st.error("Expiration must be YYYY-MM-DD.")
            return
        if expiration_value:
            payload["expiration_date"] = expiration_value
        apply_image_choice(payload, image, url, remove)
        try:
            backend.update_product(product["id"], payload, image)
            st.success("Product updated.")
        except BackendError as error:
            handle_backend_error(error)

    if st.button("Delete product (soft)", key=f"{prefix}_delete"):
        try:
            backend.delete_product(product["id"])
            flash_message("success", "Product deleted.")
            st.rerun()
        except BackendError as error:
            handle_backend_error(error)


def _render_product_add(backend: Backend, default_store_id: str, store_ids: list[str], store_labels: dict) -> None:
    prefix = "new_product"
    upstream = st.session_state.get(f"{prefix}_upstream")
    if st.session_state.get(f"{prefix}_seed") != "seed" or upstream != default_store_id:
        st.session_state[f"{prefix}_store"] = default_store_id
        st.session_state[f"{prefix}_price_case"] = "price"
        st.session_state[f"{prefix}_seed"] = "seed"
        st.session_state[f"{prefix}_upstream"] = default_store_id
    price_case = st.segmented_control(
        "Price",
        options=PRICE_CASES,
        format_func=lambda k: PRICE_CASE_LABELS[k],
        key=f"{prefix}_price_case",
    )
    with st.form("form_new_product"):
        store_id = st.selectbox(
            "Store", store_ids, format_func=lambda x: store_labels.get(x, x), key=f"{prefix}_store"
        )
        name = st.text_input("Name", key=f"{prefix}_name")
        old_price = None
        new_price = None
        if price_case in ("price", "discount"):
            new_price = st.number_input("Nova cena (RSD)", min_value=0.01, format="%.2f", key=f"{prefix}_new_price")
        if price_case == "discount":
            old_price = st.number_input("Stara cena (RSD)", min_value=0.01, format="%.2f", key=f"{prefix}_old_price")
        col1, col2 = st.columns(2)
        with col1:
            amount = st.number_input("Amount", min_value=0, key=f"{prefix}_amount")
        with col2:
            description = st.text_area("Description", key=f"{prefix}_description")
            expiration = st.text_input("Expiration (YYYY-MM-DD, optional)", key=f"{prefix}_expiration")
        image, url, _ = image_widgets(prefix, None, show_remove=False)
        submitted = st.form_submit_button("Create product")

    if submitted:
        if not name.strip():
            st.error("Name is required.")
            return
        old_price_v, new_price_v = _price_pair(price_case, old_price, new_price)
        if price_case == "discount" and old_price_v <= new_price_v:
            st.error("Stara cena mora biti veća od nove cene.")
            return
        payload: dict[str, Any] = {
            "store_id": store_id,
            "name": name,
            "old_price": old_price_v,
            "new_price": new_price_v,
            "amount": int(amount) or None,
        }
        payload["description"] = description.strip() or None
        try:
            expiration_value = parse_expiration(expiration)
        except ValueError:
            st.error("Expiration must be YYYY-MM-DD.")
            return
        if expiration_value:
            payload["expiration_date"] = expiration_value
        apply_image_choice(payload, image, url, remove=False)
        try:
            backend.create_product(payload, image)
            flash_message("success", "Product created.")
            st.session_state[f"{prefix}_seed"] = None
            st.rerun()
        except BackendError as error:
            handle_backend_error(error)


# ----------------------------------------------------------------- workers


def page_workers(backend: Backend) -> None:
    st.subheader("Workers")
    try:
        workers = backend.list_workers()
        stores = backend.list_stores(True)
    except BackendError as error:
        handle_backend_error(error)
        return

    if workers:
        st.dataframe(workers)

    tab_add, tab_edit = st.tabs(["Add worker", "Edit worker"])

    with tab_add:
        store_ids = [s["id"] for s in stores]
        store_labels = {s["id"]: f"{s['name']} — {s['town']}" for s in stores}
        with st.form("form_add_worker"):
            email = st.text_input("Email")
            name = st.text_input("Name")
            store_id = st.selectbox("Store", store_ids, format_func=lambda x: store_labels.get(x, x))
            submitted = st.form_submit_button("Create worker")
        if submitted:
            if "@" not in email:
                st.error("Invalid email.")
            else:
                try:
                    backend.create_worker({"email": email, "name": name or None, "store_id": store_id})
                    flash_message("success", "Worker created. Temporary password emailed.")
                    st.rerun()
                except BackendError as error:
                    handle_backend_error(error)

    with tab_edit:
        if not workers:
            st.info("No workers yet.")
            return
        worker_ids = [w["id"] for w in workers]
        worker_labels = {w["id"]: f"{w['email']} — {w.get('name') or ''}" for w in workers}
        worker_id = st.selectbox("Select worker", worker_ids, format_func=lambda x: worker_labels.get(x, x))
        worker = next(w for w in workers if w["id"] == worker_id)
        prefix = f"edit_worker_{worker['id']}"
        store_ids = [s["id"] for s in stores]
        store_labels = {s["id"]: f"{s['name']} — {s['town']}" for s in stores}
        PICK_STORE = "__pick_store__"
        worker_store_id = worker.get("store_id")
        missing_store = worker_store_id is not None and worker_store_id not in store_ids
        if missing_store:
            st.warning(
                "Radnik nije povezan ni sa jednom aktivnom prodavnicom (prodavnica je obrisana ili "
                "neaktivna). Izaberite prodavnicu pre čuvanja promena."
            )
        store_options = ([PICK_STORE] if missing_store else []) + store_ids
        seed(prefix, worker["id"], {
            "email": worker["email"],
            "name": worker.get("name") or "",
            "store_id": worker_store_id or (store_ids[0] if store_ids else None),
            "is_active": worker["is_active"],
        })
        with st.form(f"form_{prefix}"):
            email = st.text_input("Email", key=f"{prefix}_email")
            name = st.text_input("Name", key=f"{prefix}_name")
            store_id = st.selectbox(
                "Store",
                store_options,
                format_func=lambda x: store_labels.get(x, "— izaberite prodavnicu —" if x == PICK_STORE else x),
                key=f"{prefix}_store_id",
            )
            is_active = st.checkbox("Active", key=f"{prefix}_is_active")
            submitted = st.form_submit_button("Save changes")
        if submitted:
            if "@" not in email:
                st.error("Invalid email.")
            elif store_id == PICK_STORE:
                st.error("Izaberite prodavnicu pre čuvanja.")
            else:
                try:
                    backend.update_worker(worker["id"], {
                        "email": email, "name": name or None,
                        "store_id": store_id, "is_active": bool(is_active),
                    })
                    flash_message("success", "Worker updated.")
                    st.rerun()
                except BackendError as error:
                    handle_backend_error(error)
        col1, col2 = st.columns(2)
        with col1:
            if st.button("Reset password (email temp password)", key=f"{prefix}_reset"):
                try:
                    backend.reset_worker_password(worker["id"])
                    st.success("New temporary password emailed.")
                except BackendError as error:
                    handle_backend_error(error)
        with col2:
            if st.button("Delete worker (soft)", key=f"{prefix}_delete"):
                try:
                    backend.delete_worker(worker["id"])
                    flash_message("success", "Worker deleted.")
                    st.rerun()
                except BackendError as error:
                    handle_backend_error(error)


def page_database(backend: Backend) -> None:
    st.subheader("Database export")
    st.info("Export celokupne baze BEZ proizvoda (koristi se kao ručni backup).")
    st.caption("Sadrži: prodavnice, korisnike (radnici + administratori), recovery kodove i maintenance runs. Tabela 'products' je prazna.")
    if st.button("Preuzmi bazu bez proizvoda", use_container_width=True):
        try:
            data = backend.export_db()
            ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
            st.download_button(
                label="Sačuvaj fajl",
                data=data,
                file_name=f"nebacaj_db_no_products_{ts}.db",
                mime="application/vnd.sqlite3",
                use_container_width=True,
                key="db_download",
            )
        except BackendError as error:
            handle_backend_error(error)


# --------------------------------------------------------------------- main

st.set_page_config(page_title="NeBacaj Admin", layout="wide")

if "backend_url" not in st.session_state:
    st.session_state.backend_url = DEFAULT_BACKEND_URL

if st.session_state.get("token") is None:
    render_login()
    st.stop()

backend = get_backend()

if st.session_state.get("must_change_password"):
    render_change_password(backend)
    st.stop()

show_flash()

page = render_sidebar()
if page == "Stores":
    page_stores(backend)
elif page == "Products":
    page_products(backend)
elif page == "Database":
    page_database(backend)
else:
    page_workers(backend)