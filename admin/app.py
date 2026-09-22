from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path
from typing import Any

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
                f"Minutes ({label})", min_value=1, max_value=1440, step=15, key=f"{prefix}_dur_{day}"
            )
        with right:
            opening = opening_time.hour * 60 + opening_time.minute
            closing = opening + duration
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
            st.success("Password changed.")
            st.rerun()


def render_sidebar() -> str:
    with st.sidebar:
        st.markdown(f"**Backend:** {st.session_state.backend_url}")
        st.write(f"Logged in as `{st.session_state.get('email', '')}`")
        if st.button("Log out"):
            for key in ("token", "role", "email", "must_change_password"):
                st.session_state.pop(key, None)
            st.rerun()
    return st.sidebar.radio("Section", ["Stores", "Products", "Workers"])


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

        labels = {store_label(s): s["id"] for s in all_stores}
        label = st.selectbox("Select store", list(labels))
        store_id = labels[label]
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

    if st.button("Delete store (soft)", key=f"{prefix}_delete"):
        try:
            backend.delete_store(store["id"])
            st.success("Store deleted.")
            st.rerun()
        except BackendError as error:
            handle_backend_error(error)


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
            st.success("Store created.")
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
            labels = {
                f"{p['name']} — {p['old_price']:.0f} -> {p['new_price']:.0f} RSD" + (" (inactive)" if p["id"] in inactive_ids else ""): p["id"]
                for p in all_products
            }
            label = st.selectbox("Select product", list(labels))
            product_id = labels[label]
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
        "old_price": float(product["old_price"]),
        "new_price": float(product["new_price"]),
        "amount": product.get("amount") or 0,
        "description": product.get("description") or "",
        "expiration": (product.get("expiration_date") or "")[:10],
        "is_active": product["is_active"],
        "remove": False,
    })
    with st.form(f"form_{prefix}"):
        name = st.text_input("Name", key=f"{prefix}_name")
        col1, col2 = st.columns(2)
        with col1:
            old_price = st.number_input("Old price", min_value=0.0, format="%.2f", key=f"{prefix}_old_price")
            new_price = st.number_input("New price", min_value=0.0, format="%.2f", key=f"{prefix}_new_price")
            amount = st.number_input("Amount", min_value=0, key=f"{prefix}_amount")
            is_active = st.checkbox("Active", key=f"{prefix}_is_active")
        with col2:
            description = st.text_area("Description", key=f"{prefix}_description")
            expiration = st.text_input("Expiration (YYYY-MM-DD, optional)", key=f"{prefix}_expiration")
        image, url, remove = image_widgets(prefix, product.get("image_url"))
        submitted = st.form_submit_button("Save changes")

    if submitted:
        if float(old_price) < float(new_price):
            st.error("Old price must be greater than or equal to the new price.")
            return
        payload: dict[str, Any] = {
            "store_id": store_id,
            "name": name,
            "old_price": old_price,
            "new_price": new_price,
            "amount": int(amount) or None,
            "is_active": bool(is_active),
        }
        if description.strip():
            payload["description"] = description
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
            st.success("Product deleted.")
            st.rerun()
        except BackendError as error:
            handle_backend_error(error)


def _render_product_add(backend: Backend, default_store_id: str, store_ids: list[str], store_labels: dict) -> None:
    prefix = "new_product"
    if st.session_state.get(f"{prefix}_seed") != "seed":
        st.session_state[f"{prefix}_store"] = default_store_id
        st.session_state[f"{prefix}_seed"] = "seed"
    with st.form("form_new_product"):
        store_id = st.selectbox(
            "Store", store_ids, format_func=lambda x: store_labels.get(x, x), key=f"{prefix}_store"
        )
        name = st.text_input("Name", key=f"{prefix}_name")
        col1, col2 = st.columns(2)
        with col1:
            old_price = st.number_input("Old price", min_value=0.0, format="%.2f", key=f"{prefix}_old_price")
            new_price = st.number_input("New price", min_value=0.0, format="%.2f", key=f"{prefix}_new_price")
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
        if float(old_price) < float(new_price):
            st.error("Old price must be greater than or equal to the new price.")
            return
        payload: dict[str, Any] = {
            "store_id": store_id,
            "name": name,
            "old_price": old_price,
            "new_price": new_price,
            "amount": int(amount) or None,
        }
        if description.strip():
            payload["description"] = description
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
            st.success("Product created.")
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
                    st.success("Worker created. A temporary password was sent by email (if SMTP is configured).")
                    st.rerun()
                except BackendError as error:
                    handle_backend_error(error)

    with tab_edit:
        if not workers:
            st.info("No workers yet.")
            return
        workers_by_label = {f"{w['email']} — {w.get('name') or ''}": w["id"] for w in workers}
        label = st.selectbox("Select worker", list(workers_by_label))
        worker = next(w for w in workers if w["id"] == workers_by_label[label])
        prefix = f"edit_worker_{worker['id']}"
        store_ids = [s["id"] for s in stores]
        store_labels = {s["id"]: f"{s['name']} — {s['town']}" for s in stores}
        seed(prefix, worker["id"], {
            "email": worker["email"],
            "name": worker.get("name") or "",
            "store_id": worker.get("store_id") or (store_ids[0] if store_ids else None),
            "is_active": worker["is_active"],
        })
        with st.form(f"form_{prefix}"):
            email = st.text_input("Email", key=f"{prefix}_email")
            name = st.text_input("Name", key=f"{prefix}_name")
            store_id = st.selectbox("Store", store_ids, format_func=lambda x: store_labels.get(x, x), key=f"{prefix}_store_id")
            is_active = st.checkbox("Active", key=f"{prefix}_is_active")
            submitted = st.form_submit_button("Save changes")
        if submitted:
            if "@" not in email:
                st.error("Invalid email.")
            else:
                try:
                    backend.update_worker(worker["id"], {
                        "email": email, "name": name or None,
                        "store_id": store_id, "is_active": bool(is_active),
                    })
                    st.success("Worker updated.")
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
                    st.success("Worker deleted.")
                    st.rerun()
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

page = render_sidebar()
if page == "Stores":
    page_stores(backend)
elif page == "Products":
    page_products(backend)
else:
    page_workers(backend)