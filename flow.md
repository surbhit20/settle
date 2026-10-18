# Flow

How the code actually executes, end to end. Must match the current code (see CLAUDE.md section 1.2).

**Current state: M2 (rent choropleth and hidden-risks card).** Sections marked *(planned)* describe structure that does not exist in code yet.

---

## 1. Local setup

1. `docker compose up -d`: starts `settle-db` (Postgres 17 + PostGIS 3.5, amd64 image emulated on Apple Silicon) on `localhost:5433`.
   On first start with an empty volume, it runs `db/init/*.sql` in name order: `001_schema.sql` enables PostGIS and creates `areas`, `area_metrics`, `crime_aggregates`, `commute_cache` and `agent_logs`; `002_area_metrics_text_confidence.sql` makes `area_metrics.confidence` text and adds `notes` and `dataset_vintage`.
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
| 3 | `fetch_mireye` **(paid)** | `areas.centroid`, `MIREYE_API_TOKEN` | `data/raw/mireye/batches/*.json` (9 files). Dry run unless `--confirm`; `--limit N`; `--retry-failed` writes `data/raw/mireye/retries/*.json`. Skips cached batches. |
| 4 | `load_mireye` | `data/raw/mireye/{batches,retries}/` only | Upserts 14 metrics × 208 areas into `area_metrics`. |
| 5 | `fetch_zillow` | files.zillowstatic.com | `data/raw/zillow/` ZORI and ZHVI CSVs. Skips files that exist. |
| 6 | `load_zillow` | `data/raw/zillow/` only | Upserts 4 metrics × 208 areas into `area_metrics`. |
| 7 | *(planned, M4)* load crime | City open-data portals, Jev | `data/raw/crime/`, then `crime_aggregates` |

Steps 3–4 and 5–6 are independent of each other; both need step 2 first.

### `load_areas` in detail (`load_areas.py → areas.py`)
1. Read the relationship file, then `assign_counties()`: each ZCTA's county is the one with the most land; keep it only if that county is one of the 5 (D009).
2. Read the national ZCTA shapefile, keep those ZCTAs, reproject NAD83 → WGS84 (EPSG:4326), `to_multipolygon()` (repair, and always MultiPolygon).
3. Read block group centers of population, then `population_weighted_centroids()` (D010).
4. Read Census places, then `name_areas()`: the place where most residents live (D011).
5. If the ACS file exists, `parse_acs_population()` and merge (negative sentinels become NULL). Otherwise population is NULL, with a warning (D015).
6. `write_areas()`: in one transaction, `INSERT … ON CONFLICT (zcta) DO UPDATE` for every area, then `DELETE` areas not in the new set.

### `fetch_mireye` in detail (D016)
1. `load_centroids()`: `SELECT zcta, ST_Y(centroid), ST_X(centroid) FROM areas ORDER BY zcta` → `make_batches()` of 25.
2. Drop batches whose file already exists in `data/raw/mireye/batches/`.
3. `quote()`: `POST /v1/fetch/quote` per batch size (unmetered). Abort if total > remaining allowance; stop here unless `--confirm`.
4. For each batch: `POST /v1/fetch/batch` `{fields: FIELDS, locations: [{lat, lng}]}` with `Idempotency-Key`; write `{zctas, request, fetched_at, response}` to disk; sleep 3.5 s.
5. `GET /v1/users/me/usage` → print credits used and remaining.
6. `--retry-failed`: `failed_values()` parses the cache, groups failed (zcta, field) pairs by field list, re-requests only those, and saves to `retries/`.

### `load_mireye` / `load_zillow` in detail
- `mireye.parse_batch_record()`: results are index-aligned with `record["zctas"]` → one `MetricRow` per (zcta, field), keeping Mireye's `status`, `confidence`, `notes`, `dataset_vintage`, `source`, `source_url`. Booleans become value 1/0 plus text "true"/"false". `merge_rows()` lets successful retries replace failures.
- `zillow.latest_and_change()`: per ZCTA, newest non-null month within the last 3, plus % change vs 36 months earlier. `to_metric_rows()` emits a value row and a `_3yr_change_pct` row, with `status = 'no_data'` and a note when missing.
- Both write through `metrics.upsert_metrics()` (`INSERT … ON CONFLICT (zcta, metric_name) DO UPDATE`), one transaction.

Shared helpers:
- `config.py`: repo paths (`RAW_DIR = data/raw`), loads `.env.local`, defines the 5 county FIPS codes, `require_env()`.
- `db.py`: `connect()` returns a psycopg connection from `DATABASE_URL`.
- `metrics.py`: `MetricRow` type, `upsert_metrics()`, `region_zctas()`.

## 3. Request flow

1. Browser `GET /` → `app/layout.tsx` + `app/page.tsx` (server-rendered header) → renders `<AreaMap />`.
2. `components/AreaMap.tsx` (client component, runs in the browser):
   1. `useEffect` dynamically imports `maplibre-gl`, calls `setWorkerUrl("/maplibre/maplibre-gl-worker.mjs")`, and creates the map with the OpenFreeMap Positron basemap (D013).
   2. On `style.load` (not `load`, see D014): `fetch("/api/areas")`.
   3. Adds GeoJSON source `areas` (`promoteId: "zcta"`), plus layers `areas-fill` (color = `lib/rentScale.ts → rentFillExpression()`, grey for null rent; opacity rises on hover) and `areas-outline` (thick dark line when feature-state `selected`).
   4. `mousemove` → `setHovered()` → the panel shows name, ZIP and rent. `click` → `setSelectedZcta()` → the panel renders `<AreaCard key={zcta}>`, and a second `useEffect` sets the `selected` feature-state.
   5. The legend (bottom right) is built from `rentLegend()`, the same scale as the map.
3. `components/AreaCard.tsx` (on click): `fetch("/api/areas/<zcta>")` → renders Housing (rent, 3-yr change, home value, population), Hidden risks (five flags: flagged / clear / no data, "N of 208 areas flagged", source links) and More about the area (landslide, fiber, heat days, airport, major road). Every value has a `<SourceLink>`; missing values show "No data".
4. `GET /api/areas` → `app/api/areas/route.ts`
   1. `await connection()`: always per-request (D007).
   2. `lib/areas.ts → getAreasGeoJSON()` → `getPool().query(AREAS_SQL)`: `areas` LEFT JOIN `area_metrics` (`rent_zori_usd`, status ok) → `zcta, name, county, population, rent_usd, ST_AsGeoJSON(ST_SimplifyPreserveTopology(geometry, 0.0003), 5)` (D012).
   3. `toFeatureCollection(rows)` → JSON 200, or `{ error }` with 503 if the DB fails.
5. `GET /api/areas/[zcta]` → `app/api/areas/[zcta]/route.ts`
   1. `await connection()`; validate 5 digits (else 400).
   2. `lib/areaDetails.ts → getAreaDetails()`: `SELECT … FROM areas WHERE zcta = $1` (else 404), then all `area_metrics` rows → `groupMetrics()`.
   3. `lib/risks.ts → evaluateRisks(this area)` (thresholds from `lib/scoring/config.ts`) and `flagPrevalence(all areas)` (D019, D021).
   4. → JSON `{ zcta, name, county, population, metrics, risks, prevalence }`.
6. `GET /api/health` → `app/api/health/route.ts` → `SELECT PostGIS_Version()` → `{ ok, postgis }` (200) or `{ ok: false, error }` (503).

*(planned, M3)* Form submit → `app/api/score/route.ts` → geocode office (Mireye) → commute matrix (ORS, `commute_cache`) → `lib/scoring/score.ts` → JSON scores → map recolors.

## 4. Agent flow

*(planned, M5)* Chat message → Jev classify → if intent is in {`update_filter`, `set_priority`, `compare`} and confidence ≥ 0.7, apply the action and rescore with no LLM call; otherwise call Claude with tools and grounding context → structured action and/or explanation → log to `agent_logs`.

## 5. Module map

| Path | Owns |
|---|---|
| `app/layout.tsx` | Root HTML shell, fonts, page metadata |
| `app/page.tsx` | Home page: header + map |
| `components/AreaMap.tsx` | MapLibre map, rent choropleth, legend, hover summary, selection |
| `components/AreaCard.tsx` | Detail card for one area: housing, hidden risks, extras, all with sources |
| `components/SourceLink.tsx` | The small source link shown next to every value |
| `app/api/areas/route.ts` | Areas GeoJSON endpoint (with rent) |
| `app/api/areas/[zcta]/route.ts` | One area's metrics, risk flags, and regional prevalence |
| `lib/areaDetails.ts` | Loads one area plus all metrics; `groupMetrics()` |
| `lib/risks.ts` | `evaluateRisks()` (five hidden-risk flags), `flagPrevalence()` |
| `lib/rentScale.ts` | Rent colors, legend rows, MapLibre fill expression |
| `lib/scoring/config.ts` | All thresholds: risk flags, rent bands (weights and penalties come in M3) |
| `app/api/health/route.ts` | DB + PostGIS health check endpoint |
| `lib/areas.ts` | Areas SQL query and row → GeoJSON conversion |
| `lib/db.ts` | `DATABASE_URL` lookup and the shared Postgres pool |
| `scripts/copy-maplibre-worker.mjs` | Copies the MapLibre worker into `public/maplibre/` (postinstall) |
| `db/init/001_schema.sql` | Database schema, applied on first container start |
| `db/init/002_area_metrics_text_confidence.sql` | `confidence` → text; adds `notes`, `dataset_vintage` |
| `docker-compose.yml` | Local Postgres + PostGIS container |
| `pipeline/settle_pipeline/config.py` | Pipeline paths, env loading, county list |
| `pipeline/settle_pipeline/db.py` | Pipeline DB connection |
| `pipeline/settle_pipeline/check_db.py` | DB/schema smoke check |
| `pipeline/settle_pipeline/fetch_census.py` | Downloads and caches Census files and ACS population |
| `pipeline/settle_pipeline/areas.py` | Pure transforms: county assignment, centroids, names, ACS parsing |
| `pipeline/settle_pipeline/load_areas.py` | Builds and upserts the `areas` table |
| `pipeline/settle_pipeline/fetch_mireye.py` | Paid Mireye batch fetch: quote, confirm, cache, retry failed |
| `pipeline/settle_pipeline/mireye.py` | Pure parsing of cached Mireye responses into metric rows |
| `pipeline/settle_pipeline/load_mireye.py` | Loads cached Mireye data into `area_metrics` |
| `pipeline/settle_pipeline/fetch_zillow.py` | Downloads Zillow ZORI/ZHVI CSVs |
| `pipeline/settle_pipeline/zillow.py` | Pure transform: latest value and 3-yr change per ZIP |
| `pipeline/settle_pipeline/load_zillow.py` | Loads Zillow metrics into `area_metrics` |
| `pipeline/settle_pipeline/metrics.py` | `MetricRow` type and the shared `area_metrics` upsert |
| `vitest.config.ts` | TS test config (`*.test.ts`, `@/` alias) |
| `pipeline/pyproject.toml` | Python deps and pytest config |
| `decisions.md` | Decision log |
| `.env.example` | Required environment variables |
