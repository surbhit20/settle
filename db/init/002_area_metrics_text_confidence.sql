-- M2 (decisions.md D017): Mireye reports confidence as a label ('high' | 'medium' | 'low' | 'unknown'),
-- and every value carries a free-text note and a dataset vintage worth showing in the UI.
-- Runs after 001 on a fresh volume. On an existing DB apply it once by hand:
--   docker exec -i settle-db psql -U settle < db/init/002_area_metrics_text_confidence.sql

ALTER TABLE area_metrics ALTER COLUMN confidence TYPE TEXT USING confidence::TEXT;
ALTER TABLE area_metrics ADD COLUMN IF NOT EXISTS notes TEXT;            -- e.g. 'no RMP-registered facility within 10 km'
ALTER TABLE area_metrics ADD COLUMN IF NOT EXISTS dataset_vintage TEXT;  -- e.g. 'ASCE 7-22', 'ZORI 2026-09'
