"""Step 2: build the `areas` table from the cached Census files.

Reads only data/raw/census/ (run fetch_census first). Upserts every in-region ZCTA and
removes rows for ZCTAs no longer in the region. If the ACS population file is missing,
population is loaded as NULL with a warning.

Run: uv run --project pipeline python -m settle_pipeline.load_areas
"""

import json

import geopandas as gpd
import pandas as pd

from settle_pipeline.areas import (
    assign_counties,
    name_areas,
    parse_acs_population,
    population_weighted_centroids,
    to_multipolygon,
)
from settle_pipeline.config import COUNTIES
from settle_pipeline.db import connect
from settle_pipeline.fetch_census import ACS_FILE, CENSUS_DIR


def build_areas() -> gpd.GeoDataFrame:
    rel = pd.read_csv(
        CENSUS_DIR / "tab20_zcta520_county20_natl.txt", sep="|", dtype=str, encoding="utf-8-sig"
    )
    region = assign_counties(rel, COUNTIES)
    print(f"  {len(region)} ZCTAs have most of their land in the five counties")

    shapes = gpd.read_file(CENSUS_DIR / "cb_2020_us_zcta520_500k.zip")
    shapes = shapes.rename(columns={"ZCTA5CE20": "zcta"})[["zcta", "geometry"]]
    shapes = shapes[shapes["zcta"].isin(region["zcta"])].to_crs("EPSG:4326")
    shapes["geometry"] = shapes["geometry"].apply(to_multipolygon)
    missing_shapes = set(region["zcta"]) - set(shapes["zcta"])
    if missing_shapes:
        print(f"  WARNING: no boundary for {sorted(missing_shapes)}; skipping them")

    areas = shapes.merge(region, on="zcta").sort_values("zcta", ignore_index=True)

    bg = pd.read_csv(CENSUS_DIR / "CenPop2020_Mean_BG06.txt", dtype=str, encoding="utf-8-sig")
    bg_points = gpd.GeoDataFrame(
        {"population": bg["POPULATION"].astype(int)},
        geometry=gpd.points_from_xy(bg["LONGITUDE"].astype(float), bg["LATITUDE"].astype(float)),
        crs="EPSG:4269",  # Census coordinates are NAD83
    ).to_crs("EPSG:4326")
    centroids = population_weighted_centroids(areas, bg_points)
    areas["centroid"] = areas["zcta"].map(centroids)

    places = gpd.read_file(CENSUS_DIR / "cb_2020_06_place_500k.zip").to_crs("EPSG:4326")
    areas["name"] = areas["zcta"].map(name_areas(areas, bg_points, places, centroids))

    acs_path = CENSUS_DIR / ACS_FILE
    if acs_path.exists():
        pop = parse_acs_population(json.loads(acs_path.read_text()))
        areas = areas.merge(pop, on="zcta", how="left")
    else:
        print(f"  WARNING: {ACS_FILE} not found (needs CENSUS_API_KEY); population will be NULL")
        areas["population"] = pd.Series([pd.NA] * len(areas), dtype="Int64")
    return areas


UPSERT_SQL = """
INSERT INTO areas (zcta, name, county, geometry, centroid, population)
VALUES (%s, %s, %s, ST_GeomFromWKB(%s, 4326), ST_GeomFromWKB(%s, 4326), %s)
ON CONFLICT (zcta) DO UPDATE SET
    name = EXCLUDED.name,
    county = EXCLUDED.county,
    geometry = EXCLUDED.geometry,
    centroid = EXCLUDED.centroid,
    population = EXCLUDED.population
"""


def write_areas(areas: gpd.GeoDataFrame) -> None:
    rows = [
        (
            r.zcta,
            r.name,
            r.county,
            r.geometry.wkb,
            r.centroid.wkb,
            None if pd.isna(r.population) else int(r.population),
        )
        for r in areas.itertuples()
    ]
    with connect() as conn:  # one transaction: commits on success, rolls back on error
        with conn.cursor() as cur:
            cur.executemany(UPSERT_SQL, rows)
            cur.execute("DELETE FROM areas WHERE NOT (zcta = ANY(%s))", (list(areas["zcta"]),))
            print(f"  upserted {len(rows)} areas, removed {cur.rowcount} stale")


def main() -> None:
    areas = build_areas()
    missing_pop = int(areas["population"].isna().sum())
    print(f"  population missing for {missing_pop} of {len(areas)} areas")
    print(areas.groupby("county").size().to_string())
    write_areas(areas)
    print("done")


if __name__ == "__main__":
    main()
