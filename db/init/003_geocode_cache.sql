-- M3 (decisions.md D025): cache office geocodes so each distinct address costs at most one Mireye credit.
-- On an existing DB apply once:  docker exec -i settle-db psql -U settle < db/init/003_geocode_cache.sql

CREATE TABLE IF NOT EXISTS geocode_cache (
    address_key         TEXT PRIMARY KEY,                -- trimmed, lowercased, single-spaced input
    status              TEXT NOT NULL,                   -- 'ok' | 'too_coarse' | 'not_found'
    lat                 DOUBLE PRECISION,
    lng                 DOUBLE PRECISION,
    accuracy_type       TEXT,
    normalized_address  TEXT,
    source              TEXT,
    message             TEXT,                            -- Mireye's explanation when refused
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
