-- M4 (decisions.md D032, D034): record where each area's crime rate comes from and how much of
-- the area it covers, so the UI can cite the right city dataset next to every safety number.
-- On an existing DB apply once:  docker exec -i settle-db psql -U settle < db/init/004_crime_aggregates_sources.sql

ALTER TABLE crime_aggregates ADD COLUMN IF NOT EXISTS cities TEXT;                 -- e.g. 'sf' or 'sanjose'
ALTER TABLE crime_aggregates ADD COLUMN IF NOT EXISTS covered_share DOUBLE PRECISION;    -- residents inside covered cities / all residents
ALTER TABLE crime_aggregates ADD COLUMN IF NOT EXISTS covered_population INTEGER;        -- the rate's denominator
ALTER TABLE crime_aggregates ADD COLUMN IF NOT EXISTS classification_status TEXT;       -- 'final' | 'provisional' (some labels pending Claude)
