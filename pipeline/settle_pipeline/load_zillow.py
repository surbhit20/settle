"""Step 6: load Zillow ZORI (rent) and ZHVI (home value) into `area_metrics`.

Reads only data/raw/zillow/ (run fetch_zillow first). Zillow keys data by USPS ZIP; we join on
the ZCTA code, which matches the ZIP for residential areas (decisions.md D018).

Run: uv run --project pipeline python -m settle_pipeline.load_zillow
"""

import datetime as dt

import pandas as pd

from settle_pipeline.fetch_zillow import ZILLOW_DIR
from settle_pipeline.metrics import region_zctas, upsert_metrics
from settle_pipeline.zillow import latest_and_change, to_metric_rows

SOURCES = [
    # (file, metric name, index label)
    ("Zip_zori_uc_sfrcondomfr_sm_month.csv", "rent_zori_usd", "ZORI"),
    ("Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv", "home_value_zhvi_usd", "ZHVI"),
]


def main() -> None:
    zctas = region_zctas()
    rows = []
    for file, metric, label in SOURCES:
        path = ZILLOW_DIR / file
        df = pd.read_csv(path, dtype={"RegionName": str})
        df = df[df["State"] == "CA"]
        # File modification time = when we downloaded this snapshot.
        fetched_at = dt.datetime.fromtimestamp(path.stat().st_mtime, dt.timezone.utc).isoformat()
        table = latest_and_change(df, zctas)
        have = table["latest"].notna().sum()
        trend = table["change_pct"].notna().sum()
        print(f"  {label}: value for {have}/{len(zctas)} areas, 3-yr trend for {trend}; "
              f"as of {table['as_of'].dropna().max()}")
        rows += to_metric_rows(table, metric=metric, unit="USD", index_label=label, fetched_at=fetched_at)
    upsert_metrics(rows)
    print("done")


if __name__ == "__main__":
    main()
