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

## Dummy Data

Populate the database with 10 sample stores (5 in Novi Sad, 5 in Beograd) and 0–8 products each:

```bash
uv run python -m backend.make_dummy_data
```

This only runs once — it skips if `nebacaj.db` already exists. Delete the file to regenerate.
