"""Step 11c: load the transit matrix into `transit_times` (D048).

Input:  data/raw/transit/matrix_weekday_am.csv (from compute_transit)
Output: transit_times rows, replacing any previous run. Same-area trips get the standard
        "half the time to the nearest other area" estimate (transit.fill_intrazonal), flagged
        intrazonal = true.

Run: uv run --project pipeline python -m settle_pipeline.load_transit
"""

import csv

from settle_pipeline.compute_transit import MATRIX_FILE
from settle_pipeline.db import connect
from settle_pipeline.transit import clean_minutes, fill_intrazonal


def main() -> None:
    if not MATRIX_FILE.exists():
        raise RuntimeError("Run settle_pipeline.compute_transit first.")
    with open(MATRIX_FILE, newline="") as f:
        rows = list(csv.DictReader(f))
    service_date, window = rows[0]["service_date"], rows[0]["window"]
    times = {(r["from_zcta"], r["to_zcta"]): clean_minutes(r["minutes"]) for r in rows}
    zones = sorted({a for a, _ in times} | {b for _, b in times})
    times = fill_intrazonal(times, zones)

    with connect() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM transit_times")
        cur.executemany(
            "INSERT INTO transit_times (from_zcta, to_zcta, minutes, intrazonal, service_date, time_window)"
            " VALUES (%s, %s, %s, %s, %s, %s)",
            [(a, b, t, a == b, service_date, window) for (a, b), t in sorted(times.items())],
        )
    reachable = sum(t is not None for t in times.values())
    print(f"  loaded {len(times)} pairs ({reachable} with a route) for {service_date} {window}")


if __name__ == "__main__":
    main()
