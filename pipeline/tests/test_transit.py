import datetime as dt

import pytest

from settle_pipeline.transit import clean_minutes, feed_service_range, fill_blank_stop_names, fill_intrazonal, pick_weekday

CALENDAR = """service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date
A,1,1,1,1,1,0,0,20260901,20261231
B,0,0,0,0,0,1,1,20260815,20270131
"""


def test_feed_service_range_spans_all_services():
    assert feed_service_range(CALENDAR) == (dt.date(2026, 8, 15), dt.date(2027, 1, 31))


def test_pick_weekday_is_a_tuesday_a_week_out():
    d = pick_weekday(dt.date(2026, 8, 15), dt.date(2027, 1, 31), today=dt.date(2026, 10, 19))
    assert d.weekday() == 1  # Tuesday
    assert d >= dt.date(2026, 10, 26)
    assert d == dt.date(2026, 10, 27)


def test_pick_weekday_skips_holidays():
    # Christmas 2029 and New Year's Day 2030 both fall on a Tuesday.
    d = pick_weekday(dt.date(2029, 12, 1), dt.date(2030, 1, 31), today=dt.date(2029, 12, 18))
    assert d != dt.date(2029, 12, 25)
    assert d == dt.date(2030, 1, 8)  # 2030-01-01 (New Year) is skipped too


def test_pick_weekday_fails_when_feed_has_no_future_tuesday():
    with pytest.raises(ValueError):
        pick_weekday(dt.date(2026, 1, 1), dt.date(2026, 1, 5), today=dt.date(2026, 10, 19))


def test_fill_intrazonal_uses_half_the_nearest_other_area():
    times = {("A", "A"): 0.0, ("A", "B"): 30.0, ("A", "C"): 50.0, ("B", "B"): 0.0, ("B", "A"): 34.0, ("C", "C"): 0.0, ("C", "A"): None}
    out = fill_intrazonal(times, ["A", "B", "C"])
    assert out[("A", "A")] == 15.0
    assert out[("B", "B")] == 17.0
    assert out[("C", "C")] is None  # reaches nothing else: unknown, not zero
    assert out[("A", "B")] == 30.0  # other pairs untouched


def test_clean_minutes_turns_nan_and_blank_into_none():
    assert clean_minutes("42") == 42.0
    assert clean_minutes("") is None
    assert clean_minutes(float("nan")) is None
    assert clean_minutes(None) is None


def test_fill_blank_stop_names_only_touches_unnamed_nodes():
    stops = (
        "stop_id,stop_name,location_type\n"
        "A,Powell St,1\n"
        "n1,,3\n"
        "b1, ,4\n"
        "s9,,0\n"
    )
    out, filled = fill_blank_stop_names(stops)
    assert filled == 2
    assert out.splitlines() == ["stop_id,stop_name,location_type", "A,Powell St,1", "n1,n1,3", "b1,b1,4", "s9,,0"]
