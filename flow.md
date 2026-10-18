# Flow

How the code actually executes, end to end. Must match the current code (see CLAUDE.md section 1.2).

**Current state: M0 scaffold.** Sections marked *(planned)* describe structure that does not exist in code yet.

---

## 1. Local setup

1. `docker compose up -d`: starts `settle-db` (Postgres 17 + PostGIS 3.5, amd64 image emulated on Apple Silicon) on `localhost:5433`.
   On first start with an empty volume, it runs `db/init/001_schema.sql`, which enables PostGIS and creates `areas`, `area_metrics`, `crime_aggregates`, `commute_cache` and `agent_logs`.
2. `cp .env.example .env.local`, then fill in keys. The app and the pipeline both read `.env.local`.
3. `npm install`, then `npm run dev`: Next.js app on `localhost:3000`.
4. `uv sync --project pipeline`: Python environment for the pipeline.

## 2. Data pipeline flow

Scripts live in `pipeline/settle_pipeline/` and run manually, in this order:

| # | Script | Inputs | Outputs / writes |
|---|---|---|---|
| 0 | `check_db.py` | `DATABASE_URL` | Prints PostGIS version and whether each expected table exists. Writes nothing. |
| 1 | *(planned, M1)* load areas | TIGER ZCTA shapes, ACS population | `areas` |
| 2 | *(planned, M2)* load rent | Zillow ZORI/ZHVI CSVs | `area_metrics` |
| 3 | *(planned, M2)* fetch Mireye | `areas.centroid` | `data/raw/mireye/`, then `area_metrics` |
| 4 | *(planned, M4)* load crime | City open-data portals, Jev | `data/raw/crime/`, then `crime_aggregates` |

Shared helpers:
- `config.py`: repo paths (`RAW_DIR = data/raw`), loads `.env.local`, defines the 5 county FIPS codes, `require_env()`.
- `db.py`: `connect()` returns a psycopg connection from `DATABASE_URL`.

Run a script: `uv run --project pipeline python -m settle_pipeline.check_db`

## 3. Request flow

Implemented now:
1. Browser `GET /` → `app/layout.tsx` + `app/page.tsx` (static placeholder page).
2. Browser `GET /api/health` → `app/api/health/route.ts`
   1. `await connection()` marks the route as per-request (never prerendered).
   2. `lib/db.ts → getPool()` lazily creates one shared `pg.Pool` from `DATABASE_URL` (`getDatabaseUrl()` throws if it is unset).
   3. Runs `SELECT PostGIS_Version()`.
   4. Returns `{ ok: true, postgis }` with 200, or `{ ok: false, error }` with 503.

*(planned, M3)* Form submit → `app/api/score/route.ts` → geocode office (Mireye) → commute matrix (ORS, `commute_cache`) → `lib/scoring/score.ts` → JSON scores → map recolors.

## 4. Agent flow

*(planned, M5)* Chat message → Jev classify → if intent is in {`update_filter`, `set_priority`, `compare`} and confidence ≥ 0.7, apply the action and rescore with no LLM call; otherwise call Claude with tools and grounding context → structured action and/or explanation → log to `agent_logs`.

## 5. Module map

| Path | Owns |
|---|---|
| `app/layout.tsx` | Root HTML shell, fonts, page metadata |
| `app/page.tsx` | Home page (placeholder in M0) |
| `app/api/health/route.ts` | DB + PostGIS health check endpoint |
| `lib/db.ts` | `DATABASE_URL` lookup and the shared Postgres pool |
| `db/init/001_schema.sql` | Database schema, applied on first container start |
| `docker-compose.yml` | Local Postgres + PostGIS container |
| `pipeline/settle_pipeline/config.py` | Pipeline paths, env loading, county list |
| `pipeline/settle_pipeline/db.py` | Pipeline DB connection |
| `pipeline/settle_pipeline/check_db.py` | DB/schema smoke check |
| `vitest.config.ts` | TS test config (`*.test.ts`, `@/` alias) |
| `pipeline/pyproject.toml` | Python deps and pytest config |
| `decisions.md` | Decision log |
| `.env.example` | Required environment variables |
