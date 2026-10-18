"""Step 1: download Census boundary, relationship, and population files into data/raw/census/.

Files that already exist are skipped, so re-running is free. Delete a file to force a re-download.

Run: uv run --project pipeline python -m settle_pipeline.fetch_census
"""

import json

import httpx

from settle_pipeline.config import RAW_DIR, require_env

CENSUS_DIR = RAW_DIR / "census"

# ACS 5-year vintage used for population. 2024 = the 2020-2024 estimates (released Dec 2025).
ACS_YEAR = 2024

# Keyless static downloads from census.gov. Names are the files written under CENSUS_DIR.
DOWNLOADS: dict[str, str] = {
    # 2020 ZCTA cartographic boundaries, generalized 1:500k, clipped to shoreline (~67 MB, national).
    "cb_2020_us_zcta520_500k.zip": "https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip",
    # ZCTA-to-county relationship file: land area of each ZCTA/county overlap (~7 MB, national).
    "tab20_zcta520_county20_natl.txt": "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt",
    # 2020 block group centers of population for California (~1 MB). Used for pop-weighted centroids.
    "CenPop2020_Mean_BG06.txt": "https://www2.census.gov/geo/docs/reference/cenpop2020/blkgrp/CenPop2020_Mean_BG06.txt",
    # 2020 California places (cities and CDPs), used to give each ZCTA a human-readable name (~1.5 MB).
    "cb_2020_06_place_500k.zip": "https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_06_place_500k.zip",
}

ACS_FILE = f"acs5_{ACS_YEAR}_B01003_zcta.json"
ACS_URL = f"https://api.census.gov/data/{ACS_YEAR}/acs/acs5"


def download(client: httpx.Client, url: str, dest_name: str) -> None:
    dest = CENSUS_DIR / dest_name
    if dest.exists():
        print(f"  cached   {dest_name}")
        return
    print(f"  fetching {dest_name} ...")
    tmp = dest.with_suffix(dest.suffix + ".part")
    with client.stream("GET", url) as resp:
        resp.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in resp.iter_bytes():
                f.write(chunk)
    tmp.rename(dest)  # only a complete download ever gets the real name


def fetch_acs_population(client: httpx.Client) -> None:
    """Total population (B01003_001E) for every ZCTA in the US. One request, ~33k rows."""
    dest = CENSUS_DIR / ACS_FILE
    if dest.exists():
        print(f"  cached   {ACS_FILE}")
        return
    print(f"  fetching {ACS_FILE} ...")
    resp = client.get(
        ACS_URL,
        params={
            "get": "B01003_001E",
            "for": "zip code tabulation area:*",
            "key": require_env("CENSUS_API_KEY"),
        },
    )
    resp.raise_for_status()
    rows = resp.json()  # raises if Census returned an HTML error page instead of JSON
    dest.write_text(json.dumps(rows))


def main() -> None:
    CENSUS_DIR.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=120, follow_redirects=False) as client:
        for name, url in DOWNLOADS.items():
            download(client, url, name)
        fetch_acs_population(client)
    print("done")


if __name__ == "__main__":
    main()
