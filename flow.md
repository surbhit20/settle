# Flow

How the code actually executes, end to end. Must match the current code (see CLAUDE.md section 1.2).

**Current state: M1 (areas on the map).** Sections marked *(planned)* describe structure that does not exist in code yet.

---

## 1. Local setup

1. `docker compose up -d`: starts `settle-db` (Postgres 17 + PostGIS 3.5, amd64 image emulated on Apple Silicon) on `localhost:5433`.
   On first start with an empty volume, it runs `db/init/001_schema.sql`, which enables PostGIS and creates `areas`, `area_metrics`, `crime_aggregates`, `commute_cache` and `agent_logs`.
2. `cp .env.example .env.local`, then fill in keys. The app and the pipeline both read `.env.local`.
3. `npm install`. Its `postinstall` step runs `scripts/copy-maplibre-worker.mjs`, which copies MapLibre's worker into `public/maplibre/`.
4. `uv sync --project pipeline`: Python environment for the pipeline.
5. Run the pipeline (section 2), then `npm run dev`: app on `localhost:3000`.

## 2. Data pipeline flow

Scripts live in `pipeline/settle_pipeline/`. Run each with `uv run --project pipeline python -m settle_pipeline.<name>`, in this order:

| # | Script | Inputs | Outputs / writes |
|---|---|---|---|
| 0 | `check_db` | `DATABASE_URL` | Prints PostGIS version and whether each expected table exists. Writes nothing. |
| 1 | `fetch_census` | census.gov downloads; `CENSUS_API_KEY` for ACS | `data/raw/census/`: ZCTA shapes zip, ZCTA-county relationship txt, CA block group centers of population txt, CA places zip, `acs5_2024_B01003_zcta.json`. Skips files that already exist. |
| 2 | `load_areas` | `data/raw/census/*` only | Upserts table `areas` (208 rows); deletes rows for ZCTAs no longer in the region. |
| 3 | *(planned, M2)* load rent | Zillow ZORI/ZHVI CSVs | `area_metrics` |
| 4 | *(planned, M2)* fetch Mireye | `areas.centroid` | `data/raw/mireye/`, then `area_metrics` |
| 5 | *(planned, M4)* load crime | City open-data portals, Jev | `data/raw/crime/`, then `crime_aggregates` |

### `load_areas` in detail (`load_areas.py → areas.py`)
1. Read the relationship file, then `assign_counties()`: each ZCTA's county is the one with the most land; keep it only if that county is one of the 5 (D009).
2. Read the national ZCTA shapefile, keep those ZCTAs, reproject NAD83 → WGS84 (EPSG:4326), `to_multipolygon()` (repair, and always MultiPolygon).
3. Read block group centers of population, then `population_weighted_centroids()` (D010).
4. Read Census places, then `name_areas()`: the place where most residents live (D011).
5. If the ACS file exists, `parse_acs_population()` and merge (negative sentinels become NULL). Otherwise population is NULL, with a warning (D015).
6. `write_areas()`: in one transaction, `INSERT … ON CONFLICT (zcta) DO UPDATE` for every area, then `DELETE` areas not in the new set.

Shared helpers:
- `config.py`: repo paths (`RAW_DIR = data/raw`), loads `.env.local`, defines the 5 county FIPS codes, `require_env()`.
- `db.py`: `connect()` returns a psycopg connection from `DATABASE_URL`.

## 3. Request flow

1. Browser `GET /` → `app/layout.tsx` + `app/page.tsx` (server-rendered header) → renders `<AreaMap />`.
2. `components/AreaMap.tsx` (client component, runs in the browser):
   1. `useEffect` dynamically imports `maplibre-gl`, calls `setWorkerUrl("/maplibre/maplibre-gl-worker.mjs")`, and creates the map with the OpenFreeMap Positron basemap (D013).
   2. On `style.load` (not `load`, see D014): `fetch("/api/areas")`.
   3. Adds GeoJSON source `areas` (`promoteId: "zcta"`), plus layers `areas-fill` (opacity rises on hover via feature-state) and `areas-outline`.
   4. `mousemove` / `click` on `areas-fill` → `setSelected()` → the side panel shows name, ZIP, county, and population (or "No data") with source links.
3. `GET /api/areas` → `app/api/areas/route.ts`
   1. `await connection()`: always per-request (D007).
   2. `lib/areas.ts → getAreasGeoJSON()` → `getPool().query(AREAS_SQL)`: `SELECT zcta, name, county, population, ST_AsGeoJSON(ST_SimplifyPreserveTopology(geometry, 0.0003), 5) FROM areas` (D012).
   3. `toFeatureCollection(rows)` → JSON 200, or `{ error }` with 503 if the DB fails.
4. `GET /api/health` → `app/api/health/route.ts` → `SELECT PostGIS_Version()` → `{ ok, postgis }` (200) or `{ ok: false, error }` (503).

*(planned, M3)* Form submit → `app/api/score/route.ts` → geocode office (Mireye) → commute matrix (ORS, `commute_cache`) → `lib/scoring/score.ts` → JSON scores → map recolors.

## 4. Agent flow

*(planned, M5)* Chat message → Jev classify → if intent is in {`update_filter`, `set_priority`, `compare`} and confidence ≥ 0.7, apply the action and rescore with no LLM call; otherwise call Claude with tools and grounding context → structured action and/or explanation → log to `agent_logs`.

## 5. Module map

| Path | Owns |
|---|---|
| `app/layout.tsx` | Root HTML shell, fonts, page metadata |
| `app/page.tsx` | Home page: header + map |
| `components/AreaMap.tsx` | MapLibre map, area layers, hover/click, details panel with sources |
| `app/api/areas/route.ts` | Areas GeoJSON endpoint |
| `app/api/health/route.ts` | DB + PostGIS health check endpoint |
| `lib/areas.ts` | Areas SQL query and row → GeoJSON conversion |
| `lib/db.ts` | `DATABASE_URL` lookup and the shared Postgres pool |
| `scripts/copy-maplibre-worker.mjs` | Copies the MapLibre worker into `public/maplibre/` (postinstall) |
| `db/init/001_schema.sql` | Database schema, applied on first container start |
| `docker-compose.yml` | Local Postgres + PostGIS container |
| `pipeline/settle_pipeline/config.py` | Pipeline paths, env loading, county list |
| `pipeline/settle_pipeline/db.py` | Pipeline DB connection |
| `pipeline/settle_pipeline/check_db.py` | DB/schema smoke check |
| `pipeline/settle_pipeline/fetch_census.py` | Downloads and caches Census files and ACS population |
| `pipeline/settle_pipeline/areas.py` | Pure transforms: county assignment, centroids, names, ACS parsing |
| `pipeline/settle_pipeline/load_areas.py` | Builds and upserts the `areas` table |
| `vitest.config.ts` | TS test config (`*.test.ts`, `@/` alias) |
| `pipeline/pyproject.toml` | Python deps and pytest config |
| `decisions.md` | Decision log |
| `.env.example` | Required environment variables |
