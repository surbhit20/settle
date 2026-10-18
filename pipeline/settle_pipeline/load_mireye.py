"""Step 5: load cached Mireye responses (batches, then retries) into `area_metrics`.

Reads only data/raw/mireye/; never calls the API.

Run: uv run --project pipeline python -m settle_pipeline.load_mireye
"""

import collections
import json

from settle_pipeline.fetch_mireye import BATCH_DIR, FIELDS, RETRY_DIR
from settle_pipeline.metrics import region_zctas, upsert_metrics
from settle_pipeline.mireye import merge_rows, parse_batch_record


def main() -> None:
    rows = []
    for p in sorted(BATCH_DIR.glob("*.json")):
        rows += parse_batch_record(json.loads(p.read_text()), FIELDS)
    retries = []
    for p in sorted(RETRY_DIR.glob("*.json")):
        rec = json.loads(p.read_text())
        retries += parse_batch_record(rec, rec["request"]["fields"])
    rows = merge_rows(rows, retries)

    region = set(region_zctas())
    covered = {r["zcta"] for r in rows}
    if region - covered:
        print(f"  WARNING: no Mireye data cached for {len(region - covered)} areas: {sorted(region - covered)[:10]}")
    rows = [r for r in rows if r["zcta"] in region]  # areas table is the source of truth

    by_status = collections.Counter((r["metric_name"], r["status"]) for r in rows)
    for name in FIELDS:
        counts = {s: n for (m, s), n in by_status.items() if m == name}
        print(f"  {name:40s} {counts}")
    upsert_metrics(rows)
    print("done")


if __name__ == "__main__":
    main()
