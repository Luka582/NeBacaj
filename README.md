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
| `IMAGEKIT_PUBLIC_KEY` | No | ImageKit public key. |
| `IMAGEKIT_PRIVATE_KEY` | No | ImageKit private key. Image **uploads will fail** without it. |
| `ADMIN_BACKEND_URL` | No | Default backend URL the admin panel tries on login. Defaults to `http://localhost:8000`; can also be typed in at the panel's login screen. |

## Running

Start the backend (port 8000) in one terminal:

```bash
uv run python -m backend.main
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
- **Products** — add products to a store, set old/new price, amount and
  expiration date, upload an image, and soft-delete. Old price must be greater
  than or equal to the new price.
- **Workers** — create worker accounts, edit them, reset passwords and
  soft-delete. Creating or resetting a worker emails them a **temporary
  password** — but only if SMTP is configured (`AUTO_REPLY_EMAIL` +
  `AUTO_REPLY_EMAIL_APP_PASSWORD`). Without it the password is never delivered,
  so set up SMTP before creating workers.

Store and product deletes are soft deletes (they disappear from the public
app) and also remove any uploaded ImageKit image.

## Accounts, recovery

- Passwords are stored hashed; auth uses short-lived bearer tokens
  (`JWT_SECRET`).
- Workers are created with a temporary password and are forced to change it on
  first login (`must_change_password`).
- Forgot a password? The app's login screen can email a one-time recovery code
  (`/auth/request-recovery-code`): a code is valid for 10 minutes, and requests
  are rate-limited (one per minute).

## config.json

Runtime configuration lives in `config.json` at the project root (outside `frontend/` and `backend/`). It is served to the frontend by a custom Vite plugin during development.

```json
{
    "STORES_RADIUS": 3.0,
    "LOCATION_RADIUS": 0.5
}
```

| Key | Type | Description |
| --- | ---- | ----------- |
| `STORES_RADIUS` | number (km) | Zoom extent used when the map is centered on a selected town (or all stores): the view fits a square of `STORES_RADIUS` km around the town/store bounds. |
| `LOCATION_RADIUS` | number (km) | Zoom extent used when the **location button** is clicked: the map fits a square of `LOCATION_RADIUS` km around the user's GPS position. This only affects the location button, not town selection. |

Both values are in kilometers; lower values produce a closer zoom.

## Dummy Data

Populate the database with 10 sample stores (5 in Novi Sad, 5 in Beograd) and 0–8 products each:

```bash
uv run python -m backend.make_dummy_data
```

This only runs once — it skips if `nebacaj.db` already exists. Delete the file to regenerate.