"""Pure transforms from Zillow Research wide CSVs to MetricRow dicts (tested in tests/test_zillow.py).

Zillow files have one row per ZIP and one column per month-end date ('2026-09-30').
For each ZIP we report:
- the latest value, taken from the newest month that has data, looking back at most
  MAX_STALENESS_MONTHS from the file's newest month (older is treated as no data), and
- the 3-year change: latest value vs the value 36 months before *that same month*.
See decisions.md D018.
"""

import re

import pandas as pd

from settle_pipeline.metrics import MetricRow

MAX_STALENESS_MONTHS = 3
TREND_MONTHS = 36
ZILLOW_RESEARCH_URL = "https://www.zillow.com/research/data/"

DATE_COL = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def latest_and_change(
    df: pd.DataFrame, zctas: list[str]
) -> pd.DataFrame:
    """Columns: zcta, latest, as_of (YYYY-MM), change_pct (None if no value 36 months earlier).

    ZCTAs missing from the file, or with no recent value, get latest = None.
    """
    date_cols = sorted(c for c in df.columns if DATE_COL.match(c))
    zips = df["RegionName"].astype(str).str.zfill(5)
    values = df[date_cols].set_axis(zips, axis=0)
    values = values[~values.index.duplicated()]

    recent = date_cols[-MAX_STALENESS_MONTHS:]
    out = []
    for z in zctas:
        row = {"zcta": z, "latest": None, "as_of": None, "change_pct": None}
        if z in values.index:
            series = values.loc[z]
            for col in reversed(recent):
                if pd.notna(series[col]):
                    row["latest"] = float(series[col])
                    row["as_of"] = col[:7]
                    i = date_cols.index(col) - TREND_MONTHS
                    if i >= 0 and pd.notna(series[date_cols[i]]) and series[date_cols[i]] > 0:
                        then = float(series[date_cols[i]])
                        row["change_pct"] = round((row["latest"] - then) / then * 100, 2)
                    break
        out.append(row)
    return pd.DataFrame(out)


def to_metric_rows(
    table: pd.DataFrame, *, metric: str, unit: str, index_label: str, fetched_at: str
) -> list[MetricRow]:
    """Two metrics per ZCTA: `<metric>` (USD) and `<metric>_3yr_change_pct` (%)."""
    rows: list[MetricRow] = []
    for r in table.itertuples():
        base = {
            "zcta": r.zcta,
            "value_text": None,
            "source": f"Zillow Research ({index_label})",
            "source_url": ZILLOW_RESEARCH_URL,
            "fetched_at": fetched_at,
            "confidence": None,
            # pd.notna, not truthiness: a missing as_of comes back from the DataFrame as NaN, which is truthy.
            "dataset_vintage": f"{index_label} {r.as_of}" if pd.notna(r.as_of) else None,
        }
        has = r.latest is not None and not pd.isna(r.latest)
        rows.append({
            **base, "metric_name": metric, "unit": unit,
            "value": float(r.latest) if has else None,
            "status": "ok" if has else "no_data",
            "notes": None if has else f"no {index_label} value for this ZIP in the last {MAX_STALENESS_MONTHS} months",
        })
        has_change = r.change_pct is not None and not pd.isna(r.change_pct)
        rows.append({
            **base, "metric_name": f"{metric}_3yr_change_pct", "unit": "percent",
            "value": float(r.change_pct) if has_change else None,
            "status": "ok" if has_change else "no_data",
            "notes": None if has_change else f"no {index_label} value {TREND_MONTHS} months before the latest",
        })
    return rows
