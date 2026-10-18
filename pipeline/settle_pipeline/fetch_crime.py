"""Step 7: download 12 months of police data for SF, Oakland and San Jose into data/raw/crime/.

Free public portals, no keys (decisions.md D031). Files already on disk are skipped.
Window: WINDOW_START (inclusive) to WINDOW_END (exclusive), the latest 12 complete months
given Oakland's ~90-day processing lag.

Run: uv run --project pipeline python -m settle_pipeline.fetch_crime [--city sf|oakland|sanjose]
"""

import argparse
import json

import httpx

from settle_pipeline.config import RAW_DIR

CRIME_DIR = RAW_DIR / "crime"
WINDOW_START = "2025-07-01T00:00:00"
WINDOW_END = "2026-07-01T00:00:00"
PERIOD = "2025-07_2026-06"  # label stored in crime_aggregates.period
PAGE = 50_000  # Socrata rows per request

SOCRATA = {
    "sf": {
        "url": "https://data.sf.gov/resource/wg3w-h783.json",
        "select": "incident_id,incident_datetime,report_type_description,incident_category,"
        "incident_subcategory,incident_description,latitude,longitude",
        "date_field": "incident_datetime",
        "order": "incident_datetime,row_id",
    },
    "oakland": {
        "url": "https://data.oaklandca.gov/resource/ppgh-7dqv.json",
        "select": "casenumber,datetime,crimetype,description,policebeat,location",
        "date_field": "datetime",
        "order": "datetime,casenumber,description",
    },
}

# San Jose quarterly CSVs covering the window (resource ids from the CKAN package, D031).
SAN_JOSE_RESOURCES = {
    "2025Q3": "8c309149-eeea-42bf-a61c-7b1606e4dd01",
    "2025Q4": "19f028fc-aee6-4b8a-a851-6de7c3e44316",
    "2026Q1": "fa5b544d-7e8d-4059-bbef-afc4f2ee5811",
    "2026Q2": "f4905056-8c9d-401a-9c7b-467cc33f0488",
}
SAN_JOSE_PACKAGE = "https://data.sanjoseca.gov/api/3/action/package_show?id=police-calls-for-service-quarterly"


def fetch_socrata(client: httpx.Client, city: str) -> None:
    cfg = SOCRATA[city]
    out_dir = CRIME_DIR / city
    out_dir.mkdir(parents=True, exist_ok=True)
    where = f"{cfg['date_field']} >= '{WINDOW_START}' AND {cfg['date_field']} < '{WINDOW_END}'"
    offset, page = 0, 0
    while True:
        path = out_dir / f"page_{page:03d}.json"
        if path.exists():
            rows = json.loads(path.read_text())
            print(f"  cached   {city}/{path.name} ({len(rows)} rows)")
        else:
            resp = client.get(cfg["url"], params={
                "$select": cfg["select"], "$where": where, "$order": cfg["order"],
                "$limit": PAGE, "$offset": offset,
            })
            resp.raise_for_status()
            rows = resp.json()
            path.write_text(json.dumps(rows))
            print(f"  saved    {city}/{path.name} ({len(rows)} rows)", flush=True)
        if len(rows) < PAGE:
            break
        offset += PAGE
        page += 1


def fetch_san_jose(client: httpx.Client) -> None:
    out_dir = CRIME_DIR / "sanjose"
    out_dir.mkdir(parents=True, exist_ok=True)
    package = client.get(SAN_JOSE_PACKAGE).json()["result"]
    urls = {r["id"]: r["url"] for r in package["resources"]}
    for quarter, rid in SAN_JOSE_RESOURCES.items():
        path = out_dir / f"calls_{quarter}.csv"
        if path.exists():
            print(f"  cached   sanjose/{path.name}")
            continue
        with client.stream("GET", urls[rid]) as resp:
            resp.raise_for_status()
            tmp = path.with_suffix(".part")
            with open(tmp, "wb") as f:
                for chunk in resp.iter_bytes():
                    f.write(chunk)
            tmp.rename(path)
        print(f"  saved    sanjose/{path.name}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--city", choices=["sf", "oakland", "sanjose"])
    args = parser.parse_args()
    cities = [args.city] if args.city else ["sf", "oakland", "sanjose"]
    with httpx.Client(timeout=300, follow_redirects=True) as client:
        for city in cities:
            fetch_san_jose(client) if city == "sanjose" else fetch_socrata(client, city)
    print("done")


if __name__ == "__main__":
    main()
