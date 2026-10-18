"""Tests for settle_pipeline.mireye: parsing cached batch responses (no network, no DB)."""

import pytest

from settle_pipeline.mireye import field_to_row, merge_rows, parse_batch_record


def field(value, status="ok", **kw):
    return {
        "value": value,
        "unit": kw.get("unit"),
        "source": kw.get("source", "FEMA_NFHL"),
        "source_url": "https://example.gov",
        "confidence": kw.get("confidence", "high"),
        "fetched_at": "2026-10-18T16:42:00+00:00",
        "dataset_vintage": "v1",
        "notes": kw.get("notes"),
        "status": status,
    }


def record(zctas, results):
    return {"zctas": zctas, "fetched_at": "2026-10-18T16:42:00Z", "response": {"results": results}}


def test_bool_becomes_number_and_text():
    row = field_to_row("94110", "within_floodplain_polygon", field(True))
    assert (row["value"], row["value_text"]) == (1.0, "true")
    row = field_to_row("94110", "within_floodplain_polygon", field(False))
    assert (row["value"], row["value_text"]) == (0.0, "false")


def test_numbers_and_strings_go_to_the_right_column():
    assert field_to_row("1", "x", field(8))["value"] == 8.0
    row = field_to_row("1", "seismic_design_category", field("E"))
    assert (row["value"], row["value_text"]) == (None, "E")


def test_keeps_status_notes_and_source_with_mireye_prefix():
    row = field_to_row("1", "nearest_hazardous_facility_distance_m",
                       field(None, status="absent", notes="no facility within 10 km", source="EPA_FRS_RMP"))
    assert row["status"] == "absent"
    assert row["notes"] == "no facility within 10 km"
    assert row["source"] == "Mireye / EPA_FRS_RMP"
    assert row["source_url"] == "https://example.gov"
    assert row["value"] is None


def test_results_are_matched_by_index_not_list_order():
    rec = record(["A", "B"], [
        {"index": 1, "ok": True, "fetched_at": "t", "fields": {"f": field(2)}},
        {"index": 0, "ok": True, "fetched_at": "t", "fields": {"f": field(1)}},
    ])
    rows = parse_batch_record(rec, ["f"])
    assert {r["zcta"]: r["value"] for r in rows} == {"A": 1.0, "B": 2.0}


def test_failed_location_yields_failed_rows_for_every_field():
    rec = record(["A"], [{"index": 0, "ok": False, "error": {"code": "outside_coverage"}}])
    rows = parse_batch_record(rec, ["f", "g"])
    assert [(r["metric_name"], r["status"]) for r in rows] == [("f", "failed"), ("g", "failed")]
    assert "outside_coverage" in rows[0]["notes"]


def test_field_missing_from_response_is_marked_missing():
    rec = record(["A"], [{"index": 0, "ok": True, "fetched_at": "t", "fields": {}}])
    assert parse_batch_record(rec, ["f"])[0]["status"] == "missing"


def test_result_count_mismatch_raises():
    with pytest.raises(ValueError):
        parse_batch_record(record(["A", "B"], [{"index": 0, "ok": True, "fetched_at": "t", "fields": {}}]), ["f"])


def test_merge_rows_successful_retry_replaces_failure_but_failed_retry_does_not_hide_success():
    ok = field_to_row("A", "f", field(5))
    failed = field_to_row("A", "f", field(None, status="failed"))
    assert merge_rows([failed], [ok])[0]["value"] == 5.0
    assert merge_rows([ok], [failed])[0]["value"] == 5.0
