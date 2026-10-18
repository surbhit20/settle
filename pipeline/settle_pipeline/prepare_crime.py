"""Step 9: normalize all cities' police records and assign each located record to a ZCTA.

Reads data/raw/crime/{sf,oakland,sanjose}/ and the San Jose geocode lookup (geocode_sanjose).
Writes data/processed/crime_records.csv.gz (one row per raw record, with `zcta`) and
data/processed/crime_labels.json (distinct (city, label) pairs with record counts, the input
for Jev classification). No network calls.

Run: uv run --project pipeline python -m settle_pipeline.prepare_crime
"""

import glob
import json

import geopandas as gpd
import pandas as pd
from shapely import wkb

from settle_pipeline.config import REPO_ROOT
from settle_pipeline.crime import normalize_oakland, normalize_sanjose, normalize_sf, placement_rates
from settle_pipeline.db import connect
from settle_pipeline.fetch_crime import CRIME_DIR
from settle_pipeline.geocode_sanjose import LOOKUP_FILE, load_calls
from settle_pipeline.sanjose import select_incidents

PROCESSED_DIR = REPO_ROOT / "data" / "processed"
RECORDS_FILE = PROCESSED_DIR / "crime_records.csv.gz"
LABELS_FILE = PROCESSED_DIR / "crime_labels.json"


def read_pages(city: str) -> list[dict]:
    rows: list[dict] = []
    for p in sorted(glob.glob(str(CRIME_DIR / city / "page_*.json"))):
        rows += json.loads(open(p).read())
    return rows


def load_areas() -> gpd.GeoDataFrame:
    with connect() as conn:
        rows = conn.execute("SELECT zcta, ST_AsBinary(geometry) FROM areas").fetchall()
    return gpd.GeoDataFrame(
        {"zcta": [r[0] for r in rows]}, geometry=[wkb.loads(bytes(r[1])) for r in rows], crs="EPSG:4326"
    )


def main() -> None:
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    sj_lookup = json.loads(LOOKUP_FILE.read_text())
    df = pd.concat(
        [
            normalize_sf(read_pages("sf")),
            normalize_oakland(read_pages("oakland")),
            normalize_sanjose(select_incidents(load_calls()), sj_lookup),
        ],
        ignore_index=True,
    )
    print(f"  {len(df)} records, {df.groupby('city')['incident_key'].nunique().to_dict()} distinct incidents")
    print(f"  placement rate (incidents with a location): "
          f"{ {k: round(v, 3) for k, v in placement_rates(df).items()} }")

    located = df[df["lat"].notna() & df["lng"].notna()]
    points = gpd.GeoDataFrame(located, geometry=gpd.points_from_xy(located["lng"], located["lat"]), crs="EPSG:4326")
    joined = gpd.sjoin(points, load_areas(), predicate="within", how="left")
    # A point exactly on a shared boundary can match two areas; keep the first deterministically.
    joined = joined.sort_values("zcta").loc[lambda d: ~d.index.duplicated(keep="first")]
    df["zcta"] = joined["zcta"].reindex(df.index)
    outside = df["lat"].notna() & df["zcta"].isna()
    print(f"  located but outside all 208 areas: {int(outside.sum())} records")

    df.to_csv(RECORDS_FILE, index=False, compression="gzip")
    labels = (
        df.groupby(["city", "label"]).size().reset_index(name="records").sort_values(["city", "records"], ascending=[True, False])
    )
    LABELS_FILE.write_text(json.dumps(labels.to_dict("records"), indent=1))
    print(f"  wrote {RECORDS_FILE.name} and {LABELS_FILE.name} ({len(labels)} distinct labels to classify: "
          f"{labels.groupby('city').size().to_dict()})")
    print(f"  records per zcta (located): {df['zcta'].value_counts().describe()[['count', 'min', '50%', 'max']].round().to_dict()}")


if __name__ == "__main__":
    main()
