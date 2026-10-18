"""Step 10: fetch FBI city-level crime counts for every agency that polices one of our areas.

FBI Crime Data Explorer API (api.usa.gov/crime/fbi/cde), free api.data.gov key in FBI_API_KEY.
Endpoints (confirmed 2026.10.18, decisions.md D033):
  GET /agency/byStateAbbr/CA                                     -> agencies by county, with ORI
  GET /summarized/agency/{ori}/{violent-crime|property-crime}?from=07-2025&to=06-2026
Rate limit header: x-ratelimit-limit 10 (per-second window; it did not decrease across calls
spaced ~1 s apart), so requests are spaced 1.1 s apart and the script stops on any 429.
Each response is cached in data/raw/fbi/; cached files are skipped.

Run: uv run --project pipeline python -m settle_pipeline.fetch_fbi
"""

import json
import time

import httpx

from settle_pipeline.config import RAW_DIR, require_env
from settle_pipeline.db import connect
from settle_pipeline.fbi import agency_for_area

BASE = "https://api.usa.gov/crime/fbi/cde"
FBI_DIR = RAW_DIR / "fbi"
AGENCIES_FILE = FBI_DIR / "agencies_CA.json"
OUR_COUNTIES = ["SAN FRANCISCO", "SAN MATEO", "SANTA CLARA", "ALAMEDA", "CONTRA COSTA"]
OFFENSES = ["violent-crime", "property-crime"]
FROM, TO = "07-2025", "06-2026"  # same window as the city crime data (D031)
SECONDS_BETWEEN = 1.1


def bay_agencies() -> list[dict]:
    data = json.loads(AGENCIES_FILE.read_text())
    return [a for c in OUR_COUNTIES for a in data.get(c, [])]


def area_agencies() -> dict[str, tuple[dict | None, str]]:
    agencies = bay_agencies()
    with connect() as conn:
        rows = conn.execute("SELECT zcta, name, county FROM areas ORDER BY zcta").fetchall()
    return {z: agency_for_area(name, county, agencies) for z, name, county in rows}


def response_path(ori: str, offense: str):
    return FBI_DIR / f"summarized_{ori}_{offense}_{FROM}_{TO}.json"


def main() -> None:
    FBI_DIR.mkdir(parents=True, exist_ok=True)
    key = require_env("FBI_API_KEY")
    with httpx.Client(base_url=BASE, timeout=60) as client:
        if not AGENCIES_FILE.exists():
            r = client.get("/agency/byStateAbbr/CA", params={"API_KEY": key})
            r.raise_for_status()
            AGENCIES_FILE.write_text(r.text)

        mapping = area_agencies()
        oris = sorted({a["ori"] for a, _ in mapping.values() if a})
        missing = [z for z, (a, _) in mapping.items() if a is None]
        print(f"  {len(mapping)} areas -> {len(oris)} agencies; unmapped areas: {missing}")
        todo = [(o, off) for o in oris for off in OFFENSES if not response_path(o, off).exists()]
        print(f"  {len(todo)} requests to make ({len(oris) * len(OFFENSES) - len(todo)} cached)")
        for i, (ori, offense) in enumerate(todo):
            if i:
                time.sleep(SECONDS_BETWEEN)
            r = client.get(f"/summarized/agency/{ori}/{offense}", params={"from": FROM, "to": TO, "API_KEY": key})
            if r.status_code == 429:
                raise SystemExit(f"rate limited after {i} requests; re-run later (cached responses are kept)")
            r.raise_for_status()
            response_path(ori, offense).write_text(r.text)
            if i % 20 == 0:
                print(f"  {i + 1}/{len(todo)} (remaining header: {r.headers.get('x-ratelimit-remaining')})", flush=True)
    print("done")


if __name__ == "__main__":
    main()
