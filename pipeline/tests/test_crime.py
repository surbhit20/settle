"""Tests for crime normalization and San Jose call handling (no network, no DB)."""

import math

import pandas as pd
import pytest

from settle_pipeline.crime import normalize_oakland, normalize_sanjose, normalize_sf, placement_rates
from settle_pipeline.sanjose import (
    block_candidates,
    block_to_street,
    expand_suffix,
    parse_census_batch,
    select_incidents,
)


# --- San Jose addresses ------------------------------------------------------------------

def test_block_to_street_uses_midpoint():
    assert block_to_street("[300]-[400] TRADEWINDS DR ") == "350 TRADEWINDS DR"
    assert block_to_street("[0]-[100] MAIN ST") == "50 MAIN ST"


def test_intersections_and_junk_are_not_geocodable():
    assert block_to_street("ALVIN AV & BURDETTE DR") is None
    assert block_to_street("test") is None
    assert block_to_street(None) is None
    assert block_candidates("[400]-[300] BACKWARDS ST") == []


def test_candidates_try_expanded_suffix_then_low_end():
    assert block_candidates("[300]-[400] TRADEWINDS WY") == [
        "350 TRADEWINDS WY", "350 TRADEWINDS WAY", "301 TRADEWINDS WAY",
    ]
    # No suffix to expand: the duplicate is dropped, order kept.
    assert block_candidates("[100]-[200] SEAREEL PL") == ["150 SEAREEL PL", "101 SEAREEL PL"]


def test_expand_suffix_only_touches_the_last_word():
    assert expand_suffix("AV OF THE STARS AV") == "AV OF THE STARS AVE"
    assert expand_suffix("MAIN ST") == "MAIN ST"


def test_select_incidents_dedupes_and_keeps_only_counted_dispositions():
    calls = pd.DataFrame({
        "EID": ["1", "1", "2", "3", "4"],
        "FINAL_DISPO": ["Report taken", "Report taken", "Canceled", "Arrest Made", "No report required; dispatch record only"],
        "ADDRESS": ["[100]-[200] A ST", "[100]-[200] A ST", "[1]-[2] B ST", "C ST & D ST", "[0]-[100] E ST"],
    })
    out = select_incidents(calls)
    assert out["EID"].tolist() == ["1", "3"]
    assert out["street"].iloc[0] == "150 A ST"
    assert pd.isna(out["street"].iloc[1])  # intersection: not geocodable


def test_parse_census_batch():
    text = (
        '"0","150 A ST, San Jose, CA, ","Match","Exact","150 A ST, SAN JOSE, CA, 95112","-121.88,37.33","123","L"\n'
        '"1","999 NOWHERE, San Jose, CA, ","No_Match"\n'
    )
    assert parse_census_batch(text) == {"0": (37.33, -121.88), "1": None}


# --- Normalization -----------------------------------------------------------------------

def test_normalize_sf_cleans_labels_and_parses_coordinates():
    df = normalize_sf([
        {"incident_id": 7, "incident_datetime": "2025-08-01T10:00:00", "incident_description": "  theft,  from vehicle ",
         "latitude": "37.75", "longitude": "-122.41"},
        {"incident_id": 8, "incident_datetime": "2025-08-01T11:00:00", "incident_description": "Battery"},
    ])
    assert df["label"].tolist() == ["THEFT, FROM VEHICLE", "BATTERY"]
    assert df.loc[0, "lat"] == 37.75 and math.isnan(df.loc[1, "lat"])
    assert (df["city"] == "sf").all() and df["incident_key"].tolist() == ["7", "8"]


def test_normalize_oakland_reads_socrata_points_and_rejects_zero_coordinates():
    df = normalize_oakland([
        {"casenumber": "A1", "datetime": "2025-09-01T00:00:00", "description": "robbery",
         "location": {"type": "Point", "coordinates": [-122.27, 37.80]}},
        {"casenumber": "A2", "datetime": "2025-09-01T00:00:00", "description": "x",
         "location": {"type": "Point", "coordinates": [0, 0]}},
        {"casenumber": "A3", "datetime": "2025-09-01T00:00:00", "description": "y"},
    ])
    assert (df.loc[0, "lat"], df.loc[0, "lng"]) == (37.80, -122.27)
    assert math.isnan(df.loc[1, "lat"]) and math.isnan(df.loc[2, "lat"])


def test_normalize_sanjose_uses_lookup_by_raw_address():
    inc = pd.DataFrame({"EID": ["9"], "OFFENSE_DATE": ["2025-10-01"], "CALL_TYPE": ["theft"],
                        "ADDRESS": ["[100]-[200] A ST"]})
    df = normalize_sanjose(inc, {"[100]-[200] A ST": [37.3, -121.9]})
    assert df.loc[0, ["lat", "lng"]].tolist() == [37.3, -121.9]
    assert df.loc[0, "label"] == "THEFT"


def test_placement_rate_counts_incidents_not_rows():
    df = pd.DataFrame({
        "city": ["sf", "sf", "sf", "oakland"],
        "incident_key": ["1", "1", "2", "9"],  # incident 1 has one located row and one not
        "lat": [37.7, math.nan, math.nan, 37.8],
        "lng": [-122.4, math.nan, math.nan, -122.2],
    })
    assert placement_rates(df) == pytest.approx({"sf": 0.5, "oakland": 1.0})
