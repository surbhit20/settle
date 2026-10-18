"""Tests for settle_pipeline.fbi (no network, no DB)."""

import pytest

from settle_pipeline.fbi import agency_for_area, summarize

AGENCIES = [
    {"ori": "CA0010300", "agency_name": "Berkeley Police Department", "agency_type_name": "City", "counties": "ALAMEDA"},
    {"ori": "CA0010000", "agency_name": "Alameda County Sheriff's Office", "agency_type_name": "County", "counties": "ALAMEDA"},
    {"ori": "CA0410000", "agency_name": "San Mateo County Sheriff's Office", "agency_type_name": "County", "counties": "SAN MATEO"},
    {"ori": "CA0019700", "agency_name": "University of California: Berkeley", "agency_type_name": "University or College", "counties": "ALAMEDA"},
]


def test_city_with_its_own_police_department():
    agency, reason = agency_for_area("Berkeley", "Alameda", AGENCIES)
    assert agency["ori"] == "CA0010300" and reason == "city police department"


def test_unincorporated_town_and_contract_city_use_the_county_sheriff():
    assert agency_for_area("Castro Valley", "Alameda", AGENCIES)[0]["ori"] == "CA0010000"
    assert agency_for_area("Millbrae", "San Mateo", AGENCIES)[0]["ori"] == "CA0410000"
    assert agency_for_area("Unincorporated San Mateo", "San Mateo", AGENCIES)[0]["ori"] == "CA0410000"


def test_university_police_are_not_matched_as_a_city():
    agency, _ = agency_for_area("University of California: Berkeley", "Alameda", AGENCIES)
    assert agency["ori"] == "CA0010000"  # falls back to the sheriff, not the campus agency


def test_no_agency_when_county_has_no_sheriff_listed():
    assert agency_for_area("Nowhere", "Marin", AGENCIES) == (None, "no matching agency")


def response(actuals, population=100_000, state_rate=30.0, months=12):
    keys = [f"{m:02d}-2026" for m in range(1, months + 1)]
    return {
        "offenses": {
            "actuals": {"Test PD Offenses": dict(zip(keys, actuals))},
            "rates": {"California Offenses": {k: state_rate for k in keys}},
        },
        "populations": {"population": {"Test PD": {k: population for k in keys}}},
    }


def test_summarize_twelve_months():
    s = summarize(response([10] * 12), "Test PD")
    assert s == {
        "offenses": 120,
        "months_reported": 12,
        "population": 100_000,
        "rate_per_1000": 1.2,
        "state_rate_per_1000": 3.6,  # 30 per 100k per month x 12 / 100
    }


def test_summarize_annualizes_partial_reporting():
    s = summarize(response([10] * 6, months=6), "Test PD")
    assert s["months_reported"] == 6
    assert s["offenses"] == 120  # 60 reported x 12/6
    assert s["rate_per_1000"] == pytest.approx(1.2)


def test_summarize_with_no_data_is_none_not_zero():
    s = summarize({"offenses": {"actuals": {}, "rates": {}}, "populations": {}}, "Test PD")
    assert s["rate_per_1000"] is None and s["offenses"] is None and s["months_reported"] == 0
