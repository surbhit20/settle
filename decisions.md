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

## D023: Redefine the earthquake and dam flags so they discriminate between areas
Date: 2026.10.18
Status: accepted (supersedes the seismic and dam parts of D019)
Context: As defined in CLAUDE.md section 5, "seismic design category D or above" flagged 208 of 208 areas, and "high hazard dam within 10 km" flagged 197 of 208. A penalty applied to almost every area lowers all hidden-risk scores without changing the ranking, so it gives the user no information. Owner chose new definitions at the start of M3.
Decision:
- **Earthquake:** flag when `seismic_pga_2pct_50yr_g` ≥ **1.1 g** (peak ground acceleration with a 2% chance in 50 years, USGS 2023 NSHM). Flags **50** areas, roughly those nearest the Hayward and San Andreas faults. Design category is still shown on the card as context.
- **Dam:** flag when the **nearest** dam (`nearest_dam_distance_m`) is **High** hazard-potential (`nearest_dam_hazard_potential`) and **closer than 2 km**. Flags **33** areas. Mireye `absent` (no NID dam within 10 km) counts as clear. The 10 km count is still shown on the card.
- Constants in `lib/scoring/config.ts`: `seismicPgaFlagG: 1.1`, `highHazardDamMaxMeters: 2000`. Tests cover both boundaries.
Alternatives considered: PGA ≥ 1.0 g (111 areas), ≥ 1.2 g (13); dam within 3 km (57), within 1 km (11); keeping the brief's rules.
Consequences: Known limitation: the dam rule looks only at the nearest dam, so a High dam at 1.5 km behind a nearer Low dam at 1 km is missed. Mireye has no "nearest High dam distance" field; accept this for v1. Flag counts now: flood 14, wildfire 26, earthquake 50, dam 33, hazardous facility 12.

## D024: OpenRouteService for commute times: free-tier limits and usage
Date: 2026.10.18
Status: accepted
Context: CLAUDE.md section 4 asks to check and record ORS's current free-tier limits.
Decision: Limits as published on 2026.10.18 (account.heigit.org/info/plans and openrouteservice.org/restrictions):
- Standard (free) plan, **Matrix V2: 500 requests/day, 40/minute**. (Directions V2: 2,000/day, 40/min; Geocoding: 3,000/day, 100/min. Unused.)
- **Matrix size: at most 3,500 origin × destination pairs per request** (25 with dynamic arguments).
- We send one request per new office: `POST /v2/matrix/driving-car` with 209 locations (office + 208 centroids), `sources: [0]`, all others as destinations, `metrics: ["duration"]`. That's 1 × 208 = 208 pairs, well under 3,500.
- Results cached in `commute_cache` keyed by office coordinate rounded to 3 decimals (~100 m). A repeat search from the same office costs no request.
- ORS public routing returns **free-flow driving times (no live or rush-hour traffic)**. The UI labels commute as "drive time without traffic". We don't apply an invented traffic multiplier.
Alternatives considered: Google Distance Matrix (traffic-aware but paid); transit via GTFS (v2 scope).
Consequences: Peak-hour commutes in the Bay Area are often far longer than free-flow; users should set their max commute with that in mind. A traffic model or transit mode is a v2 candidate.

## D025: Office geocoding via Mireye, cached by normalized input
Date: 2026.10.18
Status: accepted
Context: CLAUDE.md section 4: geocode the office with Mireye `POST /v1/geocode` (1 credit) and reject centroid accuracy.
Decision:
- Mireye already refuses centroid-grade matches with `404 address_too_coarse` (verified: "1 Ferry Building, San Francisco" was refused; "1 Market St, San Francisco, CA 94105" returned `accuracy_type: rooftop`). We accept `rooftop` and `range_interpolation`, and reject anything else, including any `*centroid*` type, as a second guard.
- Response fields used: `lat`, `lng`, `accuracy_type`, `normalized_address`, `source`. Samples cached in `data/raw/mireye/geocode/`.
- Results (successes and "too coarse"/"not found" refusals) are cached in a new `geocode_cache` table keyed by the trimmed, lowercased address, so each distinct address costs at most one credit. Both test calls appear to have been billed (usage went from 2,914 to 2,916), so caching refusals matters too.
- The geocoder is injected into the scoring route, and tests use a fake; tests never call Mireye.
Alternatives considered: ORS geocoding (free 3,000/day, but the brief specifies Mireye and its refusal of centroid matches); browser geolocation (not an office address).
Consequences: A user typo costs a credit once. With ~2,084 credits left this month there's ample headroom for development.

## D026: Scoring formulas and edge-case rules
Date: 2026.10.18
Status: accepted
Context: CLAUDE.md section 5 defines the shape of scoring; several details needed fixing. All numbers are in `lib/scoring/config.ts → SCORING`; logic is in `lib/scoring/score.ts` (pure, 30+ unit tests).
Decision:
- **Derived budget:** with no budget given, budget = **30%** of gross monthly income (salary / 12), the standard rent-to-income guideline.
- **Hard filters**, in order: no driving route → `no_route`; commute > max → `commute_too_long`; rent > budget × **1.15** → `rent_over_budget`. Areas with **no rent data are kept** (we can't show they're over budget) and marked partial.
- **Affordability:** piecewise linear on rent ÷ gross monthly income: ≤30% → 100, 40% → 75, ≥50% → 0. That's gentle from 30% to 40%, then steep, per the brief.
- **Commute:** linear, 0 min → 100, the user's max → 0.
- **Safety:** inverted mid-rank percentile of crime per 1,000 among all areas with data (filtered or not, so moving a filter doesn't change safety scores). Ties get equal percentiles.
- **Hidden risks:** 100 minus penalties per flag: flood 25, wildfire 20, earthquake 15, dam 15, hazardous facility 20; floor 0. An unknown flag adds no penalty but marks the area partial.
- **Final score:** weighted average of the sub-scores that have data, with slider weights renormalized over those. If every relevant slider is 0, equal weights.
- **Partial data:** an area is partial when one of its sub-scores (or risk flags) is missing *for that area*. A sub-score with no data anywhere in the region (safety until M4) is returned once in `unavailableEverywhere` and shown as "not scored yet", instead of putting "partial data" on all 208 areas.
- **Invalid input** (salary ≤ 0, max commute ≤ 0, budget ≤ 0) throws `ScoringInputError` → HTTP 400. Scoring never runs on a zero salary.
- **Ties:** sort by score descending, then ZIP ascending, so the order is fully deterministic.
Alternatives considered: Budget at 33% or 35% of gross (looser; 30% is the conventional threshold); a smooth affordability curve (harder to explain in one sentence); counting areas with no rent as over budget (treats missing data as a fact).
Consequences: **Open issue for review:** areas with no rent data skip both the budget filter and the affordability sub-score. A short commute can then carry them to the top (e.g. downtown 94111 and 94104, population ~500, rank #1–2 for a $3,000 budget). They're labeled partial, but it reads poorly. To decide with the owner.

## D027: "Which matters more?" pair cards set the priority sliders
Date: 2026.10.18
Status: accepted
Context: Owner chose pair cards plus sliders over plain sliders (people tend to max every slider).
Decision: Six cards, one per pair of the four priorities, each a concrete tradeoff ("Pay about $400 a month less in rent" vs "Drive about 20 minutes less each way"); wording lives in `lib/priorities.ts`. Slider value = 2 × (wins + 1), so the four values are proportional to 1–4 and fit the 0–10 range. "Skip" sets the Balanced preset (5 each). After the cards the sliders stay editable and "Redo the questions" restarts them. Safety cards are asked now so the weight is ready when crime data lands (M4).
Alternatives considered: Bradley-Terry or other preference models (overkill for 6 answers); dropping safety cards until M4 (users would answer again later).
Consequences: Card wording can bias answers. Kept magnitudes roughly comparable; revisit if one side wins almost always.

## D028: Commute direction and caching
Date: 2026.10.18
Status: accepted (complements D024)
Context: ORS matrix durations are directional.
Decision: Areas are matrix **sources** and the office is the single **destination** (home → work, the morning commute). One call returns all 208 times. Seconds → minutes; `null` = no route (filtered as `no_route`). Cache rows in `commute_cache` are written in one `UNNEST` insert. A cache hit requires a row for every current area.
Alternatives considered: Office → areas (evening direction; one-way streets and freeway ramps make it differ slightly).
Consequences: First search for a new office takes ~2 s (geocode + matrix); repeats take ~60–140 ms. Moving sliders re-posts to `/api/score`, which hits both caches and spends nothing.

## D029: M3 page layout and live rescoring
Date: 2026.10.18
Status: accepted
Context: M3 adds a form, a heat map, a top 5 list and a score breakdown.
Decision: `components/Explorer.tsx` owns page state. Left sidebar (full width on small screens, 384 px on desktop): form, pair cards or sliders, budget note, top 5. Clicking an area or list item replaces the sidebar with the area card, which now opens with the score breakdown (score, rank, partial label, each sub-score bar with weight, explanation and source links) or the filter reason. The map shows rent before the first search and the personal score after (`lib/scoreScale.ts`, green, filtered areas grey), plus an office marker. Slider changes rescore after a 300 ms debounce. Older responses are ignored if a newer request was sent.
Alternatives considered: Scoring in the browser (would ship all metrics to every visitor and duplicate the server path the agent will use in M5).
Consequences: The form stays mounted while a card is open, so typed values survive. Mobile polish is M6.

## D030: Rank areas with verified rent before areas without rent
Date: 2026.10.18
Status: accepted (resolves the open issue in D026)
Context: Areas with no Zillow rent skip both the budget filter and the affordability sub-score, so a short commute could carry them to the top. With a $3,000 budget from 1 Market St, downtown 94111 and 94104 (no rent data, ~500 residents) ranked #1 and #2, above areas proven to fit the budget.
Decision: Owner chose to sort in two groups. First, every ranked area whose rent is known (affordability sub-score present); then every area without rent. Within each group: score descending, then ZIP ascending. Areas without rent keep their own score (missing data still isn't counted as zero, per CLAUDE.md section 5.3) and their "partial data" label. The breakdown says they're "ranked after every area with known rent, since we can't confirm it fits your budget". Implemented in `lib/scoring/score.ts` step 4; two new tests.
Alternatives considered: Keep pure score order (brief's literal rule; misleading top results); fall back to ACS rent (declined earlier: lags and understates newcomer rent); hide areas without rent (removes places someone might want).
Consequences: Rank no longer strictly follows score: a no-rent area can show a higher number than areas above it. Verified with the same search: the top 5 are now all known-rent areas, and the first no-rent area (94111, score 95.8) is at #50, right after the 49 areas with rent.

## D031: Crime dataset verification (SF, Oakland, San Jose)
Date: 2026.10.18
Status: accepted (findings); San Jose approach pending owner decision
Context: CLAUDE.md section 4 asks to verify each city's dataset fields and licensing before ingesting crime data. Metadata snapshots are cached in `data/raw/crime/meta/`.
Findings:
- **San Francisco**: DataSF "Police Department Incident Reports: 2018 to Present" (`wg3w-h783`, Socrata; the portal moved to `data.sf.gov`). License **PDDL 1.0** (public domain). Updated daily. Fields include `incident_id`, `incident_datetime`, `report_type_description`, `incident_category` (49), `incident_subcategory` (70), `incident_description` (662 distinct over 12 months), `latitude`/`longitude` (snapped to the nearest intersection for anonymity), `analysis_neighborhood`. ~93k rows / ~72k distinct `incident_id` per 12 months: supplemental reports repeat an incident, so **count distinct `incident_id`**. ~3.7% of rows have no coordinates.
- **Oakland**: "CrimeWatch Data" (`ppgh-7dqv`, Socrata, full history; the 90-day `ym6k-rx7a` is a subset). **No license stated** in the dataset metadata; published under the City's open data policy (Council Resolution 84659, 2013) with a no-warranty disclaimer. Fields: `casenumber`, `datetime`, `crimetype` (45), `description` (744 distinct), `policebeat`, `address` (block-level), `location` (point). 49,172 rows / 41,310 case numbers for Jul 2025 to Jun 2026: rows are charges, not incidents (e.g. 765 "HOMICIDE" rows), so **count distinct `casenumber`**, keeping the most severe class per case. ~4% of rows have no location. OPD says records take up to 90 days to finish processing; confirmed (Jul to Sep 2026 run ~25–35% below normal months).
- **San Jose**: only "Police Calls for Service" (CKAN, quarterly CSVs + datastore API), license **CC0**. These are **dispatch calls, not incident reports**: in 2026 Q2, 32k of 70k are "No report required", 15k "Canceled", 11k "Report taken". Fields: `CALL_NUMBER`, `EID`, `CALL_TYPE`, `FINAL_DISPO`, `OFFENSE_DATE`, `ADDRESS` (block ranges like `[300]-[400] TRADEWINDS DR` or intersections), **no coordinates**. Rows can repeat (same `EID`).
- **Window:** use **July 2025 to June 2026** for all cities, the latest 12 months that are complete given Oakland's processing lag, so cities are comparable.
- **Coverage:** SF 28 areas, Oakland 15, San Jose 30, so 73 of 208 areas (~2.3M of 6.3M residents). The other 135 areas get `null` safety and "no data" per CLAUDE.md section 4.
Consequences: SF and Oakland are usable as-is. San Jose needs an owner decision (geocode calls, skip, or city-level FBI fallback). Oakland's missing license is noted; it's public data under a city open-data policy, used non-commercially with attribution.

## D032: Crime ingestion: San Jose geocoding, deduplication, coverage, scaling, rate definition
Date: 2026.10.18
Status: accepted (aggregation awaits Jev classification)
Context: Owner chose to geocode San Jose calls for free and to use Oakland's data with attribution (D031). The three cities' data differ in record type, duplication and mappability.
Decision:
- **Window:** 2025-07-01 to 2026-07-01 for all cities (`fetch_crime.py`, period label `2025-07_2026-06`).
- **San Jose calls counted:** one row per `EID`, only dispositions "Report taken", "Arrest Made", "Criminal Citation" → 50,814 incidents. Excluded: no report, canceled, gone on arrival, unfounded, traffic citations, warrant arrests, supplemental reports.
- **San Jose geocoding:** free US Census batch geocoder (`/geocoder/locations/addressbatch`, benchmark `Public_AR_Current`, ≤10,000 rows per batch, no key, no published rate limit). Hundred-block `[300]-[400] X DR` becomes `350 X DR`; misses retry with expanded suffixes (AV→AVE, WY→WAY, BL→BLVD, …) and then the low end of the block. Result: 8,136 of 10,563 block addresses, **65.9% of incidents placed**. Intersections (17% of calls) aren't supported by the batch geocoder and are left unplaced for now.
- **Labels to classify:** SF `incident_description`, Oakland `description`, San Jose `CALL_TYPE`, uppercased and trimmed. 1,582 distinct (city, label) pairs → one Jev call each, cached.
- **Deduplication:** by incident (SF `incident_id`, Oakland `casenumber`, San Jose `EID`), after classification, keeping the **most severe** class (violent > property > minor). The incident's area comes from its first located row.
- **Placement scaling:** counts used in the rate are multiplied by 1 / (city's share of incidents with a location): SF 0.951, Oakland 0.957, San Jose 0.659. This assumes unplaced incidents are spread like placed ones. It keeps San Jose from looking ~34% safer just because its addresses are harder to map. Raw counts are stored unscaled.
- **Coverage:** ZIP areas and city limits don't align. For each area, the share of residents (2020 block-group centers of population) living inside SF, Oakland or San Jose (Census places). Denominator = ACS population × covered share. A rate is published only if covered share ≥ **50%** and covered population ≥ **1,000**; otherwise `null` ("no data"). Result: **69 areas** get a rate (SF 26, Oakland 14, San Jose 29).
- **Rate definition:** `rate_per_1000` = (violent + property) incidents per 1,000 covered residents per year. "Minor" incidents are counted (`minor_count`) but don't affect the safety score, since cities record minor events very differently (San Jose's calls include parking violations).
- Outputs: `data/processed/crime_records.csv.gz`, `crime_labels.json` (git-ignored, rebuildable).
Alternatives considered: Divide by full area population (understates rates in partially covered areas); no placement scaling (San Jose looks safer than it is); counting minor incidents (not comparable across cities); geocoding intersections via a paid geocoder (Mireye: ~4,200 credits, over budget).
Consequences: Safety is relative across three differently collected datasets: SF and Oakland incident reports vs San Jose police calls with reports or arrests. The UI must say so next to every safety number. Follow-up: place San Jose intersections (another free geocoder, or by intersecting street centerlines) to cut the scaling.

## D033: FBI city-level crime rates on area cards (context only, not in the ranking)
Date: 2026.10.18
Status: accepted
Context: 135 of 208 areas have no city incident data (D031). The owner asked to use the FBI Crime Data Explorer, and chose to show it on cards only, keeping it out of the safety score, so the ranking never mixes city-wide annual counts with neighborhood incident data.
Decision:
- **API (confirmed by probing 2026.10.18; official reference page not reachable, endpoint paths taken from the open-source `@cyanheads/fbi-crime-mcp-server` and verified live):** base `https://api.usa.gov/crime/fbi/cde`, free api.data.gov key in `FBI_API_KEY` (query param `API_KEY`). `GET /agency/byStateAbbr/CA` (agencies by county, with ORI, type, NIBRS flag); `GET /summarized/agency/{ori}/{violent-crime|property-crime}?from=07-2025&to=06-2026` (monthly `actuals`, monthly `rates` per 100,000 for the agency, California and US, monthly `population`).
- **Rate limit:** header `x-ratelimit-limit: 10` stayed at `remaining: 9` across ~130 calls spaced 1.1 s apart, so it's a short (per-second) window, not hourly. `fetch_fbi.py` spaces calls 1.1 s and stops on 429. Full fetch: 124 calls, ~3 minutes, no throttling.
- **Area → agency** (`fbi.agency_for_area`): the city's own police department ("<Name> Police Department"); otherwise the county sheriff (unincorporated areas, unincorporated towns like Castro Valley or Alamo, cities that contract with the sheriff like Millbrae or San Carlos, Stanford). 208 areas → 62 agencies, none unmapped.
- **Rate:** 12-month offenses ÷ agency population × 1,000. If an agency reported fewer than 12 months, the total is annualized (× 12 / months) and the card says so. SF and Oakland reported only 6 of 12 months for this window.
- **Storage:** `area_metrics` `fbi_violent_per_1000`, `fbi_property_per_1000` (agency name in `value_text`; notes hold population, months reported, California average). Source "FBI Crime Data Explorer: <agency>", vintage "FBI UCR, Jul 2025 to Jun 2026".
- **Card:** new "City-wide crime (FBI)" section, labeled "Shown for context only: not used in your score". `lib/scoring/loadInputs.ts` doesn't read these metrics.
Alternatives considered: Filling the safety score from FBI rates (every ZIP in a city would share one value, mixing data types); replacing city incident data with FBI everywhere (loses neighborhood detail); the CIUS Table 8 annual download (calendar 2025 only, not our window).
Consequences: Every area card now has some crime context, including the 135 areas with no neighborhood safety score. Sheriff figures cover all of a county's unincorporated and contract areas together, so they're coarse. The card parses months and the California average from the stored note; if the note format in `load_fbi.py` changes, update `fbiContext()` in `components/AreaCard.tsx`.

## D034: Crime classification with Jev, Claude fallback, and the safety score
Date: 2026.10.18
Status: accepted (Claude fallback blocked until ANTHROPIC_WORKSPACE_ID is set; all 69 rates are "provisional" until then)
Context: CLAUDE.md section 6 says Jev classifies raw crime descriptions into violent / property / minor, cached by description. The owner said the key alone is enough; the endpoint details came from public docs.
Decision:
- **Jev API** (public docs from Pipecat, LiteLLM, Netlify, Promptfoo; verified with live calls): `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer $JEV_API_KEY`, body `{state, model, questions: {crime_class: {type: "choice", instructions, criteria: {violent, property, minor}}}}`; answer `answers.crime_class = {choice, confidence, probabilities}`; `usage.input_tokens`. Model pinned to `jev-1.13.0`. Pricing per third-party sources: $0.042 per million input tokens, output free; rate limits unpublished, so 4 in flight with retry on 429/529 honoring `Retry-After`.
- **Run:** 1,582 distinct (city, label) pairs in 51 s, 738k input tokens (≈ $0.03). Each answer cached at `data/raw/jev/crime/<sha1>.json`. The state text gives city and record kind ("San Francisco police incident report description: …").
- **Low confidence → Claude:** 229 labels (≈ 5% of records) came back under 0.7, including clear errors ("SC UNEXPLAINED DEATH", "DEATH REPORT, CAUSE UNKNOWN", "CORONERS CASE" → violent; "FELONY HIT AND RUN" → minor). The owner chose the chat router's pattern: below 0.7, Claude decides. `claude_classify.py` uses `claude-opus-5-5`, structured JSON output (enum of the three classes + reason), effort `low`, server-side refusal fallback (`fallbacks: "default"`), a system prompt that settles the known edge cases (deaths of unknown cause and victimless weapon possession → minor; injury hit-and-run → violent). Cached at `data/raw/claude/crime/`.
- **Blocked:** the Anthropic key isn't scoped to a workspace, so every call returns 400 until `ANTHROPIC_WORKSPACE_ID` is set (sent as the `anthropic-workspace-id` header by `make_client()`). Until then those labels keep Jev's answer, `crime_classes.json` marks them `pending_claude`, and `crime_aggregates.classification_status` is `provisional`. Re-run `classify_crime` then `aggregate_crime` once the ID is set.
- **Aggregation** (`aggregate_crime.py`, logic from D032): placement scale SF ×1.052, Oakland ×1.045, San Jose ×1.517; 69 rates published (SF 26, Oakland 14, San Jose 29), stored with `cities`, `covered_share`, `covered_population` (`db/init/004_crime_aggregates_sources.sql`).
- **Scoring:** `loadInputs.ts` reads the latest `crime_aggregates` row per area and attaches the city's dataset as the safety source (SFPD/DataSF, OPD/City of Oakland, San Jose PD calls with a report or arrest). Explanations say "violent and property incidents per 1,000 residents a year; safer than N% of the 69 areas with data". Areas without neighborhood data say so and point to the city-wide FBI figure (D033).
Alternatives considered: Leaving low-confidence labels out (drops ~10k records, some real crimes); keeping Jev's top choice (death reports stay violent); classifying everything with Claude (more cost and latency than the brief intends).
Consequences: Safety now ranks within the 69 covered areas. The 135 areas without city data are reweighted and labeled partial per CLAUDE.md section 5.3, so with a high safety slider they can still rank near the top (e.g. Daly City 94014 at #1 from 1 Market St). That's the brief's rule, flagged for owner review.

## D035: Claude fallback run: crime rates are final
Date: 2026.10.18
Status: accepted (resolves the block in D034)
Context: With `ANTHROPIC_WORKSPACE_ID` set, the Claude fallback from D034 could run.
Decision: Ran `classify_crime` (Claude on the 229 labels with Jev confidence < 0.7) and `aggregate_crime`.
- Cost and time: 124,486 input + 18,377 output tokens on `claude-opus-5-5` (≈ $0.87), ~10 minutes sequential. All answers cached in `data/raw/claude/crime/`; 0 labels left `pending_claude`.
- Claude changed **109 of 229** labels (6,190 records). Main fixes: deaths of unknown cause and coroner cases (Oakland "SC UNEXPLAINED DEATH", SF "DEATH REPORT, CAUSE UNKNOWN", San Jose "CORONERS CASE") and victimless weapon possession → minor; San Jose "FELONY HIT AND RUN" → violent.
- **Judgment call kept:** San Jose "DISTURBANCE, FAMILY" (1,383 calls with a report) and "DISTURBANCE, FAMILY (COMBINED EVENT)" → minor. Some involve violence, many don't; San Jose records charged domestic violence under other call types. Revisit if San Jose looks too safe relative to the other cities.
- Effect: all 69 rates now `final`. Median change −2.7%; largest drops in San Jose (95139: 15.7 → 12.7 per 1,000). No area moved more than 3 places among the 69.
Consequences: Records by class after the fallback: property 85,039, violent 34,445, minor 73,499. Re-running is free unless new labels appear (e.g. after refreshing the crime window).

## D036: Chat agent: Jev router, deterministic fast path, Claude fallback with a grounding check
Date: 2026.10.18
Status: accepted
Context: M5 (CLAUDE.md section 6): Jev routes each chat message; filter, priority and compare requests update the map with no LLM call; explanations and anything uncertain go to Claude, which may state only numbers from its context.
Decision:
- **Router** (`lib/agent/router.ts`): Jev intent (one `choice` question over the six intents, `jev-1.13.0`). Fast path only when **confidence ≥ 0.7** (`ROUTER_CONFIDENCE`, the brief's starting value) **and** the intent is `update_filter`/`set_priority`/`compare` **and** the deterministic parser succeeds. Otherwise Claude. If Jev errors, Claude answers and the log records a null intent.
- **Parsers** (`lib/agent/parse.ts`, 20 tests): relative and absolute budget, commute and salary changes ("budget goes up 300", "max commute 30", "drive 15 more minutes", "salary 200k"); one-topic priority changes (±3 on 0–10, "don't care" → 0); area lookup by ZIP or place name (longest name first, "Unincorporated …" never matched). Fast-path replies are templates filled from the scoring result ("Updated: rent budget $4,500 → $4,800/mo").
- **Compare fast path:** needs two or more *places*; reports each place's best-ranked ZIP, rank and score, or "filtered out". ZIP-vs-ZIP within one city goes to Claude.
- **Claude** (`lib/agent/claude.ts`): `claude-opus-5-5`, effort **medium**, refusal fallback `fallbacks: "default"`, four strict tools (`update_filter`, `set_priority`, `compare_areas`, `select_area`) emitting the same actions as the fast path. Strict mode rejects `minimum`/`maximum` on integers, so ranges are in descriptions and `toolToAction()` clamps. Tool results are returned, and the reply is the final turn's text (the prompt says to call tools first, then answer). Context (`lib/agent/context.ts`): user inputs, budget, top 5 and mentioned areas with sub-scores, inputs, explanations and sources. Mentioned areas: typed ZIPs exactly, else a place's best-ranked ZIPs (max 8).
- **Grounding check** (`lib/agent/grounding.ts`): every number of 10 or more (or any decimal) in Claude's reply must equal or round to a number in the context (fractions may be written as percents). If not, one rewrite is requested; numbers that still fail are flagged in the reply. It can't catch a real number attached to the wrong area. At effort `low` Claude once wrote "Typical rent is $3,518... correction: $4,486" (another area's rent), so effort is `medium` and the prompt says to check each number against that area's entry.
- **Live map updates:** `POST /api/chat {message, request}` re-runs scoring for the current inputs (geocode and commute cached, so free), routes, logs, and returns `{reply, actions, route, intent, confidence, latencyMs}`. The browser applies the actions: filter and priority changes rescore and refill the form (remount via `key`); `select_area` opens a card; `compare` outlines areas in blue.
- **Logging:** each message goes to `agent_logs` (message, intent, confidence, route, latency_ms); a logging failure never breaks the chat. `AGENT_STATS_SQL` in `lib/agent/log.ts` gives share per route and median latency. Never quote these numbers without running it.
- Shared scoring pipeline moved to `lib/scoring/run.ts` (used by `/api/score` and `/api/chat`).
Alternatives considered: Asking Jev to extract parameters (its question types are choice / score / yes-no, with no extraction); sending everything to Claude (slow and paid for routine "what if" questions); effort `low` (faster, but wrong-area numbers).
Consequences: Measured during development (test traffic, not usage): fast path ~0.1–0.3 s; Claude 5–20 s at medium effort. Streaming Claude's reply would improve perceived speed (M6 candidate). The safety-weighting and missing-data caveats from D034 also shape what Claude can say.

## D037: M6 polish: loading states, mobile layout, sources page, README; history scrubbed before first push
Date: 2026.10.18
Status: accepted
Context: M6 asks for loading and empty states, a mobile layout, source attributions and a README. The owner also asked to push to github.com/surbhit20/settle (public).
Decision:
- **Map fits the region** (`lib/geo.ts → geojsonBounds()`, `fitBounds` with 16 px padding) instead of a fixed center and zoom, so all 208 areas fit on any screen; Gilroy was cut off before.
- **Loading states:** "Loading map…" stays up until the `areas` GeoJSON source reports `isSourceLoaded` (via `sourcedata`; not the map's `idle` event, which never fires because of the basemap raster, D014). The map could otherwise sit blank for several seconds. An "Updating scores…" pill shows while `/api/score` runs. A hint under the form explains that the map shows rent until a search. Existing: chat "Thinking…", card "Loading…", "No areas match" with suggestions, error banners.
- **Mobile (< 768 px):** map on top at 55% of the screen, sidebar below, and the whole page scrolls. A card opened from the map appears right under it, so map and card stay in view; an auto-scroll was tried and dropped (the map's tap handling cancelled it, and it hid the map). Legend collapses to a tappable title; MapLibre attribution is compact.
- **Sources page** (`/sources`, linked in the header): every dataset and service with link, use and stated license, plus caveats. OSM/openrouteservice/OpenFreeMap attribution also stays on the map.
- **README** with screenshots (`docs/screenshots/`), setup, keys, pipeline run order, tests, layout.
- **Secret found and scrubbed before the first push:** the real `FBI_API_KEY` value had been written into `.env.example` and committed in 4 commits (from the FBI commit onward). It was caught by scanning history for the actual `.env.local` values, then removed with `git filter-branch` (tree filter blanking the line). Backup refs, reflog and the stash pointing at the old commits were cleared and garbage-collected; a byte-level scan of history and the object store found none of the 8 keys. Only then was `main` pushed. The key was never on any remote.
Alternatives considered: A separate mobile view with tabs (more code than the stacked layout needs); keeping the fixed zoom with a mobile-specific value (breaks on other sizes).
Consequences: Before every commit and push, scan staged content for the real key values, not just filenames. Rotating the FBI key is optional since it never left the machine; it's free if wanted.

## D038: Home size (shared room, studio, 1–4 bedrooms) with HUD rents; areas under 1,000 residents not ranked
Date: 2026.10.18
Status: accepted
Context: The owner asked to let people say what kind of home they want ("somebody might want a shared place, a studio, or a 4 BHK"). Zillow's public rent index (ZORI) is one "typical home" figure per ZIP with no bedroom breakdown (its by-bedroom files are home values, ZHVI, not rents).
Decision:
- **Source:** HUD Small Area Fair Market Rents FY2027 (`FY27_safmrs.xlsx`, huduser.gov, public domain, effective 2026-10-01): rent per ZIP for 0–4 bedrooms; all 208 areas covered. Owner chose this over (a) scaling Zillow by HUD's bedroom ratios (our own blend, harder to explain) and (b) Census ACS B25031 (top-coded at $3,500+, so most Bay Area 3–4 bedroom values are stuck there, and 2–3 years old). HUD's site rejects scripted requests without a browser-like User-Agent; `load_hud.py` sends one.
- **Shared room:** no official figure; estimated as **a third of the 3-bedroom rent** (owner's choice over half a 2-bedroom), stored as `rent_shared_room_est` with the note "Estimate: one third of HUD's 3-bedroom rent" and labeled "(estimate)" on cards.
- ZIPs that straddle two HUD metro areas (7 of ours, e.g. 94550 Livermore in Modesto and Oakland-Fremont) use the row for the area's county's metro (`COUNTY_HUD_AREA`).
- **Scoring:** `homeType` input (`any` default = Zillow typical rent; `shared`, `studio`, `1br`…`4br` = HUD). `rentFor()` picks the rent; budget filter and affordability use it; a missing size is no data (partial, ranked after known-rent areas per D030), never another size's rent. Explanations name the size and cite HUD. Labels and metric names in `lib/scoring/config.ts → HOME_TYPES`.
- **UI and chat:** "Home size" picker on the form; card shows "Rent by home size" with the chosen size in bold; results note states the size. `parseHomeType()` handles "studio(s)", "2 bedroom", "3 bhk", "two-bed", "roommates", "any size"; the fast path replies "home size Any size → 2 bedrooms"; Claude's `update_filter` tool gained a `home_type` enum. Live: all three test phrases took the fast path (Jev confidence 0.8–1.0, 85–314 ms).
- **Few residents:** HUD publishes rents even for ZIPs almost nobody lives in, which pushed 94188 (0 residents) to #3 and 94104 (498) to #1 for a 2-bedroom. New hard filter `few_residents`: areas with fewer than **1,000** residents (`SCORING.minPopulation`) aren't ranked; their card says how many live there. 13 areas (SFO, Mills College, office districts, rural hills). Unknown population doesn't filter.
Alternatives considered: RentCast rent-by-bedroom (50 requests/month cap for 208 ZIPs; ruled out by the hard cap); dropping the shared option (owner kept it as a labeled estimate).
Consequences: HUD rents are the 40th percentile and include utilities, so they can run below current asking rents; the Sources page says so. Switching home size can change which areas pass the budget filter (e.g. 4 bedrooms: 39 areas over budget at $180k vs 9 for "any").

## D039: Fix strict-schema crash on the Claude path; area facts for filtered-out areas; friendly chat errors
Date: 2026.10.18
Status: accepted
Context: Owner testing found every Claude-routed chat message failing with a raw 400 shown in the chat ("Enum value 'any' does not match declared type ['string','null']"). D038 had added `home_type` to the `update_filter` tool as `type: ["string","null"]` with an `enum`, which strict tool mode rejects. Fast-path messages kept working, so the D038 live checks (all fast path) missed it. Separately, Claude answered "what's the crime rate in San Jose?" with "I don't have San Jose crime rates" because filtered-out areas only carried their filter reason in the context.
Decision:
- Nullable enums in tool schemas are written as `anyOf: [{type: "string", enum: [...]}, {type: "null"}]`.
- New test `lib/agent/schema.test.ts` walks every tool's `input_schema` and fails on strict-mode problems seen so far (`minimum`/`maximum`; `enum` with a type array; objects without `additionalProperties: false` or with non-required properties).
- `buildContext()` adds `facts` for every mentioned area, ranked or filtered: population, neighborhood crime rate (or "no neighborhood crime data") with source, typical rent with source, rent by size with source, commute minutes with source.
- The chat route logs the real error server-side and returns a plain message; the chat box never shows raw API errors.
Alternatives considered: Dropping `strict` from tools (loses the schema guarantee); describing filtered areas only by their filter reason (Claude can't answer simple data questions about them).
Consequences: Any future tool-schema change is checked by the test before it reaches the API. Verified live: the San Jose question now returns per-ZIP rates with sources; a mixed request ("2 bedroom and safety matters most", Jev confidence 0.52) went to Claude, which applied both changes.

## D040: FBI city-wide rates as the safety fallback, on a separate scale
Date: 2026.10.18
Status: accepted (supersedes the "context only, not in the ranking" part of D033)
Context: The owner asked why crime wasn't shown for many areas. Only 69 areas have neighborhood crime rates; the other 135 showed "Safety: no data" and were reweighted (D026), so with a high safety slider they could rank near the top on the factor they were missing. FBI city-wide rates exist for all 208 areas (D033). Owner chose to use them as a fallback in the score.
Decision:
- Areas with a neighborhood rate are scored exactly as before, as an inverted percentile among the 69 neighborhood rates.
- Areas without one use their police agency's FBI rate (violent + property per 1,000, `fbi_violent_per_1000 + fbi_property_per_1000`), scored as an inverted percentile **among the other FBI-based areas only** (one entry per area).
- **Why separate scales:** in the three cities with both, the population-weighted neighborhood rate is 1.63× the FBI rate in SF, 1.31× in Oakland and 0.97× in San Jose. The sources count different incident sets, so mixing them in one percentile would make FBI-only cities look systematically safer. A single conversion factor isn't stable across cities, so none is invented.
- Labeling: `inputs.basis` is "neighborhood" or "city-wide (FBI)"; the explanation reads "City-wide estimate: <agency> reports X violent and property crimes per 1,000 residents a year; safer than N% of the M areas scored this way. No neighborhood-level data here." The top 5 shows a "city-wide safety" tag; the chat context carries both rates with sources. An area with neither source still has no safety score (never zero).
Alternatives considered: Card-only (D033; leaves 135 areas unscored on safety); pooling raw FBI and neighborhood rates (bias above); calibrating FBI by a fitted ratio (1.0–1.6 spread makes any single factor arbitrary).
Consequences: Every ranked area now has a safety score (from 1 Market St: 33 neighborhood, 60 city-wide). Rankings shift: e.g. Daly City 94014 moved from #1 to #5 once its safety (61st percentile) counted. All ZIPs in one city share their city-wide safety score. A 100 means "safest of its kind" (safest neighborhood, or safest city), which the explanation states.

## D041: Visual refresh: Figtree + EB Garamond, warm design tokens, roomier layout
Date: 2026.10.18
Status: accepted
Context: The owner found the UI cramped and not premium, and asked for type like Wispr Flow's. The app was also rendering in Arial: a leftover `font-family` rule in `globals.css` overrode the Geist font set up in the layout.
Decision:
- Fonts: **Figtree** for text and **EB Garamond** (with italics) for headings and big numbers, the pairing wisprflow.ai serves (checked from its font files). Both load through `next/font/google`, so they're self-hosted at build time with no runtime request to Google.
- Colors are CSS variables in `app/globals.css` (warm paper background, near-black ink, muted gray, one deep green accent), exposed to Tailwind as `bg-paper`, `text-ink`, `text-muted`, `border-line`, `bg-accent` and so on. Dark mode swaps only the variable values, so components no longer need `dark:` variants for these.
- Layout: wider sidebar (26–28rem) with more padding; rounded panels; pill buttons and inputs. Area-card rows put the value on the right with its source link on a second line, so long source names no longer squeeze the row.
Alternatives considered: keeping Geist with spacing fixes only (doesn't answer the "premium" ask); a paid typeface (licensing cost).
Consequences: New UI should use the tokens rather than raw `zinc-*` colors; a few untouched spots (e.g. the Sources page body) still use zinc and can move over gradually. The score-map colors are unchanged.

## D042: Send what's on screen with every chat message
Date: 2026.10.18
Status: accepted
Context: The owner opened Los Altos (office in Los Altos) and asked to compare "it" with San Jose for rent and extra commute. The chat only received the message and the form inputs, so "it" meant nothing, and the fast compare reply gave only rank and score.
Decision:
- The browser sends `view: { selectedZcta, compared }` with each message. The server validates it (`parseViewState`: 5-digit 9xxxx ZIPs, compared list deduplicated, at most 8); bad values become empty.
- Fast path: if a compare message names only one place and a card is open, the open ZIP is compared with it. Compare replies now include rent for the user's home size and drive time, with differences from the first place (the open area when there is one).
- Claude path: the open area, then compared areas, lead `mentioned_areas`. The context gains `on_screen`, and each other area gets `vs_selected_area` with precomputed rent and commute differences. Claude may only quote numbers from its context, so the subtraction is done in code.
- The chat shows "Asking about <area>" above the input, so the user can see what "it" refers to.
- Also updated the Claude system prompt's safety line, which still said safety existed only for SF, Oakland and San Jose (outdated since D040).
Alternatives considered: sending the past few chat turns (helps follow-ups but adds earlier numbers to grounding and longer prompts; can be added later); asking the user which area they mean (slower than reading the screen).
Consequences: "it/this/here" works on both routes. For a multi-ZIP city like San Jose, the comparison uses its best-ranked ZIP and says so. Chat history is still not sent.

## D043: Explanations state what the data shows, not what's missing
Date: 2026.10.18
Status: accepted
Context: The city-wide safety explanation (D040) ended with "No neighborhood-level data here (only SF, Oakland and San Jose publish it)." The owner asked not to highlight negatives: say what we know.
Decision: The sentence is removed. The explanation now reads "City-wide: <agency> reports X violent and property crimes per 1,000 residents a year; safer than N% of the M areas scored this way." "City-wide" still tells the reader the figure's scope. The coverage caveat stays on the Sources page and in the README, where it belongs.
Alternatives considered: keeping a softer caveat on each card (still reads as a negative on every non-SF/Oakland/San Jose area).
Consequences: Applies to user-facing score text. "No data" labels stay where a value is truly missing, since showing nothing would be misleading.

## D044: Chat as a floating, minimizable window in the bottom-right corner
Date: 2026.10.18
Status: superseded in part by D045
Context: The chat sat at the bottom of the sidebar, so it scrolled out of view and was hard to find. The owner asked for the familiar support-chat placement: bottom-right, always on screen, minimizable but never removable, and separate from the map legend.
Decision:
- `ChatBox` renders with `position: fixed` at the bottom-right of the viewport, from `Explorer` (outside the sidebar), so page scroll never moves it. It opens as a panel (24rem wide, or the screen width minus margins on phones; up to 36rem tall) and minimizes to an "Ask Settle" button. There is no close button. It starts minimized; messages survive minimizing.
- Before the first search the button and panel still show, with the input disabled and a "Run a search first" hint.
- The map legend and the map credits (ⓘ) moved to the bottom-left corner; the sidebar gets extra bottom padding on phones so the button never covers its last item.
Alternatives considered: a chat tab inside the sidebar (still scrolls, competes with the form); a draggable window (more code, and easy to drag off screen, which the owner ruled out).
Consequences: On narrow desktop windows the open panel can overlap the legend; minimizing it clears the view. The legend's placement in older screenshots in `docs/screenshots/` is out of date until they're retaken.

## D045: Chat appears after a search as a docked banner; legend top-right; centered title
Date: 2026.10.18
Status: accepted
Context: Owner feedback on D044: the chat should appear only once something has been searched; minimized, it should be a banner rather than an "Ask Settle" button; the map legend should sit in the top-right corner; and the Settle title should be centered.
Decision:
- `Explorer` renders `ChatBox` only after the first result. The window is docked to the bottom edge, 1rem from the right, 24rem wide. Minimized, it's a banner of the same width titled "Ask or adjust", with a subtitle showing the open area or an example question and an up chevron. It still can't be closed. It starts minimized.
- Map: legend top-right; zoom buttons moved to top-left; the hover card moved to bottom-left above the map credits.
- Header: a three-column grid (spacer, title, "Data sources") so "Settle" and its tagline are centered on the page.
Alternatives considered: keeping the chat visible but disabled before a search (D044; the owner preferred hiding it); a pill-style launcher (rejected by the owner).
Consequences: First-time visitors don't see the chat until they search, so the empty-state text doesn't mention it. Screenshots in `docs/screenshots/` are out of date until retaken.

## D046: Slim one-row header; tagline moves under the form heading
Date: 2026.10.18
Status: accepted
Context: The centered title plus tagline (D045) made the header two lines tall (91 px), taking space from the map. The owner also saw the zoom buttons overlapping the legend.
Decision: The header is one row (45 px): "Settle" centered, "Data sources" on the right. The tagline ("Bay Area neighborhoods, ranked for your salary, office and priorities.") now sits in small text under "Where should you live?" in the sidebar. The legend's maximum width leaves 5rem on the left, so it can never reach the top-left zoom buttons on a narrow map. (The overlap the owner saw was an old map instance from before D045: map controls are placed once when the map loads, so a dev hot reload keeps them in their old corner until the page is refreshed.)
Alternatives considered: deleting the tagline (loses the one-line explanation for new visitors); putting it on the right of the header (crowds "Data sources" and wraps on phones).
Consequences: More vertical room for the map and sidebar.

## D047: Side-by-side comparison from the map
Date: 2026.10.19
Status: accepted
Context: Comparing areas was only possible through the chat, and its answer was a line of text. The owner asked to click a second area on the map and choose between opening it or adding it to a comparison, with the areas side by side, every value matched row by row (shared room against shared room), one shared scroll, and the better value highlighted.
Decision:
- With an area card or comparison open, a map click on another area shows a small chooser at the click point: "Open this area" or "Add to compare". With nothing open, a click still opens the card directly, and the top 5 list always opens directly.
- Up to 3 areas. When full, "Add to compare" becomes "Swap into comparison" and replaces the last column.
- `lib/compare.ts` (pure, unit tested) builds matched rows from the same data the card uses. Each row says which way is better: lower for rent, rank, drive time, risk flags, crime, landslide and hot days; higher for scores and fiber providers. Population, home value, airport and major road distance are neutral (closer can mean convenience or noise), so they're never highlighted. No data is never best, and a tie across all areas highlights nothing.
- `CompareView` draws everything as one CSS grid (label column plus one column per area), so rows can't drift apart and the whole table scrolls as one, with area names pinned at the top. The sidebar widens to min(46rem, 68% of the screen) while comparing, covering part of the map.
- Every value keeps its source link under it.
- The chat's compare action now opens the same view, and removing down to one area shows that area's card.
Alternatives considered: two separate cards side by side (rows drift apart, each scrolls on its own, which the owner ruled out); a full-screen compare page (loses the map with its blue outlines).
Consequences: Comparisons work before a search too (no score rows then). The direction choices for neutral rows can be revisited.

## D048: Public-transit commute from precomputed 511.org timetables
Date: 2026.10.19
Status: accepted
Context: The owner asked for approximate public-transit commute times next to driving (a v2 item in CLAUDE.md). Live options (Google transit directions) cost money per search, cap requests at 100 areas, and can't be stored. The owner chose precomputed times.
Decision:
- **Data:** 511.org Open Data regional GTFS (`operator_id=RG`, every Bay Area operator in one feed; 43 operators listed). License: the 511 Data Disseminator Agreement (2026 PDF, checked 2026.10.19) grants use, storage, derived works and public display. It requires the credit "data provided by 511.org" with a link to 511.org next to the data, and documentation to MTC within 30 days of a public launch (to do at deploy). Rate limit 60 requests/hour; the pipeline makes one request and caches the file. The 511 site's general terms (personal, non-commercial) don't apply to token API use, which they explicitly carve out. OSM street and footpath network from Geofabrik's Northern California extract, cropped with osmium-tool to the five counties plus about 5 km (194 MB).
- **Routing:** r5py 1.1.7 (Conveyal R5; GPL-3.0-or-later or MIT) with Java 21 (Homebrew `openjdk@21`, found via `JAVA_HOME`, no system install). Transit plus walking at 4.8 km/h, from each area's population-weighted center to every other area's center: 208 × 208 = 43,264 pairs. Departure every minute 7:30–9:00 on a typical Tuesday in the feed (2026-10-27; holidays skipped); the stored time is the median over that window. Trips over 2 hours count as no route. 16,265 pairs have a route.
- **Feed fix:** R5 rejects the 511 feed because 232 station pathway nodes (`location_type` 3) have blank names, which the GTFS standard allows. The pipeline writes a copy with those names set to their stop IDs; no other change.
- **Same-area trips:** routed center to center they'd be 0, so they're estimated as half the time to the nearest other area (a standard transport-model convention) and labeled "estimated".
- **App:** the office is matched to the area containing it (or the nearest center within 3 km), and every area's time is looked up to that area's center, with no API calls. A "How do you get to work? Drive / Public transit" toggle decides which time is filtered and scored; explanations, cards, comparisons and the chat show both. The chat parses "take the train / BART / public transit" and "drive instead" on the fast path, and Claude's `update_filter` tool gains `commute_mode`.
Alternatives considered: Google transit on demand (cost, 100-element cap, no storage); OpenTripPlanner as a live server (can't run on Vercel); park-and-ride access by car (closer to how many suburban commuters reach BART, but more modeling; possible follow-up).
Consequences: Times are door-to-door from area centers with walking only, so suburbs far from stations look slower than a drive-to-BART commute (e.g. Antioch's center is 2.9 km from its BART station; Antioch to the Financial District comes out just over 2 hours). Spot checks: Oakland 94612 → Financial District 94105, 30 min; Mission 94110 → 94105, 25 min. With a 45-minute max from 1 Market St, 15 areas pass in transit mode against 80 driving. The matrix must be recomputed when timetables change (re-run fetch, compute and load).

## D049: Pair cards in a random order with random sides
Date: 2026.10.19
Status: accepted (refines D027)
Context: The owner noticed some options were shown more than others. The six cards already cover every pair of the four priorities (4 choose 2 = 6, each priority in exactly 3 cards), but they always came in the same order with the same sides. Affordability filled the first three cards and was always on the left, and hidden risks was always on the right. Anyone who skipped partway mostly answered affordability questions, and left/right position can bias a choice.
Decision: `shuffledDeck()` deals the six cards with a Fisher-Yates shuffle (all 720 orders equally likely) and puts each card's options on random sides (50/50). It runs only in the browser, after hydration (`useSyncExternalStore`), so server and browser HTML match. The cards stay hidden until then so the unshuffled order never flashes. "Redo the questions" deals a fresh deck. Answers are stored with their card and the next card is the first unanswered pair, so scoring (`prioritiesFromAnswers`, same 2 × (wins + 1) mapping) doesn't depend on order. A seeded test deals 60,000 decks and checks each card lands in each position about 1/6 of the time and each option is on the left about half the time.
Alternatives considered: more cards, e.g. both orders of each pair or repeats (asks the same question twice and adds no information); a fixed balanced order (still the same for everyone, and "first card" bias stays on one pair).
Consequences: Two people see the cards in different orders; slider results for the same answers are identical.
