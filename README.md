# NeBacaj

Map-based web application for finding stores and their products across Serbian cities.

## Prerequisites

- Python 3.12+
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- Node.js 18+ and npm

## Setup

### Backend

Install Python dependencies:

```bash
uv sync
```

Create the environment file and fill in your keys (see
[Environment Variables](#environment-variables) below):

```bash
cp .env.example .env
```

Create the initial admin account (only the first time). You'll be prompted
for the admin password — it is hashed and stored in the database and never
written to `.env` or anywhere else:

```bash
uv run python -m backend.seed_admin
```

### Frontend

Install Node dependencies and build:

```bash
cd frontend
npm install
npm run build        # production build
# — or —
npm run dev          # dev server with hot reload on localhost:5173
```

## Environment Variables

Create a `.env` file in the project root:

| Variable | Required | Description |
| --- | --- | --- |
| `CARTO_API_KEY` | Yes (frontend) | Key for Carto basemap tiles. Get a free key at https://carto.com/basemaps/apikey. |
| `JWT_SECRET` | Yes | Secret used to sign auth tokens. Generate one, e.g. `python -c "import secrets; print(secrets.token_urlsafe(48))"`. |
| `ADMIN_EMAIL` | Yes | Email of the initial admin account. Used by `backend.seed_admin`, which then prompts you for the admin password (never stored in `.env`). |
| `AUTO_REPLY_EMAIL` | No | Gmail address used as the SMTP sender for temporary passwords and recovery codes. If empty, no emails are sent. |
| `AUTO_REPLY_EMAIL_APP_PASSWORD` | No | Gmail **app password** for the sender address (not your regular password). |
| `IMAGEKIT_URL_ENDPOINT` | No | ImageKit URL endpoint (e.g. `https://ik.imagekit.io/your_imagekit_id`). Needed for store/product images. |
| `IMAGEKIT_PUBLIC_KEY` | No | ImageKit public key. Not read by the current code — uploads go through the backend with `IMAGEKIT_PRIVATE_KEY` — but kept for a future direct browser-to-ImageKit upload flow. |
| `IMAGEKIT_PRIVATE_KEY` | No | ImageKit private key. Image **uploads will fail** without it. |
| `CONTACT_EMAIL` | No (frontend) | Public address shown as **Pomoć i kontakt** in the in-app settings, both as the `mailto:` target and the visible label. Inlined into the bundle at build time, so changing it requires a frontend rebuild. |
| `ADMIN_BACKEND_URL` | No | Default backend URL the admin panel tries on login. Defaults to `http://localhost:8000`; can also be typed in at the panel's login screen. |
| `CLEANUP_ENABLED` | No | Set to `0` to disable the nightly product cleanup job. Defaults to `1`. |
| `CLEANUP_OLD_HOURS` | No | Age in hours after which a product is soft-deleted by the nightly job, independently of its expiration date. Defaults to `72`. |

### Frontend variables and `.env` safety

`CARTO_API_KEY` and `CONTACT_EMAIL` are the only two values that reach the browser. Vite
loads the root `.env` during a build, but `frontend/vite.config.ts` inlines variables only
where they are explicitly listed under `define` — everything else (`JWT_SECRET`,
`IMAGEKIT_PRIVATE_KEY`, the SMTP app password) stays inside the build process and is never
written into the bundle.

Because these are inlined, they are baked into the built assets rather than read at runtime:
restarting the backend has no effect on them, only a frontend rebuild does. They are also
not secret — anything shipped this way is readable by anyone who loads the site.

## Running

Start the backend (port 8000) in one terminal:

```bash
uv run python -m backend.main
```

By default it binds `127.0.0.1` with auto-reload off. To expose it on the
network or enable dev reload:

```bash
HOST=0.0.0.0 RELOAD=1 uv run python -m backend.main
```

Start the frontend dev server (port 5173) in another terminal:

```bash
cd frontend && npm run dev -- --host 0.0.0.0
```

The frontend proxies `/api/*` requests to the backend automatically.

### Admin panel

The admin panel is a separate Streamlit app for managing stores, products and
worker accounts. It is not part of the public frontend: run it on your own
machine and point it at the backend.

Start it in its own terminal (port 8501):

```bash
uv run streamlit run admin/app.py --server.port 8501 --server.address 127.0.0.1
```

Then open http://localhost:8501 and log in with the admin email/password from
`.env`. If the backend is not on `localhost:8000`, type its URL on the login
screen (or set `ADMIN_BACKEND_URL` in `.env`). Only accounts with the `admin`
role can log in — worker accounts are rejected.

What you can do from the panel:

- **Stores** — create and edit stores (name, address, type, link, phone,
  description), set per-day working hours (0 minutes = closed that day; 24/7 and
  09:00–17:00 presets), set or upload an image, and soft-delete.
- **Products** — add products to a store, set one of four pricing cases
  (besplatno / cena / cena sa popustom / bez cene), amount and expiration date,
  upload an image, and soft-delete. Prices are nullable:
  `new_price = 0` → free, `new_price > 0` with `old_price = null` → plain price,
  `old_price > new_price` → discounted, both `null` → no price shown.
- **Workers** — create worker accounts, edit them, reset passwords and
  soft-delete. Creating or resetting a worker emails them a **temporary
  password** — but only if SMTP is configured (`AUTO_REPLY_EMAIL` +
  `AUTO_REPLY_EMAIL_APP_PASSWORD`). Without it the password is never delivered,
  so set up SMTP before creating workers.

Store and product deletes are soft deletes (they disappear from the public
app) and also remove any uploaded ImageKit image. Deleting a **store** also
deactivates every product and worker account for that store, and permanently
deletes all of the store's uploaded images — the admin panel asks for
confirmation and shows the affected counts before you delete.

## Accounts, recovery

- Passwords are stored hashed; auth uses short-lived bearer tokens
  (`JWT_SECRET`).
- Workers are created with a temporary password and are forced to change it on
  first login (`must_change_password`).
- Forgot a password? The app's login screen can email a one-time recovery code
  (`/auth/request-recovery-code`): a code is valid for 10 minutes, and requests
  are rate-limited (one per minute).

## Codebase navigation

### Backend (`backend/` — FastAPI)

- `main.py` — entrypoint (`python -m backend.main`, port 8000).
- `app.py` — FastAPI app: all routes, auth, and business logic.
- `db.py` — SQLite helpers/schema, `nebacaj.db` lives in the project root.
- `schemas.py` — request/response models; `security.py` — password hashing, JWT,
  recovery codes; `images.py` — ImageKit uploads; `emailer.py` — SMTP.
- `cleanup.py` — nightly soft-delete of products past their expiration date or older
  than `CLEANUP_OLD_HOURS` (default 72); rows are kept for history, ImageKit files freed.
- `seed_admin.py` / `make_dummy_data.py` — one-off scripts.

### Admin panel (`admin/` — Streamlit)

- `app.py` — the UI; `api.py` — talks to the backend API.

### Frontend (`frontend/src/` — React + TypeScript + Tailwind + Leaflet)

- `App.tsx` — the hub. Owns the map (Leaflet), all overlays, the store list and
  product-search state, the town dropdown, and the `mapRequest` mechanism that
  drives centering/zoom through `MapController`. Also defines
  `fitBoundsInBand`, the desktop/mobile breakpoint math, and `openStorePopup`.
- `ProductSheet.tsx` — product search results. Bottom sheet on mobile
  (<768px), fixed right-side panel on desktop (≥768px). Exports
  `ProductSearchResult` and `SIDE_PANEL_WIDTH`. Its `expanded` state is owned by
  `App` (via `expanded`/`onExpandedChange`).
- `StoreDetail.tsx` — full-screen store page (info, working hours, product list);
  can open a product detail on top of itself.
- `ProductDetail.tsx` — full-screen product page. "Pogledaj radnju" calls the
  `onViewStore` prop, which in `App` collapses the product sheet and opens the
  store's map popup instead of the store page.
- `SettingsMenu.tsx` — slide-in settings (opens `MyProducts`).
- `MyProducts.tsx` — worker flow: login, "my products" list, `ProductForm`
  (add/edit; embeds the in-app camera). ~900 lines.
- `tapHandlers.ts` — pointer-event helpers: suppress the ghost map click after
  list taps (`tapHandlers`, `swallowImminentClick`) and hide the keyboard on
  scroll (`dismissKeyboard`). Used by ProductSheet/MyProducts.
- `format.ts` — price/date/time formatting plus `cropImageUrl` (ImageKit
  resize/crop); `FreeTag.tsx` — "Besplatno!" badge; `auth.ts` — worker session
  helpers (`nebacaj_session` localStorage key); `index.css` — Tailwind theme,
  brand colors, and the `store-popup*` Leaflet popup styles.

### Overlay layering & state

- All full-screen overlays are z-indexed, from low to high: ProductSheet and
  SettingsMenu `z-[1500]`, town dropdown `z-[1600]` (backdrop `1599`), StoreDetail
  and MyProducts `z-[2000]`, product form `2100`, camera `2200`, confirm dialog
  `2300`, ProductDetail `z-[3000]`. Key whenever you add an overlay.
- The `md` (≥768px) breakpoint flips ProductSheet from bottom sheet to side
  panel and changes the map centering math — keep new desktop layouts in sync.
- Map interaction is driven by the `mapRequest` state (`town`/`location`/
  `focus`/`store`); marker clicks set `selectedStoreId`, whose effect opens the
  marker popup.
- localStorage keys: `lastTown`, `recentTowns`, `nebacajHintDismissed` (first-use
  popup), `nebacaj_session`.

## Map zoom & centering

Map centering/zoom is handled in `frontend/src/App.tsx` (`fitBoundsInBand`).

The product results panel (`frontend/src/ProductSheet.tsx`) is a bottom sheet on
mobile (<768px) and a fixed right-side panel on desktop (≥768px,
`SIDE_PANEL_WIDTH = 380`). `fitBoundsInBand` adjusts for this:

- **Mobile:** centers the view inside the band between the town search field
  (bottom edge) and the bottom product sheet (top edge), and zooms so the
  leftmost–rightmost store spans 90% of the screen width (`FIT_WIDTH_RATIO`).
- **Desktop:** the vertical band is the full height (no bottom sheet), and the
  horizontal fit uses the screen width minus the side panel, centered within the
  map area left of it. Single-store and popup pans (`focus`/`store` requests)
  shift right by half the panel width so pins/popups are not hidden behind it.

`LOCATION_RADIUS_KM` is the radius (km) fitted when the **location button**
succeeds (fitted to 20% of the available width).

## Dummy Data

Populate the database with 10 sample stores (5 in Novi Sad, 5 in Beograd) and 0–8 products each:

```bash
uv run python -m backend.make_dummy_data
```

This only runs once — it skips if `nebacaj.db` already exists. Delete the file to regenerate.