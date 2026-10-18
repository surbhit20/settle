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
