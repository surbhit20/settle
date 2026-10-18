"""Tests for settle_pipeline.crime_aggregate (synthetic data, no network, no DB)."""

import geopandas as gpd
import pandas as pd
import pytest
from shapely.geometry import Point, box

from settle_pipeline.crime_aggregate import aggregate, city_coverage, incidents_by_class


def gdf(data, geoms):
    return gpd.GeoDataFrame(data, geometry=geoms, crs="EPSG:4326")


def test_city_coverage_is_population_share_inside_the_city():
    zctas = gdf({"zcta": ["A"]}, [box(0, 0, 10, 10)])
    places = gdf({"NAME": ["San Jose", "Campbell"]}, [box(0, 0, 5, 10), box(5, 0, 10, 10)])
    bgs = gdf({"population": [300, 100]}, [Point(1, 1), Point(8, 8)])
    cov = city_coverage(zctas, bgs, places)
    assert cov.to_dict("records") == [{"zcta": "A", "city": "sanjose", "covered_share": 0.75}]


def test_incidents_by_class_keeps_most_severe_class_per_incident():
    records = pd.DataFrame({
        "city": ["oakland", "oakland", "oakland"],
        "incident_key": ["C1", "C1", "C2"],
        "label": ["VANDALISM", "ROBBERY", "PARKING"],
        "zcta": ["94601", None, "94601"],  # C1's second row has no location
    })
    classes = {("oakland", "VANDALISM"): "property", ("oakland", "ROBBERY"): "violent", ("oakland", "PARKING"): "minor"}
    out = incidents_by_class(records, classes).set_index("incident_key")
    assert out.loc["C1", "class"] == "violent"
    assert out.loc["C1", "zcta"] == "94601"  # area taken from the located row
    assert out.loc["C2", "class"] == "minor"


def test_incidents_by_class_drops_unclassified_labels():
    records = pd.DataFrame({"city": ["sf"], "incident_key": ["1"], "label": ["UNKNOWN"], "zcta": ["94110"]})
    assert incidents_by_class(records, {}).empty


def incidents(rows):
    return pd.DataFrame(rows, columns=["city", "incident_key", "class", "zcta"])


def test_rate_counts_violent_and_property_only_and_uses_covered_population():
    inc = incidents([
        ("sf", "1", "violent", "94110"), ("sf", "2", "property", "94110"),
        ("sf", "3", "property", "94110"), ("sf", "4", "minor", "94110"),
    ])
    cov = pd.DataFrame({"zcta": ["94110"], "city": ["sf"], "covered_share": [1.0]})
    out = aggregate(inc, cov, {"94110": 2000}, {"sf": 1.0}).iloc[0]
    assert (out.violent_count, out.property_count, out.minor_count) == (1, 2, 1)
    assert out.rate_per_1000 == pytest.approx(3 / 2000 * 1000)


def test_rate_is_scaled_by_city_placement():
    inc = incidents([("sanjose", str(i), "property", "95112") for i in range(10)])
    cov = pd.DataFrame({"zcta": ["95112"], "city": ["sanjose"], "covered_share": [1.0]})
    out = aggregate(inc, cov, {"95112": 10_000}, {"sanjose": 1 / 0.5}).iloc[0]
    assert out.property_count == 10  # raw count stays raw
    assert out.rate_per_1000 == pytest.approx(20 / 10_000 * 1000)


def test_partial_coverage_divides_by_residents_inside_the_city():
    inc = incidents([("sanjose", str(i), "violent", "95008") for i in range(6)])
    cov = pd.DataFrame({"zcta": ["95008"], "city": ["sanjose"], "covered_share": [0.6]})
    out = aggregate(inc, cov, {"95008": 10_000}, {"sanjose": 1.0}).iloc[0]
    assert out.covered_population == 6000
    assert out.rate_per_1000 == pytest.approx(1.0)


def test_no_rate_when_mostly_outside_covered_cities_or_too_few_residents():
    inc = incidents([("sf", "1", "violent", "94014"), ("sf", "2", "violent", "94128")])
    cov = pd.DataFrame({"zcta": ["94014", "94128"], "city": ["sf", "sf"], "covered_share": [0.3, 1.0]})
    out = aggregate(inc, cov, {"94014": 50_000, "94128": 0}, {"sf": 1.0}).set_index("zcta")
    assert out.loc["94014", "rate_per_1000"] is None or pd.isna(out.loc["94014", "rate_per_1000"])
    assert out.loc["94128", "rate_per_1000"] is None or pd.isna(out.loc["94128", "rate_per_1000"])


def test_area_with_coverage_but_zero_incidents_gets_a_real_zero_rate():
    cov = pd.DataFrame({"zcta": ["94105"], "city": ["sf"], "covered_share": [1.0]})
    out = aggregate(incidents([]), cov, {"94105": 5000}, {"sf": 1.0}).iloc[0]
    assert out.rate_per_1000 == 0.0  # data exists and shows none: a true zero, not missing
