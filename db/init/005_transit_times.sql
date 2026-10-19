-- Public-transit times between areas (decisions.md D048): typical weekday morning, from each
-- area's population-weighted center to every other area's, computed offline by
-- pipeline/settle_pipeline/compute_transit.py from 511.org GTFS + OpenStreetMap.
-- On an existing DB apply once:  docker exec -i settle-db psql -U settle < db/init/005_transit_times.sql

CREATE TABLE IF NOT EXISTS transit_times (
    from_zcta     TEXT NOT NULL REFERENCES areas (zcta) ON DELETE CASCADE,   -- where you live
    to_zcta       TEXT NOT NULL REFERENCES areas (zcta) ON DELETE CASCADE,   -- the area your office is in
    minutes       DOUBLE PRECISION,             -- median over the departure window; NULL = no route within 2 h
    intrazonal    BOOLEAN NOT NULL DEFAULT FALSE, -- same area: estimated, not routed
    service_date  DATE NOT NULL,                -- the timetable day routed (a typical Tuesday)
    time_window   TEXT NOT NULL,                -- e.g. '07:30+90min'
    computed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (from_zcta, to_zcta)
);

-- The app looks up every area's time to one office area.
CREATE INDEX IF NOT EXISTS transit_times_to ON transit_times (to_zcta);
