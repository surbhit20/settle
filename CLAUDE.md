# Settle (working title): Where Should I Live?

A web app that answers one question for someone moving to a new area: **"Given my salary, my office, and what I care about, which neighborhoods should I live in?"** The answer is a ranked heat map of neighborhoods, with a card per area explaining why it scored the way it did, every number linked to its source.

This file is the project brief and the standing instructions for Claude Code. Read it fully before writing any code.


## 1. Standing rules for Claude Code (always follow)

### 1.1 Keep `decisions.md` updated
Maintain a file `decisions.md` at the repo root. Every time you make a non trivial choice while writing code (a library, a data source, a schema shape, a scoring formula, a tradeoff, a workaround, dropping a feature), append an entry **in the same change** as the code. Never rewrite or delete old entries; if a decision is reversed, add a new entry that supersedes the old one and reference it.

Entry format:

```
## D007: Use ZIP codes (ZCTA) as the area unit for v1
Date: YYYY.MM.DD
Status: accepted | superseded by D0XX
Context: why a decision was needed
Decision: what we chose
Alternatives considered: what else, and why not
Consequences: what this makes easier or harder, follow ups
```

### 1.2 Keep `flow.md` updated
Maintain a file `flow.md` at the repo root describing **how the code actually executes**, end to end. It must always match the current code. Update it in the same change whenever you add, remove, or reorder a step, a route, a module, or a data pipeline stage.

It must cover at least:
* **Data pipeline flow:** each script, in run order, with its inputs, outputs, and which tables or files it writes.
* **Request flow:** what happens from the moment a user submits the form or types a message, through each function, API route, external call, and database query, until the map updates.
* **Agent flow:** how a chat message goes through the Jev router, when it falls back to the LLM, and what structured action comes out.
* **Module map:** one line per important file saying what it owns.

Use numbered steps and file paths (for example `app/api/score/route.ts → lib/scoring/score.ts`). A simple text diagram or Mermaid diagram is welcome.

### 1.3 Other rules
* The owner is strong in Python but **new to TypeScript and React**. Keep frontend code idiomatic and simple, avoid clever abstractions, and explain any non obvious TS or React pattern in a short comment.
* Never hardcode secrets. All keys come from `.env.local` (see section 8). Commit an `.env.example`.
* **Never call paid or rate limited APIs from tests.** Cache raw API responses to disk in `data/raw/` and build from the cache.
* Scoring logic must be **deterministic and unit tested**. The LLM explains rankings; it never computes them.
* Every metric shown in the UI must carry its source name and link.
* Work milestone by milestone (section 9). At the end of each milestone, summarize what was built, update `decisions.md` and `flow.md`, and stop for review.
* If an external API's docs or limits are unclear, stop and ask instead of guessing.


## 2. Product scope

### v1 (build this first)
* Region: **SF Bay Area**, five counties: San Francisco, San Mateo, Santa Clara, Alameda, Contra Costa.
* Input form: annual salary, office address, max commute minutes, monthly rent budget (optional, otherwise derived from salary), and priority sliders (affordability, commute, safety, hidden risks).
* Output: a heat map of areas colored by personal score, a top 5 list, and a detail card per area.
* Chat box powered by the agent (section 6) for "what if" questions, for example "what if my budget goes up 300" or "why is Milpitas ranked low". The map updates live.
* Hidden risks card per area from Mireye: flood zone, wildfire, earthquake, nearby high hazard dam, nearby hazardous chemical facility.

### v2 (only after v1 ships)
* Two office mode (couples or roommates).
* Transit commute (GTFS for BART, Caltrain, VTA).
* Score a specific listing address.
* Compare 2 or 3 areas side by side.
* Schools and air quality layers.
* Lifestyle layer from OpenStreetMap (groceries, gyms, parks).

### Out of scope
Scraping Zillow, user accounts, payments, mobile app.


## 3. Tech stack
* **App:** Next.js (App Router) with TypeScript and Tailwind.
* **Map:** MapLibre GL JS with free vector tiles; deck.gl only if needed for performance.
* **Database:** Postgres with PostGIS (local Docker for development; Supabase or Neon for deploy).
* **Data pipeline:** Python scripts in `pipeline/` (pandas, geopandas, httpx), run manually, writing into Postgres.
* **Fast classifier:** TypeSafe AI's **Jev** model (owner has an API key; ask the owner for the exact endpoint and request format before integrating).
* **LLM:** Claude via the Anthropic API, for explanations and fallback routing.
* **Tests:** Vitest for TypeScript, pytest for the pipeline.
* **Deploy:** Vercel for the app.


## 4. Data sources

All area level data is **precomputed by the pipeline**. The app only does per user work at request time (geocode office, commute, scoring).

* **Area boundaries:** US Census TIGER ZIP Code Tabulation Areas (ZCTA), filtered to the five counties. Area unit for v1 is the ZCTA.
* **Population:** Census ACS 5 year estimates per ZCTA (needed for crime per capita).
* **Rent and home values:** Zillow Research public CSVs (ZORI for rent, ZHVI for home value) by ZIP. Include a 3 year trend. Zillow's own API is not available to individuals; do not use it.
* **Live listings (v2):** RentCast API, free tier is about 50 requests per month, so cache aggressively.
* **Crime:** city open data portals with incident level coordinates: San Francisco, Oakland, San Jose (verify each dataset's fields and licensing first; record findings in `decisions.md`). Aggregate per ZCTA per 1,000 residents, last 12 months. Areas without city data get `null` and a "no data" label, never a fake zero. The FBI API is city level only, so use it only as a fallback.
* **Hidden risks and extras:** **Mireye API** (`https://api.mireye.com`, Bearer token).
  * Free catalog (no auth): `GET /v1/meta/fields`. Call it first and confirm field names.
  * Use `POST /v1/fetch/batch` (up to 25 locations per call) at each area's population weighted centroid.
  * Candidate fields: `within_floodplain_polygon`, `wildfire_annual_frequency`, `seismic_design_category`, `seismic_pga_2pct_50yr_g`, `landslide_susceptibility_index`, `nearest_dam_distance_m`, `nearest_dam_hazard_potential`, `high_hazard_dams_within_10km`, `nearest_hazardous_facility_distance_m`, `nearest_hazardous_facility_name`, `fiber_provider_count`, `days_above_32c_annual_count`, `nearest_airport_distance_m`, `nearest_major_road_distance_m`.
  * Free tier is 5,000 credits per month and 20 requests per minute; 1 credit per field per location. Budget the full fetch before running it and log the expected credit cost. **Never request parcel fields** (300 credits each).
  * Read each field's `status`, `confidence`, and `partial_failures`; store source and source URL with every value.
* **Office geocoding:** Mireye `POST /v1/geocode` (1 credit); reject `centroid` accuracy.
* **Commute:** OpenRouteService matrix API, office to all area centroids in one call. Cache by office coordinate rounded to 3 decimals. Check current free tier limits and record them in `decisions.md`.


## 5. Scoring (deterministic, in `lib/scoring/`)

1. **Hard filters:** drop areas where commute exceeds the user's max, or median rent exceeds budget by more than 15%.
2. **Sub scores, each 0 to 100:**
   * Affordability: based on median rent as a share of monthly gross income; 30% or less scores high, falling steeply after 40%.
   * Commute: shorter is better, scaled between 0 minutes and the user's max.
   * Safety: percentile of crime rate per 1,000 residents across the region, inverted.
   * Hidden risks: start at 100, subtract fixed penalties per flag (flood zone, high wildfire frequency, seismic category D or above, high hazard dam within 10 km, hazardous facility within 1 km). Penalties live in one config object.
3. **Final score:** weighted average of sub scores using the user's priority sliders. Missing data does not count as zero; reweight across available sub scores and mark the area "partial data".
4. Return each area's final score, sub scores, the raw inputs behind them, and their sources, so the UI and the agent can explain exactly why.

All weights, thresholds and penalties live in `lib/scoring/config.ts`. Unit test edge cases: missing crime data, zero salary, commute ties, everything filtered out.


## 6. Agent design

The scoring math is instant. The slow and expensive part is language, so Jev sits in front as a router.

1. User message goes to **Jev**, which classifies it into one intent:
   * `update_filter` (budget, max commute, salary)
   * `set_priority` (care more or less about safety, commute, etc.)
   * `compare` (two or more named areas)
   * `explain` (why is X ranked where it is)
   * `area_info` (tell me about X)
   * `other`
2. For `update_filter`, `set_priority`, and `compare`: extract parameters, apply them, rescore, and update the map **with no LLM call**.
3. For `explain`, `area_info`, `other`, or when Jev's confidence is below a threshold (start at 0.7, record the choice in `decisions.md`): call Claude with tools that emit the same structured actions, plus the area's score breakdown as grounding context. Claude must only state numbers present in that context and must cite sources.
4. Log every routed message with intent, confidence, route taken, and latency to a local table, so we can later report real numbers (share of messages handled without the LLM, median latency per route). Do not invent these numbers anywhere.

Jev is also used in the pipeline to classify raw crime incident descriptions into `violent`, `property`, or `minor`, so safety scores are comparable across cities with different labels. Cache classifications by description string.


## 7. Data model (starting point; refine and record changes in `decisions.md`)

* `areas`: zcta, name, county, geometry (MultiPolygon), centroid (Point), population
* `area_metrics`: zcta, metric_name, value, unit, source, source_url, fetched_at, confidence, status
* `crime_aggregates`: zcta, period, violent_count, property_count, minor_count, rate_per_1000
* `commute_cache`: office_key, zcta, minutes, mode, fetched_at
* `agent_logs`: id, message, intent, confidence, route, latency_ms, created_at


## 8. Environment variables (`.env.example`)

```
DATABASE_URL=
MIREYE_API_TOKEN=
CENSUS_API_KEY=
FBI_API_KEY=
ORS_API_KEY=
JEV_API_KEY=
ANTHROPIC_API_KEY=
RENTCAST_API_KEY=
```


## 9. Milestones (stop for review after each)

* **M0, scaffold:** Next.js app, Postgres with PostGIS in Docker, Python pipeline folder, `.env.example`, empty `decisions.md` and `flow.md` with their structure filled in.
* **M1, areas:** load ZCTA boundaries and population for the five counties; render them on the map.
* **M2, rent and Mireye:** load Zillow rent data; run the Mireye batch fetch (log the credit estimate first); show a basic choropleth by rent and a hidden risks card.
* **M3, scoring:** form inputs, office geocode, commute matrix, scoring module with tests, heat map by personal score, top 5 list, detail card with sources.
* **M4, crime:** ingest SF, Oakland, San Jose incidents; Jev classification; per capita aggregates; add the safety sub score.
* **M5, agent:** chat box, Jev router, Claude fallback, live map updates, agent logs.
* **M6, polish and ship:** loading and empty states, mobile layout, source attributions, README with screenshots, deploy to Vercel.


## 10. Definition of done for v1
* A new user can enter salary, office and priorities and see a ranked heat map within a few seconds.
* Every area card shows sub scores, raw values, and source links.
* "What if my budget goes up 300" recolors the map without an LLM call.
* "Why is X ranked low" returns a grounded explanation that uses only real numbers.
* `decisions.md` and `flow.md` accurately describe the shipped code.
