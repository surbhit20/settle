"""Pure transforms that turn raw Census files into rows for the `areas` table.

No file or network IO here, so everything is unit tested in tests/test_areas.py.
"""

import math

import geopandas as gpd
import pandas as pd
from shapely.geometry import MultiPolygon, Point
from shapely.geometry.base import BaseGeometry
from shapely.validation import make_valid


def assign_counties(rel: pd.DataFrame, counties: dict[str, str]) -> pd.DataFrame:
    """Pick each ZCTA's county as the one holding the most of its land area.

    `rel` is the Census ZCTA-county relationship file (columns GEOID_ZCTA5_20,
    GEOID_COUNTY_20, AREALAND_PART). Returns columns `zcta`, `county` for the ZCTAs
    whose majority county is in `counties` (FIPS -> name). See decisions.md D009.
    """
    df = rel[["GEOID_ZCTA5_20", "GEOID_COUNTY_20", "AREALAND_PART"]].copy()
    df = df[df["GEOID_ZCTA5_20"].notna() & (df["GEOID_ZCTA5_20"] != "")]
    df["AREALAND_PART"] = df["AREALAND_PART"].astype("int64")
    # Sort by land area (ties broken by FIPS so the result is deterministic), keep the top row per ZCTA.
    df = df.sort_values(["AREALAND_PART", "GEOID_COUNTY_20"], ascending=[False, True])
    top = df.drop_duplicates("GEOID_ZCTA5_20", keep="first")
    top = top[top["GEOID_COUNTY_20"].isin(counties)]
    return pd.DataFrame(
        {
            "zcta": top["GEOID_ZCTA5_20"].to_numpy(),
            "county": top["GEOID_COUNTY_20"].map(counties).to_numpy(),
        }
    ).sort_values("zcta", ignore_index=True)


def parse_acs_population(rows: list[list[str]]) -> pd.DataFrame:
    """Parse the Census API JSON (header row + data rows) into `zcta`, `population`.

    ACS uses large negative sentinels (e.g. -666666666) for "no estimate"; those become
    missing (pandas NA), never zero.
    """
    header, *data = rows
    df = pd.DataFrame(data, columns=header)
    pop = pd.to_numeric(df["B01003_001E"], errors="coerce")
    pop = pop.where(pop >= 0)
    return pd.DataFrame(
        {"zcta": df["zip code tabulation area"], "population": pop.astype("Int64")}
    )


def to_multipolygon(geom: BaseGeometry) -> MultiPolygon:
    """Repair invalid geometry and always return a MultiPolygon (the column type in Postgres)."""
    geom = make_valid(geom)
    if geom.geom_type == "MultiPolygon":
        return geom
    if geom.geom_type == "Polygon":
        return MultiPolygon([geom])
    # make_valid can return a GeometryCollection; keep only its polygon parts.
    polys = []
    for part in getattr(geom, "geoms", []):
        if part.geom_type == "Polygon":
            polys.append(part)
        elif part.geom_type == "MultiPolygon":
            polys.extend(part.geoms)
    if not polys:
        raise ValueError(f"geometry has no polygon parts: {geom.geom_type}")
    return MultiPolygon(polys)


def population_weighted_centroids(zctas: gpd.GeoDataFrame, bg_points: gpd.GeoDataFrame) -> pd.Series:
    """One representative point per ZCTA, weighted by where people actually live.

    `zctas`: columns `zcta`, `geometry` (EPSG:4326).
    `bg_points`: 2020 block group centers of population, columns `population`, `geometry` (EPSG:4326).

    Rules (decisions.md D010):
    1. Weighted mean of the block group centers that fall inside the ZCTA.
    2. If that mean lands outside the ZCTA (e.g. in the bay, for a crescent-shaped area),
       use the populated block group center closest to it instead.
    3. If no populated block group center falls inside, use a point guaranteed to be
       inside the polygon (shapely representative_point).
    Returns a Series of shapely Points indexed by zcta.
    """
    joined = gpd.sjoin(
        bg_points[bg_points["population"] > 0], zctas[["zcta", "geometry"]], predicate="within"
    )
    geom_by_zcta = zctas.set_index("zcta")["geometry"]
    result: dict[str, Point] = {}
    for zcta, polygon in geom_by_zcta.items():
        members = joined[joined["zcta"] == zcta]
        if members.empty:
            result[zcta] = polygon.representative_point()
            continue
        w = members["population"]
        mean = Point((members.geometry.x * w).sum() / w.sum(), (members.geometry.y * w).sum() / w.sum())
        if polygon.contains(mean):
            result[zcta] = mean
        else:
            # Squared distance in degrees, with longitude shrunk by cos(latitude) so east-west
            # and north-south degrees count equally. Good enough for picking the nearest point.
            kx = math.cos(math.radians(mean.y))
            d2 = ((members.geometry.x - mean.x) * kx) ** 2 + (members.geometry.y - mean.y) ** 2
            result[zcta] = members.geometry.loc[d2.idxmin()]
    return pd.Series(result, name="centroid")


UNINCORPORATED = "(unincorporated)"


def name_areas(
    zctas: gpd.GeoDataFrame,
    bg_points: gpd.GeoDataFrame,
    places: gpd.GeoDataFrame,
    centroids: pd.Series,
) -> pd.Series:
    """Label each ZCTA with the Census place (city or CDP) where most of its residents live.

    `zctas`: columns `zcta`, `county`, `geometry`. `bg_points`: as in
    population_weighted_centroids. `places`: columns `NAME`, `geometry`. All EPSG:4326.

    Each populated block group center is tagged with the place containing it (or
    "unincorporated"), population is summed per (ZCTA, place), and the biggest wins.
    ZCTAs with no populated block group fall back to the place containing their centroid.
    Areas whose winner is unincorporated land are labelled "Unincorporated <County>".
    Names repeat (many ZCTAs are "San Jose"), so the UI always shows the ZIP code too.
    """
    place_shapes = places[["NAME", "geometry"]]

    def place_of(points: gpd.GeoDataFrame) -> pd.Series:
        hits = gpd.sjoin(points, place_shapes, predicate="within")
        # A point on a shared boundary can match two places; keep the alphabetically first.
        hits = hits.reset_index().sort_values(["index", "NAME"]).drop_duplicates("index")
        return hits.set_index("index")["NAME"].reindex(points.index).fillna(UNINCORPORATED)

    # 1. Where residents live: block group population summed by (zcta, place).
    in_zcta = gpd.sjoin(
        bg_points[bg_points["population"] > 0], zctas[["zcta", "geometry"]], predicate="within"
    ).drop(columns="index_right")
    in_zcta["place"] = place_of(in_zcta)
    totals = in_zcta.groupby(["zcta", "place"], as_index=False)["population"].sum()
    totals = totals.sort_values(["zcta", "population", "place"], ascending=[True, False, True])
    by_residents = totals.drop_duplicates("zcta").set_index("zcta")["place"]

    # 2. Fallback for unpopulated ZCTAs: the place containing the centroid.
    centroid_points = gpd.GeoDataFrame(geometry=list(centroids.to_numpy()), index=centroids.index, crs="EPSG:4326")
    by_centroid = place_of(centroid_points)

    names = by_residents.reindex(centroids.index).fillna(by_centroid)
    county = zctas.set_index("zcta")["county"].reindex(centroids.index)
    names = names.where(names != UNINCORPORATED, "Unincorporated " + county)
    return names.rename("name")
