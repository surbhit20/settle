"""Shared writer for the long-format `area_metrics` table.

Every loader produces one row per (area, metric), including areas with no data
(value NULL, status 'no_data' or Mireye's own status), so a re-run overwrites stale values.
"""

from typing import TypedDict

from settle_pipeline.db import connect


class MetricRow(TypedDict):
    zcta: str
    metric_name: str
    value: float | None        # numeric values (bools stored as 1.0 / 0.0)
    value_text: str | None     # categorical / names; also 'true'/'false' for bools
    unit: str | None
    source: str
    source_url: str
    fetched_at: str            # ISO 8601
    confidence: str | None     # 'high' | 'medium' | 'low' | 'unknown' | None
    status: str                # 'ok' | 'absent' | 'failed' | 'no_data' | ...
    notes: str | None
    dataset_vintage: str | None


UPSERT_SQL = """
INSERT INTO area_metrics (zcta, metric_name, value, value_text, unit, source, source_url,
                          fetched_at, confidence, status, notes, dataset_vintage)
VALUES (%(zcta)s, %(metric_name)s, %(value)s, %(value_text)s, %(unit)s, %(source)s, %(source_url)s,
        %(fetched_at)s, %(confidence)s, %(status)s, %(notes)s, %(dataset_vintage)s)
ON CONFLICT (zcta, metric_name) DO UPDATE SET
    value = EXCLUDED.value, value_text = EXCLUDED.value_text, unit = EXCLUDED.unit,
    source = EXCLUDED.source, source_url = EXCLUDED.source_url, fetched_at = EXCLUDED.fetched_at,
    confidence = EXCLUDED.confidence, status = EXCLUDED.status, notes = EXCLUDED.notes,
    dataset_vintage = EXCLUDED.dataset_vintage
"""


def upsert_metrics(rows: list[MetricRow]) -> None:
    with connect() as conn:  # one transaction
        with conn.cursor() as cur:
            cur.executemany(UPSERT_SQL, rows)
    print(f"  upserted {len(rows)} metric rows")


def region_zctas() -> list[str]:
    with connect() as conn:
        return [r[0] for r in conn.execute("SELECT zcta FROM areas ORDER BY zcta").fetchall()]
