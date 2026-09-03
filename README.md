# NeBacaj

Map-based web application for finding stores and their products across Serbian cities.

## Prerequisites

- Python 3.12+
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- Node.js 18+ and npm

## Setup

### Backend

Install Python dependencies (handles both aiosqlite and SQLAlchemy async):

```bash
uv sync
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

Create a `.env` file in the project root with your Carto API key (required for basemap tiles):

```
CARTO_API_KEY="your_key_here"
```

Get a free key at https://carto.com/basemaps/apikey.

## Running

Start the backend (port 8000) in one terminal:

```bash
uv run main.py
```

Start the frontend dev server (port 5173) in another terminal:

```bash
cd frontend && npm run dev -- --host 0.0.0.0
```

The frontend proxies `/api/*` requests to the backend automatically.

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
