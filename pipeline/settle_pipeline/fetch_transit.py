"""Step 11a: download what the transit router needs (decisions.md D048).

1. Regional GTFS timetable feed for every Bay Area operator, from 511.org Open Data
   (GET https://api.511.org/transit/datafeeds?api_key=...&operator_id=RG). Needs TRANSIT_511_API_KEY.
   License: 511 Data Disseminator Agreement (store, derive and display allowed; credit
   "data provided by 511.org" with a link next to the data). Rate limit 60 requests/hour; this
   script makes one request, and only when the file isn't cached.
2. OpenStreetMap for Northern California from Geofabrik (~620 MB), cropped with osmium-tool to a
   box around our five counties so the router fits in memory. The full download is deleted after
   cropping; the crop is kept.

Outputs (data/raw/transit/, git-ignored):
  gtfs_regional.zip     the 511 regional GTFS feed
  bayarea.osm.pbf       OSM street and path network around the five counties

Run: uv run --project pipeline python -m settle_pipeline.fetch_transit
"""

import shutil
import subprocess
import zipfile

import httpx

from settle_pipeline.config import RAW_DIR, require_env

TRANSIT_DIR = RAW_DIR / "transit"
GTFS_FILE = TRANSIT_DIR / "gtfs_regional.zip"
OSM_FULL = TRANSIT_DIR / "norcal-latest.osm.pbf"
OSM_CROP = TRANSIT_DIR / "bayarea.osm.pbf"

GTFS_URL = "https://api.511.org/transit/datafeeds"
OSM_URL = "https://download.geofabrik.de/north-america/us/california/norcal-latest.osm.pbf"

# Our 208 areas span lon -122.52..-121.37, lat 36.89..38.06 (ST_Extent of areas.geometry).
# Padded ~5 km so walks to stations just outside an area's edge still route.
BBOX = (-122.58, 36.85, -121.30, 38.11)  # west, south, east, north


def download(client: httpx.Client, url: str, dest, params: dict | None = None) -> None:
    """Stream a large file to disk, writing to a .part file first so a failed run isn't cached."""
    part = dest.with_suffix(dest.suffix + ".part")
    with client.stream("GET", url, params=params, follow_redirects=True) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        done = 0
        with open(part, "wb") as f:
            for chunk in r.iter_bytes(1 << 20):
                f.write(chunk)
                done += len(chunk)
                if total and done % (50 << 20) < (1 << 20):
                    print(f"    {done >> 20} / {total >> 20} MB")
    part.rename(dest)


def main() -> None:
    TRANSIT_DIR.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=httpx.Timeout(60, read=300)) as client:
        if GTFS_FILE.exists():
            print(f"  cached: {GTFS_FILE.name}")
        else:
            print("  downloading 511 regional GTFS (1 request)...")
            download(client, GTFS_URL, GTFS_FILE, {"api_key": require_env("TRANSIT_511_API_KEY"), "operator_id": "RG"})
        with zipfile.ZipFile(GTFS_FILE) as z:  # fails loudly if 511 sent an error page instead
            print(f"  GTFS ok: {len(z.namelist())} files, e.g. {sorted(z.namelist())[:6]}")

        if OSM_CROP.exists():
            print(f"  cached: {OSM_CROP.name}")
        else:
            if not OSM_FULL.exists():
                print("  downloading Geofabrik Northern California OSM (~620 MB)...")
                download(client, OSM_URL, OSM_FULL)
            if not shutil.which("osmium"):
                raise RuntimeError("osmium-tool is not installed (brew install osmium-tool).")
            west, south, east, north = BBOX
            print("  cropping to the five counties...")
            subprocess.run(
                ["osmium", "extract", "--bbox", f"{west},{south},{east},{north}", "--strategy", "complete_ways",
                 "--overwrite", "-o", str(OSM_CROP), str(OSM_FULL)],
                check=True,
            )
            OSM_FULL.unlink()  # 620 MB we no longer need
    print(f"  done: {GTFS_FILE.stat().st_size >> 20} MB GTFS, {OSM_CROP.stat().st_size >> 20} MB OSM")


if __name__ == "__main__":
    main()
