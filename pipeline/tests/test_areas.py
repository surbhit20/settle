"""Unit tests for settle_pipeline.areas using tiny synthetic geometries (no downloads, no DB)."""

import geopandas as gpd
import pandas as pd
import pytest
from shapely.geometry import GeometryCollection, LineString, MultiPolygon, Point, Polygon, box

from settle_pipeline.areas import (
    assign_counties,
    name_areas,
    parse_acs_population,
    population_weighted_centroids,
    to_multipolygon,
)

COUNTIES = {"06075": "San Francisco", "06081": "San Mateo"}


def rel_rows(rows):
    return pd.DataFrame(rows, columns=["GEOID_ZCTA5_20", "GEOID_COUNTY_20", "AREALAND_PART"])


# --- assign_counties -------------------------------------------------------------------

def test_assign_counties_picks_majority_land_county():
    rel = rel_rows([
        ("94000", "06075", "100"),
        ("94000", "06081", "300"),  # majority in San Mateo
        ("94001", "06075", "50"),
    ])
    out = assign_counties(rel, COUNTIES)
    assert out.to_dict("records") == [
        {"zcta": "94000", "county": "San Mateo"},
        {"zcta": "94001", "county": "San Francisco"},
    ]


def test_assign_counties_drops_zcta_mostly_outside_region():
    rel = rel_rows([
        ("94920", "06041", "999"),  # Marin, not in region
        ("94920", "06075", "1"),
    ])
    assert assign_counties(rel, COUNTIES).empty


def test_assign_counties_skips_rows_without_zcta_and_breaks_ties_by_fips():
    rel = rel_rows([
        ("", "06075", "500"),         # county area outside any ZCTA
        (None, "06081", "500"),
        ("94002", "06081", "10"),
        ("94002", "06075", "10"),     # tie -> lower FIPS (06075) wins
    ])
    assert assign_counties(rel, COUNTIES).to_dict("records") == [
        {"zcta": "94002", "county": "San Francisco"}
    ]


# --- parse_acs_population --------------------------------------------------------------

def test_parse_acs_population_turns_sentinels_into_missing_not_zero():
    rows = [
        ["B01003_001E", "zip code tabulation area"],
        ["31000", "94110"],
        ["-666666666", "94128"],
        ["0", "94999"],
    ]
    df = parse_acs_population(rows).set_index("zcta")
    assert df.loc["94110", "population"] == 31000
    assert pd.isna(df.loc["94128", "population"])
    assert df.loc["94999", "population"] == 0  # a real zero stays zero


# --- to_multipolygon -------------------------------------------------------------------

def test_to_multipolygon_wraps_polygon():
    out = to_multipolygon(box(0, 0, 1, 1))
    assert out.geom_type == "MultiPolygon" and len(out.geoms) == 1


def test_to_multipolygon_repairs_bowtie():
    bowtie = Polygon([(0, 0), (1, 1), (1, 0), (0, 1), (0, 0)])  # self-intersecting
    out = to_multipolygon(bowtie)
    assert out.geom_type == "MultiPolygon" and out.is_valid and out.area == pytest.approx(0.5)


def test_to_multipolygon_keeps_only_polygon_parts_of_collection():
    gc = GeometryCollection([box(0, 0, 1, 1), LineString([(5, 5), (6, 6)])])
    out = to_multipolygon(gc)
    assert isinstance(out, MultiPolygon) and out.area == pytest.approx(1)


# --- population_weighted_centroids -----------------------------------------------------

def gdf(data, geoms):
    return gpd.GeoDataFrame(data, geometry=geoms, crs="EPSG:4326")


def test_centroid_is_population_weighted_mean():
    zctas = gdf({"zcta": ["A"]}, [box(0, 0, 10, 10)])
    bgs = gdf({"population": [300, 100]}, [Point(2, 2), Point(6, 6)])
    c = population_weighted_centroids(zctas, bgs)["A"]
    assert (c.x, c.y) == pytest.approx((3, 3))  # (2*300 + 6*100) / 400


def test_centroid_ignores_zero_population_block_groups():
    zctas = gdf({"zcta": ["A"]}, [box(0, 0, 10, 10)])
    bgs = gdf({"population": [100, 0]}, [Point(2, 2), Point(8, 8)])
    c = population_weighted_centroids(zctas, bgs)["A"]
    assert (c.x, c.y) == pytest.approx((2, 2))


def test_centroid_outside_polygon_snaps_to_nearest_populated_point():
    # U shape: the weighted mean of the two arms lands in the empty middle (like a bay).
    u = Polygon([(0, 0), (10, 0), (10, 10), (8, 10), (8, 2), (2, 2), (2, 10), (0, 10)])
    zctas = gdf({"zcta": ["A"]}, [u])
    bgs = gdf({"population": [100, 120]}, [Point(1, 9), Point(9, 9)])
    c = population_weighted_centroids(zctas, bgs)["A"]
    assert u.contains(c)
    assert (c.x, c.y) == (9, 9)  # mean is (5.4, 9); (9, 9) is closer than (1, 9)


def test_centroid_falls_back_to_point_inside_unpopulated_polygon():
    zctas = gdf({"zcta": ["A"]}, [box(0, 0, 1, 1)])
    bgs = gdf({"population": [50]}, [Point(5, 5)])  # outside
    c = population_weighted_centroids(zctas, bgs)["A"]
    assert box(0, 0, 1, 1).contains(c)


# --- name_areas ------------------------------------------------------------------------

def test_name_is_place_where_most_residents_live_not_where_centroid_lands():
    zctas = gdf({"zcta": ["A"], "county": ["Alameda"]}, [box(0, 0, 10, 10)])
    places = gdf({"NAME": ["Oakland", "Piedmont"]}, [box(0, 0, 10, 5), box(0, 5, 10, 10)])
    bgs = gdf({"population": [60, 60, 100]}, [Point(1, 1), Point(2, 2), Point(5, 8)])
    centroids = pd.Series({"A": Point(5, 6)})  # lands in Piedmont
    assert name_areas(zctas, bgs, places, centroids)["A"] == "Oakland"  # 120 vs 100 residents


def test_name_unincorporated_when_most_residents_outside_any_place():
    zctas = gdf({"zcta": ["A"], "county": ["San Mateo"]}, [box(0, 0, 10, 10)])
    places = gdf({"NAME": ["Pacifica"]}, [box(0, 0, 2, 2)])
    bgs = gdf({"population": [10, 500]}, [Point(1, 1), Point(8, 8)])
    centroids = pd.Series({"A": Point(1, 1)})
    assert name_areas(zctas, bgs, places, centroids)["A"] == "Unincorporated San Mateo"


def test_name_unpopulated_area_uses_place_containing_centroid():
    zctas = gdf({"zcta": ["A", "B"], "county": ["San Mateo", "San Mateo"]}, [box(0, 0, 1, 1), box(5, 5, 6, 6)])
    places = gdf({"NAME": ["Burlingame"]}, [box(0, 0, 1, 1)])
    bgs = gdf({"population": [0]}, [Point(0.5, 0.5)])
    centroids = pd.Series({"A": Point(0.5, 0.5), "B": Point(5.5, 5.5)})
    names = name_areas(zctas, bgs, places, centroids)
    assert names["A"] == "Burlingame"
    assert names["B"] == "Unincorporated San Mateo"
