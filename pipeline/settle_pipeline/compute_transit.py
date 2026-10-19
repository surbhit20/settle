"""Step 11b: typical weekday-morning public-transit times between all 208 areas (D048).

Inputs:  data/raw/transit/gtfs_regional.zip (511.org), data/raw/transit/bayarea.osm.pbf, areas.centroid
Output:  data/raw/transit/matrix_weekday_am.csv  (from_zcta, to_zcta, minutes, service_date, window)

Router: r5py (Conveyal R5) with transit + walking, from each area's population-weighted center to
every other. Departures every minute from 7:30 to 9:00 on a typical Tuesday in the feed's service
range; the reported time is the median over that window, so one lucky or unlucky connection doesn't
decide it. Trips longer than 2 hours count as "no transit route". Needs Java 21: JAVA_HOME
defaults to Homebrew's openjdk@21.

This is CPU- and memory-heavy (several minutes on a laptop). The output is cached: delete the CSV
to recompute.

Run: uv run --project pipeline python -m settle_pipeline.compute_transit
"""

import datetime as dt
import os
import sys
import zipfile

JAVA_HOME_DEFAULT = "/opt/homebrew/opt/openjdk@21"
if not os.environ.get("JAVA_HOME") and os.path.isdir(JAVA_HOME_DEFAULT):
    os.environ["JAVA_HOME"] = JAVA_HOME_DEFAULT
# r5py reads its JVM memory cap from the command line; keep headroom on an 8 GB machine.
if "--max-memory" not in sys.argv:
    sys.argv += ["--max-memory", "5G"]

import geopandas as gpd  # noqa: E402
import pandas as pd  # noqa: E402
from shapely import wkb  # noqa: E402

from settle_pipeline.db import connect  # noqa: E402
from settle_pipeline.fetch_transit import GTFS_FILE, OSM_CROP, TRANSIT_DIR  # noqa: E402
from settle_pipeline.transit import feed_service_range, pick_weekday, write_r5_ready_gtfs  # noqa: E402

MATRIX_FILE = TRANSIT_DIR / "matrix_weekday_am.csv"
GTFS_R5 = TRANSIT_DIR / "gtfs_regional_r5.zip"  # the 511 feed with blank pathway-node names filled
DEPART_AT = dt.time(7, 30)
WINDOW = dt.timedelta(minutes=90)
MAX_TIME = dt.timedelta(hours=2)
WALK_KMH = 4.8  # typical adult walking speed (r5py's default 3.6 is slow)


def centroids() -> gpd.GeoDataFrame:
    with connect() as conn:
        rows = conn.execute("SELECT zcta, ST_AsBinary(centroid) FROM areas ORDER BY zcta").fetchall()
    return gpd.GeoDataFrame(
        {"id": [z for z, _ in rows]}, geometry=[wkb.loads(bytes(b)) for _, b in rows], crs="EPSG:4326"
    )


def main() -> None:
    if MATRIX_FILE.exists():
        print(f"  cached: {MATRIX_FILE.name} (delete it to recompute)")
        return
    for f in (GTFS_FILE, OSM_CROP):
        if not f.exists():
            raise RuntimeError(f"Missing {f.name}: run settle_pipeline.fetch_transit first.")

    with zipfile.ZipFile(GTFS_FILE) as z:
        start, end = feed_service_range(z.read("calendar.txt").decode("utf-8-sig"))
    day = pick_weekday(start, end, dt.date.today())
    departure = dt.datetime.combine(day, DEPART_AT)
    print(f"  feed service {start} to {end}; routing {day:%a %Y-%m-%d} {DEPART_AT:%H:%M} + {WINDOW}")

    if not GTFS_R5.exists():
        filled = write_r5_ready_gtfs(GTFS_FILE, GTFS_R5)
        print(f"  {GTFS_R5.name}: named {filled} station pathway nodes that had blank names (R5 requires one)")

    import r5py  # imported late: starts the JVM

    points = centroids()
    print(f"  building the network from {OSM_CROP.name} + {GTFS_R5.name} (a few minutes)...")
    network = r5py.TransportNetwork(OSM_CROP, [GTFS_R5])
    print(f"  routing {len(points)} x {len(points)} trips...")
    matrix = r5py.TravelTimeMatrix(
        network,
        origins=points,
        destinations=points,
        departure=departure,
        departure_time_window=WINDOW,
        percentiles=[50],
        transport_modes=[r5py.TransportMode.TRANSIT, r5py.TransportMode.WALK],
        max_time=MAX_TIME,
        speed_walking=WALK_KMH,
        snap_to_network=True,  # some centers fall in parks or on water edges
    )
    out = pd.DataFrame(
        {
            "from_zcta": matrix["from_id"],
            "to_zcta": matrix["to_id"],
            "minutes": matrix["travel_time"],
            "service_date": day.isoformat(),
            "window": f"{DEPART_AT:%H:%M}+{int(WINDOW.total_seconds() // 60)}min",
        }
    )
    out.to_csv(MATRIX_FILE, index=False)
    reachable = out["minutes"].notna().sum()
    print(f"  wrote {MATRIX_FILE.name}: {len(out)} pairs, {reachable} reachable within {MAX_TIME}")


if __name__ == "__main__":
    main()
