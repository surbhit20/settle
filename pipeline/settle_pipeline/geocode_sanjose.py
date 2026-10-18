"""Step 8: geocode San Jose call addresses with the free US Census batch geocoder.

No key, no credits; at most 10,000 addresses per batch (decisions.md D032). Up to three passes:
each pass sends only the addresses still unmatched, trying the next candidate from
sanjose.block_candidates(). Every batch's input and output is cached under
data/raw/crime/sanjose/geocode/; cached batches are skipped, so re-running is free.

Output: street_to_latlng.json, mapping each raw ADDRESS to [lat, lng] or null.

Run: uv run --project pipeline python -m settle_pipeline.geocode_sanjose
"""

import csv
import glob
import io
import json

import httpx
import pandas as pd

from settle_pipeline.fetch_crime import CRIME_DIR
from settle_pipeline.sanjose import block_candidates, parse_census_batch, select_incidents

CENSUS_BATCH_URL = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch"
BATCH_SIZE = 10_000
PASSES = 3
GEO_DIR = CRIME_DIR / "sanjose" / "geocode"
LOOKUP_FILE = GEO_DIR / "street_to_latlng.json"


def load_calls() -> pd.DataFrame:
    files = sorted(glob.glob(str(CRIME_DIR / "sanjose" / "calls_*.csv")))
    return pd.concat([pd.read_csv(f, dtype=str, encoding="utf-8-sig") for f in files], ignore_index=True)


def geocode_batch(client: httpx.Client, name: str, streets: list[str]) -> dict[str, tuple[float, float] | None]:
    out_path = GEO_DIR / f"{name}_out.csv"
    if out_path.exists():
        print(f"  cached   {name}")
    else:
        buf = io.StringIO()
        w = csv.writer(buf)
        for i, street in enumerate(streets):
            w.writerow([i, street, "San Jose", "CA", ""])
        (GEO_DIR / f"{name}_in.csv").write_text(buf.getvalue())
        print(f"  geocoding {name} ({len(streets)} addresses) ...", flush=True)
        resp = client.post(
            CENSUS_BATCH_URL,
            data={"benchmark": "Public_AR_Current"},
            files={"addressFile": (f"{name}.csv", buf.getvalue(), "text/csv")},
        )
        resp.raise_for_status()
        out_path.write_text(resp.text)
    results = parse_census_batch(out_path.read_text())
    return {street: results.get(str(i)) for i, street in enumerate(streets)}


def main() -> None:
    GEO_DIR.mkdir(parents=True, exist_ok=True)
    incidents = select_incidents(load_calls())
    addresses = sorted(a for a in incidents["ADDRESS"].dropna().unique() if block_candidates(a))
    print(f"  {len(incidents)} counted calls; {len(addresses)} distinct block addresses")

    lookup: dict[str, list[float] | None] = {a: None for a in addresses}
    with httpx.Client(timeout=900) as client:
        for p in range(PASSES):
            todo = {}
            for a in addresses:
                cands = block_candidates(a)
                if lookup[a] is None and p < len(cands):
                    todo[a] = cands[p]
            # A later candidate can equal an earlier one; skip streets already tried.
            streets = sorted(set(todo.values()))
            if not streets:
                break
            hits: dict[str, tuple[float, float] | None] = {}
            for b, start in enumerate(range(0, len(streets), BATCH_SIZE)):
                hits.update(geocode_batch(client, f"pass{p}_batch{b:02d}", streets[start : start + BATCH_SIZE]))
            for a, street in todo.items():
                if hits.get(street):
                    lookup[a] = list(hits[street])
            done = sum(v is not None for v in lookup.values())
            print(f"  after pass {p}: {done}/{len(addresses)} addresses matched", flush=True)

    LOOKUP_FILE.write_text(json.dumps(lookup))
    incidents["hit"] = incidents["ADDRESS"].map(lambda a: lookup.get(a) is not None)
    print(f"  calls placed: {incidents['hit'].sum()}/{len(incidents)} ({incidents['hit'].mean():.1%}); wrote {LOOKUP_FILE.name}")


if __name__ == "__main__":
    main()
