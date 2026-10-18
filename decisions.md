# Decisions

Append-only log of non-trivial choices (see CLAUDE.md section 1.1). Never edit or delete old entries; supersede them with a new one.

---

## D001: Run Postgres + PostGIS in Docker for local development
Date: 2026.10.18
Status: accepted
Context: Docker was not installed on the dev machine, but Homebrew Postgres 16 was. The brief specifies PostGIS in Docker.
Decision: Owner installs Docker Desktop. `docker-compose.yml` runs `postgis/postgis:17-3.5`, mapped to host port **5433** so it never collides with the Homebrew Postgres on 5432. Data lives in the named volume `settle-pgdata`.
Alternatives considered: Homebrew Postgres + `brew install postgis` (no Docker, but setup lives outside the repo and is harder to reset); hosted Neon/Supabase for dev (needs an account, network round trips for pipeline loads).
Consequences: One command to start or reset the DB. The connection string in `.env.example` uses port 5433. The compose password is a local-only dev default (`settle`), not a secret.

## D002: Apply the schema via `db/init/*.sql` on first container start
Date: 2026.10.18
Status: accepted
Context: Need the section 7 tables to exist without adding a migration tool in M0.
Decision: Plain SQL files in `db/init/`, mounted into `/docker-entrypoint-initdb.d`. They run once when the volume is first created. Schema changes during early milestones: edit/add a file, then `docker compose down -v && docker compose up -d`.
Alternatives considered: A migration tool (Drizzle, Prisma, Alembic, dbmate). Adds a dependency and concepts before there is any production data to protect.
Consequences: Resetting the DB wipes loaded data (pipeline must be re-run; it builds from `data/raw/` cache so that is cheap). Revisit before deploy (M6), when a hosted DB needs incremental migrations.

## D003: Schema refinements to the section 7 starting point
Date: 2026.10.18
Status: accepted
Context: Section 7 lists columns; a few details needed choosing.
Decision:
- All geometries in EPSG:4326 (what GeoJSON and MapLibre use). GIST index on `areas.geometry`.
- `zcta` is `TEXT` (preserves leading zeros) and is the primary key of `areas`; other tables reference it with `ON DELETE CASCADE`.
- `area_metrics` gets an extra `value_text` column next to numeric `value`, because some Mireye fields are categorical or names (`seismic_design_category`, `nearest_hazardous_facility_name`). Primary key `(zcta, metric_name)`: one current value per metric.
- `area_metrics.source` and `source_url` are `NOT NULL`, enforcing "every metric carries its source" at the database level.
- `crime_aggregates.rate_per_1000` and `areas.population` are nullable: missing means unknown, never zero.
- `commute_cache` primary key `(office_key, zcta, mode)`; `office_key` is `"lat,lng"` rounded to 3 decimals.
Alternatives considered: One wide column per metric on `areas` (rigid; each new field needs a schema change and loses per-value source/confidence).
Consequences: Reading metrics for the map needs a pivot (or a SQL view) from long to wide. Fine at ~200 ZCTAs.

## D004: Pin Vitest to 3.2.4
Date: 2026.10.18
Status: accepted
Context: `npm install -D vitest` (latest) crashed npm 10.8's dependency resolver (`Cannot read properties of null (reading 'edgesOut')` while loading vitest's optional peer deps).
Decision: Pin `vitest@3.2.4`, a stable release that installs cleanly.
Alternatives considered: `--legacy-peer-deps` (hides real peer conflicts); upgrading npm globally (changes the owner's machine).
Consequences: Revisit when upgrading Node/npm.

## D005: Python pipeline managed with uv, sharing `.env.local` with the app
Date: 2026.10.18
Status: accepted
Context: The pipeline needs its own Python environment and the same secrets as the app.
Decision: `pipeline/` is a uv project (`pyproject.toml`, `uv.lock`, package `settle_pipeline`). Dependencies: pandas, geopandas, httpx, psycopg 3, python-dotenv; pytest for tests. Config loads the repo-root `.env.local`, so there is one env file for everything. Scripts run as modules: `uv run --project pipeline python -m settle_pipeline.<script>`.
Alternatives considered: pip + venv + requirements.txt (no lockfile by default); a separate `pipeline/.env` (two files to keep in sync).
Consequences: Owner needs `uv` (already installed).

## D006: Do not commit `data/raw/`
Date: 2026.10.18
Status: accepted
Context: Raw API caches and downloads (TIGER shapefiles, crime CSVs) can be hundreds of MB.
Decision: `data/raw/*` is git-ignored except `.gitkeep`. Raw files are rebuildable from their sources; API responses are cached there so tests and rebuilds never re-call paid APIs.
Alternatives considered: Git LFS (extra setup, storage limits).
Consequences: A fresh clone must re-download raw data once. Paid-API caches (Mireye) are not backed up by git; consider a manual backup after the M2 fetch.

## D007: Next.js 16 with Cache Components; DB routes opt out of prerendering
Date: 2026.10.18
Status: accepted
Context: `create-next-app@latest` produced Next.js 16.4 with `cacheComponents: true`, under which GET route handlers may be prerendered at build time.
Decision: Keep the generated defaults. Any route that touches the database calls `await connection()` first, so it always runs per request and `next build` never needs a live DB.
Alternatives considered: Disabling `cacheComponents`. No reason to diverge from the framework default yet.
Consequences: Remember the `connection()` call in each new DB-backed route.

## D008: Run the amd64 PostGIS image under emulation on Apple Silicon
Date: 2026.10.18
Status: accepted (amends D001)
Context: `docker compose up` failed on the owner's Apple Silicon Mac: `postgis/postgis:17-3.5` publishes no linux/arm64 image.
Decision: Add `platform: linux/amd64` to the `db` service; Docker Desktop runs it under emulation.
Alternatives considered: A community multi-arch image (e.g. `imresamu/postgis`): native speed, but a less official source. Homebrew PostGIS: see D001.
Consequences: The DB runs slower than native. That doesn't matter at ~200 ZCTAs, but bulk crime loads (M4) may be noticeably slower. Revisit if they are; hosted deploy DBs (M6) are unaffected. Verified: PostGIS 3.5, all five tables created, `/api/health` returns ok.

## D009: Region membership: a ZCTA belongs to the county holding most of its land
Date: 2026.10.18
Status: accepted
Context: ZCTAs do not nest inside counties. 214 ZCTAs touch the five counties; some barely (94920 Tiburon is 99.9% Marin).
Decision: Use the Census 2020 ZCTA-to-county relationship file (`tab20_zcta520_county20_natl.txt`). Each ZCTA gets the county with the largest `AREALAND_PART` (ties broken by lower FIPS). Keep it only if that county is one of the five. Result: **208 areas** (Alameda 49, Contra Costa 43, San Francisco 28, San Mateo 30, Santa Clara 58). Dropped: 94920 (Marin), 95023 (San Benito), 95033 and 95076 (Santa Cruz), 95219 and 95377 (San Joaquin).
Alternatives considered: Any overlap (pulls in Tiburon, Watsonville, Tracy); spatial intersection with county shapes (same answer, more code).
Consequences: Some included ZCTAs extend slightly outside the five counties; that's fine for a map of where to live. `county` is a single label even for straddling ZCTAs.

## D010: Population-weighted centroids from 2020 block group centers of population
Date: 2026.10.18
Status: accepted
Context: The brief asks for population-weighted centroids (used for Mireye lookups in M2 and commute origins in M3). Census does not publish them for ZCTAs.
Decision: Use the Census 2020 block group "centers of population" file for California (`CenPop2020_Mean_BG06.txt`, 1 MB). Take the population-weighted mean of the block group centers inside each ZCTA. If that mean falls outside the polygon (crescent shapes around water), snap to the nearest populated block group center. If a ZCTA has no populated block group center, use shapely's `representative_point()` (always inside). Verified: all 208 centroids fall inside their own ZCTA.
Alternatives considered: Geometric centroid (can land in the bay or on empty hills, which is wrong for flood/fire lookups); block-level weighting (needs the ~400 MB California block file for a small gain).
Consequences: Weights come from 2020 decennial counts, not current ACS estimates. That's fine for locating where people live.

## D011: Area names from the Census place where most residents live
Date: 2026.10.18
Status: accepted
Context: ZCTAs have no names; users need "Oakland 94611", not "94611".
Decision: Tag each populated block group center with the 2020 Census place (city or CDP, `cb_2020_06_place_500k`) containing it, sum population per (ZCTA, place), and use the largest. Unpopulated ZCTAs use the place containing their centroid. Otherwise "Unincorporated <County>" (7 areas, e.g. 94128 SFO, the San Mateo coast). The UI always shows the ZIP alongside the name, since names repeat (83 distinct names across 208 areas).
Alternatives considered: Place containing the centroid. Tried first; it mislabeled 94611 (mostly Oakland) as "Piedmont".
Consequences: No neighborhood names inside big cities (all SF ZCTAs are "San Francisco"). Neighborhood names could come later from a city-specific dataset.

## D012: Serve areas as GeoJSON from PostGIS, lightly simplified
Date: 2026.10.18
Status: accepted
Context: The map needs the 208 boundaries.
Decision: `GET /api/areas` returns a GeoJSON FeatureCollection built with `ST_AsGeoJSON(ST_SimplifyPreserveTopology(geometry, 0.0003), 5)` (~30 m tolerance, 5 decimals ≈ 1 m). About 375 KB uncompressed vs 521 KB unsimplified. Source shapes are the 1:500k generalized Census cartographic boundaries, clipped to shoreline.
Alternatives considered: Vector tiles (pg_tileserv or Martin): overkill for 208 polygons. A static GeoJSON file in `public/`: one less request path, but scores will be joined per request in M3 anyway.
Consequences: Per-polygon simplification can leave hairline gaps between neighbors; not visible at this tolerance. Stored geometry stays unsimplified for spatial joins.

## D013: Basemap from OpenFreeMap (Positron style)
Date: 2026.10.18
Status: accepted
Context: The brief asks for MapLibre with free vector tiles.
Decision: Use `https://tiles.openfreemap.org/styles/positron`: free, no API key, no request limits published, OpenStreetMap data. Attribution is rendered by MapLibre's attribution control from the style.
Alternatives considered: MapTiler and Stadia (need keys, free-tier limits); Protomaps self-hosted PMTiles (more setup).
Consequences: Depends on a donation-funded service with no SLA. Swapping basemaps is a one-line change in `components/AreaMap.tsx`.

## D014: MapLibre GL JS 6 integration workarounds
Date: 2026.10.18
Status: accepted
Context: `maplibre-gl@6.15.0` with Next.js 16 (Turbopack) rendered a blank map, for two reasons.
Decision:
1. **Worker file:** MapLibre 6 loads its web worker from a file next to its own bundle, which Turbopack doesn't serve. `scripts/copy-maplibre-worker.mjs` (run as npm `postinstall`) copies `maplibre-gl-worker.mjs` into `public/maplibre/` (git-ignored), and the component calls `setWorkerUrl("/maplibre/maplibre-gl-worker.mjs")`.
2. **Load event:** the map's `load` event never fired, because OpenFreeMap's low-zoom raster source (`ne2_shaded`, maxzoom 6) never reports loaded when the map opens at zoom 8.6. Our layers are added on `style.load` instead, which fires once the style is parsed.
Also: MapLibre's CSS forces `position: relative` on the map container, so the container is sized with `h-full w-full` rather than absolute positioning.
Alternatives considered: Pinning MapLibre 4.x (older API; postpones the problem); react-map-gl (another abstraction layer for a React beginner, and it still needs the worker fix).
Consequences: A fresh clone needs `npm install` (which runs the copy) before `npm run dev`. Re-check both workarounds when upgrading MapLibre.

## D015: Census Data API requires a key; population loads as NULL until it is set
Date: 2026.10.18
Status: accepted
Context: `api.census.gov` now redirects keyless requests to a "Missing Key" page. The owner chose to get a free key rather than switch to 2020 decennial counts.
Decision: Add `CENSUS_API_KEY` to `.env.example`. `fetch_census.py` calls ACS 5-year **2024** (2020–2024 estimates), variable `B01003_001E`, for all ZCTAs in one request, cached to `data/raw/census/acs5_2024_B01003_zcta.json`. `load_areas.py` still runs without that file and loads population as NULL with a warning, so the map works meanwhile. ACS "no estimate" sentinels (negative values) become NULL, never zero.
Alternatives considered: 2020 decennial block group counts (keyless, but older and approximate).
Consequences: Re-run `fetch_census` then `load_areas` once the key is in `.env.local`.

## D016: Mireye hidden-risk fetch: 14 fields at population-weighted centroids
Date: 2026.10.18
Status: accepted
Context: M2 needs hidden-risk data per area. Mireye is a paid API (free plan: 5,000 credits/month, 20 requests/min, 1 credit per field per location).
Decision:
- Confirmed all 14 candidate fields from CLAUDE.md section 4 against the free catalog (`GET /v1/meta/fields`, v0.16.0): all exist, all `stable`, 1 credit each, none in a metered (parcel) group.
- Priced with Mireye's own unmetered `POST /v1/fetch/quote`: **2,912 credits** (208 areas × 14 fields). Owner approved this amount on 2026.10.18.
- `fetch_mireye.py` sends 9 `POST /v1/fetch/batch` requests (25 locations max, sorted by zcta), 3.5 s apart. It refuses to run without `--confirm`, aborts if the quote exceeds the remaining allowance, sends a deterministic `Idempotency-Key` (sha256 of the body) so retries are free, and caches each raw response to `data/raw/mireye/batches/` before parsing.
- Mireye doesn't bill `failed` values (the first batch cost 346, not 350). `--retry-failed` re-requests only those, grouped by field list (10 road-distance timeouts → 10 credits, saved under `data/raw/mireye/retries/`).
- **Actual spend: 2,912 credits** (2,902 for batches + 10 for retries). 2,086 of 5,000 remain for October 2026.
- Field status semantics kept as Mireye defines them: `absent` is a real answer (e.g. "no RMP-registered facility within 10 km"), not missing data; `failed` is missing data.
- `source` is stored as `Mireye / <upstream>` (e.g. `Mireye / FEMA_NFHL`), and `source_url` is the upstream agency's page from Mireye's response.
Alternatives considered: Only the 10 risk fields (2,080 credits): owner chose all 14, since values are valid for about a year and the extras show on the card. `POST /v1/runs` (async jobs): unnecessary for 9 requests.
Consequences: Point values describe the population-weighted centroid, not every address in the area (the card says so). Re-running costs nothing while the cache exists; **back up `data/raw/mireye/`**, as it isn't in git (D006).

## D017: `area_metrics.confidence` becomes text; add `notes` and `dataset_vintage`
Date: 2026.10.18
Status: accepted (amends D003)
Context: Mireye returns `confidence` as a label (`high` / `medium` / `unknown`), not a number, plus a per-value note and a dataset vintage that explain the value (e.g. "ASCE 7-22", "no RMP-registered facility within 10 km").
Decision: `db/init/002_area_metrics_text_confidence.sql`: `confidence TEXT`, new `notes TEXT` and `dataset_vintage TEXT`. Applied by hand to the existing dev DB; runs automatically on a fresh volume.
Alternatives considered: Map labels to numbers (invents precision Mireye doesn't claim).
Consequences: Introduces the first numbered migration-style file under `db/init/`. Still no migration tool (D002).

## D018: Zillow rent (ZORI) and home value (ZHVI) by ZIP
Date: 2026.10.18
Status: accepted
Context: The brief asks for Zillow Research public CSVs with a 3-year trend. Zillow's API isn't available to individuals.
Decision:
- Rent: `Zip_zori_uc_sfrcondomfr_sm_month.csv` (ZORI, all home types, smoothed). Home value: `Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv` (ZHVI, middle tier, smoothed and seasonally adjusted). Both monthly by ZIP, latest month 2026-09.
- Join Zillow's ZIP (`RegionName`, zero-padded) to our ZCTA code. They match for residential areas; PO-box-only ZIPs have no ZCTA and are simply unused.
- Latest value = newest non-null month within the file's last 3 months; older counts as no data. 3-year change = latest vs the value 36 months before that same month.
- Metrics: `rent_zori_usd`, `rent_zori_usd_3yr_change_pct`, `home_value_zhvi_usd`, `home_value_zhvi_usd_3yr_change_pct`. Source "Zillow Research (ZORI/ZHVI)", link `https://www.zillow.com/research/data/`, vintage e.g. "ZORI 2026-09".
- Coverage: rent for 169/208 areas (trend for 139); home value for 196/208. Missing rent is mostly low-density areas (Atherton, Alamo, Portola Valley, Sunol) where Zillow publishes no index. These show "No data" and grey on the map, never a fake value.
Alternatives considered: Rent from Census ACS median gross rent (B25064): full coverage but lagging 2-3 years and including long-tenured below-market leases, so it's a poor guide to asking rent for a newcomer. Possible fallback in M3 for the 39 areas without ZORI; to decide then.
Consequences: Affordability scoring (M3) must handle 39 areas with no rent. Per CLAUDE.md section 5, they get a reweighted score marked "partial data", not a zero.

## D019: Hidden-risk flags on the card; provisional wildfire threshold; show regional prevalence
Date: 2026.10.18
Status: accepted (thresholds provisional until M3)
Context: The card needs the five flags from CLAUDE.md section 5. After loading the data, two of them turn out to be near-universal in the Bay Area: seismic design category D or above (**208 of 208** areas; Mireye assumes the default site class D) and a high hazard-potential dam within 10 km (**197 of 208**; "High" is a consequence-of-failure class, not a failure probability). Flood zone (14) and hazardous facility within 1 km (12) do discriminate. The brief doesn't define "high wildfire frequency".
Decision:
- `lib/risks.ts → evaluateRisks()` implements the five flags exactly as the brief defines them. Thresholds live in `lib/scoring/config.ts → RISK_THRESHOLDS`.
- Wildfire flag: FEMA NRI tract annualized frequency ≥ **0.003 events/yr** (about 1 in 333 years), roughly the region's 90th percentile; flags 26 areas.
- Each flag is three-state: flagged / clear / no data. Missing or failed data is never shown as clear. Mireye `absent` for the hazardous facility means "none within 10 km", which counts as clear.
- The card shows "N of 208 areas flagged" next to each flag (`flagPrevalence()`), so near-universal flags read as regional context rather than a warning about this area.
Alternatives considered: Dropping the two near-universal flags now (changes the brief; that's a scoring decision for M3). Region-relative percentile thresholds computed at runtime (thresholds would drift with the data; fixed constants are deterministic and testable).
Consequences: **Open question for M3:** as defined, the seismic and dam penalties would hit nearly every area equally. They'd lower all hidden-risk scores without changing the ranking. Options: replace "category D+" with a PGA-based threshold (range 0.54–1.33 g), or weight dam risk by distance. Decide with the owner in M3.

## D020: Rent choropleth with fixed $500 bands
Date: 2026.10.18
Status: accepted
Context: M2 asks for a basic choropleth by rent.
Decision: Six fixed bands (under $2,500; $2,500 to $3,000; …; $4,000 to $5,000; $5,000 and up; bounds in `lib/scoring/config.ts → RENT_BANDS_USD`), ColorBrewer OrRd, grey for no data. One module (`lib/rentScale.ts`) produces both the MapLibre `step` expression and the legend, so they can't disagree. Band edges belong to the upper band, matching MapLibre `step`.
Alternatives considered: Quantile bands (legend numbers change whenever data refreshes); a continuous gradient (harder to read exact ranges).
Consequences: Areas range $2,216 to $8,082 (median ~$3,540), so the bands spread the middle of the distribution well. Revisit if rents shift a lot.

## D021: Area detail endpoint computes flags server-side, loading all metrics per request
Date: 2026.10.18
Status: accepted
Context: The card needs one area's metrics plus region-wide flag counts.
Decision: `GET /api/areas/[zcta]` loads all ~3,750 `area_metrics` rows, groups them per area, and runs `evaluateRisks` for the selected area and `flagPrevalence` over all of them. Hover uses only `rent_usd`, which is already on the map features from `/api/areas`.
Alternatives considered: A precomputed prevalence table (another pipeline step to keep in sync); computing in the browser (ships all metrics to every visitor).
Consequences: A few milliseconds per click locally. If it gets slow, cache prevalence in memory, since it only changes when the pipeline runs.

## D022: Drop the `JEV_API_URL` environment variable
Date: 2026.10.18
Status: accepted
Context: CLAUDE.md section 8 listed both `JEV_API_KEY` and `JEV_API_URL`. The owner decided the URL variable isn't needed.
Decision: Remove `JEV_API_URL` from `.env.example`, `.env.local` and CLAUDE.md section 8. When Jev is integrated (M4/M5), its endpoint becomes a named constant in the Jev client module, taken from TypeSafe AI's docs. Only the key stays in the environment, because only the key is secret. Also added `CENSUS_API_KEY` to the CLAUDE.md list (introduced in D015) so the brief matches `.env.example`.
Alternatives considered: Keeping the variable for switching environments (e.g. a staging endpoint): no such need yet; easy to reintroduce.
Consequences: The Jev endpoint, request/response format and confidence field are still unknown and must come from the owner before M4 (CLAUDE.md section 3).
