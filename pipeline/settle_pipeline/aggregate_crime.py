"""Step 13: turn classified crime records into per-area rates in `crime_aggregates`.

Inputs (all local): data/processed/crime_records.csv.gz, crime_classes.json, the Census block
group and place files, and `areas`. Replaces all rows for this PERIOD. Areas whose rate can't be
published (mostly outside covered cities, or < 1,000 covered residents) get no row, which the
app reads as "no data" (D032).

Run: uv run --project pipeline python -m settle_pipeline.aggregate_crime
"""

import json

import geopandas as gpd
import pandas as pd

from settle_pipeline.classify_crime import CLASSES_FILE
from settle_pipeline.crime import placement_rates
from settle_pipeline.crime_aggregate import aggregate, city_coverage, incidents_by_class
from settle_pipeline.db import connect
from settle_pipeline.fetch_census import CENSUS_DIR
from settle_pipeline.fetch_crime import PERIOD
from settle_pipeline.prepare_crime import RECORDS_FILE, load_areas


def main() -> None:
    records = pd.read_csv(RECORDS_FILE, dtype={"incident_key": str, "zcta": str})
    raw = json.loads(CLASSES_FILE.read_text())
    classes = {tuple(k.split("|", 1)): v["class"] for k, v in raw.items()}
    pending = {tuple(k.split("|", 1)) for k, v in raw.items() if v.get("source") == "pending_claude"}

    scale = {city: 1 / rate for city, rate in placement_rates(records).items()}
    print(f"  placement scale: { {k: round(v, 3) for k, v in scale.items()} }")

    areas = load_areas()
    bg = pd.read_csv(CENSUS_DIR / "CenPop2020_Mean_BG06.txt", dtype=str, encoding="utf-8-sig")
    bg_points = gpd.GeoDataFrame(
        {"population": bg["POPULATION"].astype(int)},
        geometry=gpd.points_from_xy(bg["LONGITUDE"].astype(float), bg["LATITUDE"].astype(float)),
        crs="EPSG:4269",
    ).to_crs("EPSG:4326")
    places = gpd.read_file(CENSUS_DIR / "cb_2020_06_place_500k.zip").to_crs("EPSG:4326")
    coverage = city_coverage(areas, bg_points, places)

    with connect() as conn:
        population = dict(conn.execute("SELECT zcta, population FROM areas").fetchall())

    incidents = incidents_by_class(records, classes)
    table = aggregate(incidents, coverage, population, scale)
    cities = coverage.groupby("zcta")["city"].apply(lambda s: ",".join(sorted(s)))
    table["cities"] = table["zcta"].map(cities)
    # An area is provisional if any of its records carries a label still waiting for Claude.
    rec_pending = records[[(c, l) in pending for c, l in zip(records["city"], records["label"])]]
    provisional = set(rec_pending["zcta"].dropna())
    table["classification_status"] = ["provisional" if z in provisional else "final" for z in table["zcta"]]
    published = table[table["rate_per_1000"].notna()]

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM crime_aggregates WHERE period = %s", (PERIOD,))
            cur.executemany(
                """INSERT INTO crime_aggregates (zcta, period, violent_count, property_count, minor_count,
                       rate_per_1000, cities, covered_share, covered_population, classification_status)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                [(r.zcta, PERIOD, int(r.violent_count), int(r.property_count), int(r.minor_count),
                  float(r.rate_per_1000), r.cities, float(r.covered_share), int(r.covered_population),
                  r.classification_status) for r in published.itertuples()],
            )
    print(f"  {len(table)} areas with covered residents; {len(published)} rates published "
          f"({(published['classification_status'] == 'provisional').sum()} provisional)")
    print(published.groupby("cities")["rate_per_1000"].describe()[["count", "min", "50%", "max"]].round(1).to_string())
    print("done")


if __name__ == "__main__":
    main()
