# Flow

How the code actually executes, end to end. Must match the current code (see CLAUDE.md section 1.2).

**Current state: M4 (crime data, Jev + Claude classification, safety score).** Sections marked *(planned)* describe structure that does not exist in code yet.

---

## 1. Local setup

1. `docker compose up -d`: starts `settle-db` (Postgres 17 + PostGIS 3.5, amd64 image emulated on Apple Silicon) on `localhost:5433`.
   On first start with an empty volume, it runs `db/init/*.sql` in name order: `001_schema.sql` enables PostGIS and creates `areas`, `area_metrics`, `crime_aggregates`, `commute_cache` and `agent_logs`; `002_area_metrics_text_confidence.sql` makes `area_metrics.confidence` text and adds `notes` and `dataset_vintage`; `003_geocode_cache.sql` creates `geocode_cache`; `004_crime_aggregates_sources.sql` adds `cities`, `covered_share`, `covered_population`, `classification_status` to `crime_aggregates`.
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
| 7 | `fetch_crime` | data.sf.gov (`wg3w-h783`), data.oaklandca.gov (`ppgh-7dqv`), data.sanjoseca.gov (quarterly calls CSVs) | `data/raw/crime/{sf,oakland}/page_*.json`, `data/raw/crime/sanjose/calls_*.csv` for 2025-07 to 2026-06. Skips cached files. |
| 8 | `geocode_sanjose` | San Jose calls; US Census batch geocoder (free) | `data/raw/crime/sanjose/geocode/pass*_batch*_{in,out}.csv`, `street_to_latlng.json` |
| 9 | `prepare_crime` | steps 7–8 output, `areas` | `data/processed/crime_records.csv.gz` (normalized records with `zcta`), `crime_labels.json` (1,582 labels to classify) |
| 10 | `fetch_fbi` | `areas` (name, county); FBI CDE API (`FBI_API_KEY`) | `data/raw/fbi/agencies_CA.json`, `summarized_<ORI>_<offense>_07-2025_06-2026.json` (62 agencies × 2) |
| 11 | `load_fbi` | `data/raw/fbi/` only | `area_metrics`: `fbi_violent_per_1000`, `fbi_property_per_1000` for all 208 areas (card context, not scored) |
| 12 | `classify_crime` | `crime_labels.json`; Jev (`JEV_API_KEY`); Claude for confidence < 0.7 (`ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID`) | `data/raw/jev/crime/*.json`, `data/raw/claude/crime/*.json`, `data/processed/crime_classes.json` |
| 13 | `aggregate_crime` | records + `crime_classes.json`, `areas`, Census places + block groups | `crime_aggregates` (period `2025-07_2026-06`, 69 rows) |

Steps 3–4 and 5–6 are independent of each other; both need step 2 first.

### Crime steps in detail (D031, D032)
- `fetch_crime`: Socrata `$select/$where/$order/$limit/$offset` paging (50,000 rows per page) for SF and Oakland; CKAN resource CSV downloads for San Jose.
- `geocode_sanjose`: `sanjose.select_incidents()` (dedupe `EID`, keep report/arrest/citation) → `block_candidates()` per address → up to 3 Census batch passes over still-unmatched addresses → `ADDRESS → [lat, lng] | null`.
- `prepare_crime`: `crime.normalize_sf/normalize_oakland/normalize_sanjose()` → one table (`city, incident_key, occurred_at, label, lat, lng`) → `placement_rates()` → geopandas `sjoin` of points within `areas` geometries (read with `ST_AsBinary`) → `zcta`.
- `fetch_fbi` / `load_fbi` (D033): `fbi.agency_for_area()` maps each area to its city police department or county sheriff → one `/summarized/agency/{ori}/{offense}` call per agency and offense (1.1 s apart, cached) → `fbi.summarize()` (12-month total, annualized if months are missing, ÷ agency population × 1,000; California average from the same response) → `metrics.upsert_metrics()`.
- `classify_crime` (D034): `jev.crime_request()` per uncached label → `post_with_retry()` (4 threads) → cache → labels with confidence < 0.7 → `claude_classify.classify_with_claude()` (structured output, effort low, refusal fallback; stops cleanly if Claude is unreachable, leaving them `pending_claude`) → `crime_classes.json`.
- `aggregate_crime`: `crime_aggregate.city_coverage()` (residents inside covered cities) → `incidents_by_class()` (most severe class per incident) → `aggregate()` (counts, scaled violent+property per 1,000 covered residents, `null` below 50% coverage or 1,000 residents) → `DELETE` + `INSERT` this period's rows in `crime_aggregates`.

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

### 3a. Page load
1. Browser `GET /` → `app/layout.tsx` + `app/page.tsx` (server-rendered header) → `<Explorer />`.
2. `components/Explorer.tsx` (client) renders the sidebar (`<SearchForm>`) and `<AreaMap scores={null}>`.
3. `components/AreaMap.tsx` dynamically imports `maplibre-gl`, calls `setWorkerUrl()` (D014), creates the OpenFreeMap map (D013), and on `style.load` fetches `GET /api/areas` → adds the `areas` source (`promoteId: "zcta"`), `areas-fill` (rent colors from `lib/rentScale.ts`) and `areas-outline`, then sets `ready`.
4. `GET /api/areas` → `app/api/areas/route.ts` → `lib/areas.ts → getAreasGeoJSON()`: `areas` LEFT JOIN `area_metrics` (`rent_zori_usd`) → simplified GeoJSON with `rent_usd` per feature (D012).

### 3b. Submitting the form (the main M3 path)
1. `components/PriorityPicker.tsx`: six pair cards (`lib/priorities.ts → PAIR_CARDS`) → `prioritiesFromChoices()` sets the sliders, or "Skip" sets `SCORING.defaultPriorities` (D027).
2. `SearchForm` submit → `Explorer.runScore(req)` → `POST /api/score` with `{ salaryUsd, officeAddress, maxCommuteMin, rentBudgetUsd | null, priorities }`.
3. `app/api/score/route.ts`:
   1. `await connection()`; `lib/scoring/request.ts → parseScoreRequest()` validates the body (else 400).
   2. `lib/geocode.ts → geocodeOffice()`: `SELECT … FROM geocode_cache WHERE address_key = $1`; on a miss, `mireyeGeocoder` → **Mireye `POST /v1/geocode` (1 credit)** → `parseGeocodeResponse()` (accepts `rooftop` / `range_interpolation`; maps `address_too_coarse` / `address_not_found`) → `INSERT INTO geocode_cache`. A refusal → 422 with a message for the form (D025).
   3. `lib/commute.ts → getCommutes(office)`: `SELECT zcta, centroid FROM areas`; `SELECT … FROM commute_cache WHERE office_key = $1` (office rounded to 3 decimals). On a miss, `orsMatrixClient` → **ORS `POST /v2/matrix/driving-car`** (208 area sources → 1 office destination, `buildMatrixRequest()` / `parseMatrixResponse()`) → one `UNNEST` insert into `commute_cache` (D024, D028).
   4. `lib/scoring/loadInputs.ts → loadAreaInputs()`: `areas` LEFT JOIN LATERAL the latest `crime_aggregates` row (`rate_per_1000`, `cities` → `CRIME_SOURCES`) and all `area_metrics` → `groupMetrics()` → `evaluateRisks()` → `AreaInputs[]`.
   5. `lib/scoring/score.ts → scoreAreas(areas, user)` (pure, D026): validate → derive budget → hard filters → sub-scores (`affordabilitySubScore`, `commuteSubScore`, `safetySubScore`, `risksSubScore`) → `normalizeWeights()` over available sub-scores → weighted average → sort: areas with verified rent first, then score, then ZIP (D030).
   6. → JSON `{ office, commuteFromCache, timingMs, monthlyIncomeUsd, budgetUsd, budgetDerived, ranked[], filtered[], unavailableEverywhere }`. Errors: 400 bad input, 422 bad address, 502 upstream failure.
4. Back in `Explorer`: `setResult()` → `scores` (zcta → score) via `useMemo` → `<AreaMap scores>` writes each score into feature-state and switches `areas-fill` to `lib/scoreScale.ts → scoreFillExpression()`; office marker added; `<TopList>` shows the top 5.
5. Moving a slider after a result → `Explorer.handlePrioritiesChange()` → 300 ms debounce → `runScore()` with the same inputs (both caches hit; ~60–140 ms) → map recolors. Responses to superseded requests are ignored.

### 3c. Selecting an area
1. Map click or top-5 click → `Explorer.setSelectedZcta()` → `AreaMap` sets the `selected` feature-state (thick outline).
2. Sidebar shows `<AreaCard key={zcta} scoreSection={<ScoreBreakdown …/>}>`. `ScoreBreakdown` (from the scoring result, no extra request) shows score, rank, partial label, each sub-score with weight, explanation and source links, or the filter reason.
3. `AreaCard` fetches `GET /api/areas/[zcta]` → `app/api/areas/[zcta]/route.ts` → `lib/areaDetails.ts → getAreaDetails()` → housing, five hidden-risk flags with "N of 208 flagged", "City-wide crime (FBI)" (context only, D033), extras, all with `<SourceLink>` (D019, D021, D023, D033).

### 3d. Health
`GET /api/health` → `app/api/health/route.ts` → `SELECT PostGIS_Version()` → `{ ok, postgis }` (200) or `{ ok: false, error }` (503).

## 4. Agent flow

*(planned, M5)* Chat message → Jev classify → if intent is in {`update_filter`, `set_priority`, `compare`} and confidence ≥ 0.7, apply the action and rescore with no LLM call; otherwise call Claude with tools and grounding context → structured action and/or explanation → log to `agent_logs`.

## 5. Module map

| Path | Owns |
|---|---|
| `app/layout.tsx` | Root HTML shell, fonts, page metadata |
| `app/page.tsx` | Home page: header + `<Explorer />` |
| `components/Explorer.tsx` | Page state: request, result, selection; calls `/api/score`; live slider rescoring |
| `components/SearchForm.tsx` | Salary, office, max commute, budget inputs + priorities |
| `components/PriorityPicker.tsx` | Six "which matters more?" cards, then sliders |
| `components/TopList.tsx` | Top 5 ranked areas |
| `components/ScoreBreakdown.tsx` | Why an area scored what it did (or why it was filtered) |
| `components/AreaMap.tsx` | MapLibre map: rent or score coloring, legend, hover, selection, office marker |
| `components/AreaCard.tsx` | Detail card for one area: housing, hidden risks, extras, all with sources |
| `components/SourceLink.tsx` | The small source link shown next to every value |
| `app/api/areas/route.ts` | Areas GeoJSON endpoint (with rent) |
| `app/api/areas/[zcta]/route.ts` | One area's metrics, risk flags, and regional prevalence |
| `app/api/score/route.ts` | Geocode → commute → load inputs → score |
| `lib/scoring/score.ts` | Deterministic scoring: filters, sub-scores, weights, ranking (pure) |
| `lib/scoring/types.ts` | Scoring input/output types |
| `lib/scoring/loadInputs.ts` | Builds `AreaInputs` from the database and commute times |
| `lib/scoring/request.ts` | Validates the `/api/score` body; `ScoreRequest` / `ScoreResponse` types |
| `lib/geocode.ts` | Mireye geocoding with `geocode_cache` |
| `lib/commute.ts` | ORS matrix drive times with `commute_cache` |
| `lib/priorities.ts` | Pair cards and their mapping to slider values |
| `lib/scoreScale.ts` | Score colors, legend, MapLibre expression |
| `lib/areaDetails.ts` | Loads one area plus all metrics; `groupMetrics()` |
| `lib/risks.ts` | `evaluateRisks()` (five hidden-risk flags), `flagPrevalence()` |
| `lib/rentScale.ts` | Rent colors, legend rows, MapLibre fill expression |
| `lib/scoring/config.ts` | Every scoring number: risk thresholds, rent bands, budget rule, affordability curve, penalties, default priorities |
| `app/api/health/route.ts` | DB + PostGIS health check endpoint |
| `lib/areas.ts` | Areas SQL query and row → GeoJSON conversion |
| `lib/db.ts` | `DATABASE_URL` lookup and the shared Postgres pool |
| `scripts/copy-maplibre-worker.mjs` | Copies the MapLibre worker into `public/maplibre/` (postinstall) |
| `db/init/001_schema.sql` | Database schema, applied on first container start |
| `db/init/002_area_metrics_text_confidence.sql` | `confidence` → text; adds `notes`, `dataset_vintage` |
| `db/init/003_geocode_cache.sql` | `geocode_cache` table |
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
| `pipeline/settle_pipeline/fetch_crime.py` | Downloads 12 months of SF, Oakland and San Jose police data |
| `pipeline/settle_pipeline/sanjose.py` | Pure San Jose helpers: counted dispositions, block-address candidates, Census output parsing |
| `pipeline/settle_pipeline/geocode_sanjose.py` | Free Census batch geocoding of San Jose call addresses |
| `pipeline/settle_pipeline/crime.py` | Pure normalization of the three cities into one record table; placement rates |
| `pipeline/settle_pipeline/prepare_crime.py` | Builds normalized records with ZCTAs and the label list for Jev |
| `pipeline/settle_pipeline/crime_aggregate.py` | Pure coverage, per-incident severity, and rate aggregation |
| `pipeline/settle_pipeline/fbi.py` | Pure FBI helpers: area → agency, 12-month summary of an API response |
| `pipeline/settle_pipeline/fetch_fbi.py` | FBI CDE API fetch (agencies + summarized counts), cached |
| `pipeline/settle_pipeline/load_fbi.py` | Loads FBI city-level rates into `area_metrics` |
| `pipeline/settle_pipeline/jev.py` | Jev request/response helpers and retrying POST |
| `pipeline/settle_pipeline/claude_classify.py` | Claude fallback classifier (structured output) and client with optional workspace header |
| `pipeline/settle_pipeline/classify_crime.py` | Classifies all crime labels: Jev first, Claude below 0.7, all cached |
| `pipeline/settle_pipeline/aggregate_crime.py` | Builds `crime_aggregates` from classified records |
| `db/init/004_crime_aggregates_sources.sql` | Source and coverage columns on `crime_aggregates` |
| `vitest.config.ts` | TS test config (`*.test.ts`, `@/` alias) |
| `pipeline/pyproject.toml` | Python deps and pytest config |
| `decisions.md` | Decision log |
| `.env.example` | Required environment variables |
