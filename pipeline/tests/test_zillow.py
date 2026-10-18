"""Tests for settle_pipeline.zillow: latest value and 3-year change from wide monthly CSVs."""

import math

import pandas as pd
import pytest

from settle_pipeline.zillow import latest_and_change, to_metric_rows


def months(n, start="2022-01"):
    return [d.strftime("%Y-%m-%d") for d in pd.date_range(start, periods=n, freq="ME")]


def frame(rows: dict[str, list[float]], n: int) -> pd.DataFrame:
    cols = months(n)
    data = [{"RegionName": z, **dict(zip(cols, vals))} for z, vals in rows.items()]
    return pd.DataFrame(data, columns=["RegionName", *cols])


def test_latest_and_three_year_change():
    vals = [1000.0] * 36 + [1100.0, 1200.0, 1500.0]  # 39 months; latest is 36 months after 1000
    out = latest_and_change(frame({"94110": vals}, 39), ["94110"]).iloc[0]
    assert out["latest"] == 1500.0
    assert out["change_pct"] == pytest.approx(50.0)
    assert out["as_of"] == months(39)[-1][:7]


def test_falls_back_to_recent_month_and_measures_trend_from_that_month():
    vals = [1000.0] * 37 + [1200.0, math.nan]  # newest month missing
    out = latest_and_change(frame({"94110": vals}, 39), ["94110"]).iloc[0]
    assert out["latest"] == 1200.0
    assert out["as_of"] == months(39)[-2][:7]
    assert out["change_pct"] == pytest.approx(20.0)


def test_stale_value_older_than_three_months_is_no_data():
    vals = [1000.0] * 35 + [math.nan] * 4
    out = latest_and_change(frame({"94110": vals}, 39), ["94110"]).iloc[0]
    assert out["latest"] is None or pd.isna(out["latest"])


def test_short_history_gives_value_but_no_trend():
    out = latest_and_change(frame({"94110": [1000.0] * 12}, 12), ["94110"]).iloc[0]
    assert out["latest"] == 1000.0
    assert out["change_pct"] is None or pd.isna(out["change_pct"])


def test_zip_missing_from_file_and_leading_zero_padding():
    df = frame({"601": [500.0] * 3}, 3)  # Zillow sometimes drops leading zeros
    out = latest_and_change(df, ["00601", "94110"]).set_index("zcta")
    assert out.loc["00601", "latest"] == 500.0
    assert out.loc["94110", "latest"] is None or pd.isna(out.loc["94110", "latest"])


def test_metric_rows_mark_missing_as_no_data_with_source():
    table = latest_and_change(frame({"94110": [1000.0] * 39}, 39), ["94110", "94128"])
    rows = to_metric_rows(table, metric="rent_zori_usd", unit="USD", index_label="ZORI", fetched_at="t")
    by = {(r["zcta"], r["metric_name"]): r for r in rows}
    assert by[("94110", "rent_zori_usd")]["value"] == 1000.0
    assert by[("94110", "rent_zori_usd_3yr_change_pct")]["value"] == 0.0
    missing = by[("94128", "rent_zori_usd")]
    assert missing["value"] is None and missing["status"] == "no_data"
    assert missing["dataset_vintage"] is None  # not "ZORI nan"
    assert all(r["source"] == "Zillow Research (ZORI)" and r["source_url"] for r in rows)
