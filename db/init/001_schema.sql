-- Initial schema (CLAUDE.md section 7). Runs automatically on first `docker compose up`.
-- Geometries are stored in WGS84 (EPSG:4326), the CRS MapLibre and GeoJSON use.

CREATE EXTENSION IF NOT EXISTS postgis;

-- One row per ZIP Code Tabulation Area in the five counties.
CREATE TABLE IF NOT EXISTS areas (
    zcta        TEXT PRIMARY KEY,                        -- 5-digit ZCTA code, kept as text to preserve leading zeros
    name        TEXT,                                    -- human label, e.g. "Mission District" or city name
    county      TEXT NOT NULL,
    geometry    geometry(MultiPolygon, 4326) NOT NULL,
    centroid    geometry(Point, 4326),                   -- population-weighted where available
    population  INTEGER                                  -- ACS 5-year estimate; NULL if unknown
);
CREATE INDEX IF NOT EXISTS areas_geometry_gix ON areas USING GIST (geometry);

-- Long/narrow table: one row per (area, metric). Every value carries its source.
CREATE TABLE IF NOT EXISTS area_metrics (
    zcta         TEXT NOT NULL REFERENCES areas (zcta) ON DELETE CASCADE,
    metric_name  TEXT NOT NULL,                          -- e.g. 'median_rent_zori', 'within_floodplain_polygon'
    value        DOUBLE PRECISION,                       -- numeric value; NULL when missing
    value_text   TEXT,                                   -- for non-numeric values (category names, facility names)
    unit         TEXT,
    source       TEXT NOT NULL,
    source_url   TEXT NOT NULL,
    fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    confidence   DOUBLE PRECISION,
    status       TEXT,                                   -- e.g. Mireye field status
    PRIMARY KEY (zcta, metric_name)
);

CREATE TABLE IF NOT EXISTS crime_aggregates (
    zcta            TEXT NOT NULL REFERENCES areas (zcta) ON DELETE CASCADE,
    period          TEXT NOT NULL,                       -- e.g. '2025-10_2026-09' (last 12 months)
    violent_count   INTEGER NOT NULL,
    property_count  INTEGER NOT NULL,
    minor_count     INTEGER NOT NULL,
    rate_per_1000   DOUBLE PRECISION,                    -- NULL when population is unknown
    PRIMARY KEY (zcta, period)
);

-- Office-to-area travel times, keyed by office coordinate rounded to 3 decimals.
CREATE TABLE IF NOT EXISTS commute_cache (
    office_key  TEXT NOT NULL,                           -- e.g. '37.790,-122.401'
    zcta        TEXT NOT NULL REFERENCES areas (zcta) ON DELETE CASCADE,
    minutes     DOUBLE PRECISION,                        -- NULL if unroutable
    mode        TEXT NOT NULL,                           -- 'driving-car' for v1
    fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (office_key, zcta, mode)
);

CREATE TABLE IF NOT EXISTS agent_logs (
    id          BIGSERIAL PRIMARY KEY,
    message     TEXT NOT NULL,
    intent      TEXT,
    confidence  DOUBLE PRECISION,
    route       TEXT NOT NULL,                           -- 'jev' or 'llm'
    latency_ms  INTEGER NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
