"""Step 14: load HUD Small Area FMR rents by home size into `area_metrics` (decisions.md D038).

Downloads data/raw/hud/FY27_safmrs.xlsx once (free, public; HUD's site wants a browser-like
User-Agent), then reads only that file.

Run: uv run --project pipeline python -m settle_pipeline.load_hud
"""

import datetime as dt

import httpx
import pandas as pd

from settle_pipeline.config import RAW_DIR
from settle_pipeline.db import connect
from settle_pipeline.hud import normalize, pick_rows, to_metric_rows
from settle_pipeline.metrics import upsert_metrics

HUD_URL = "https://www.huduser.gov/portal/datasets/fmr/fmr2027/FY27_safmrs.xlsx"
HUD_FILE = RAW_DIR / "hud" / "FY27_safmrs.xlsx"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"


def main() -> None:
    HUD_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not HUD_FILE.exists():
        r = httpx.get(HUD_URL, headers={"User-Agent": UA}, timeout=120, follow_redirects=True)
        r.raise_for_status()
        HUD_FILE.write_bytes(r.content)
    hud = normalize(pd.read_excel(HUD_FILE, dtype=str))
    with connect() as conn:
        areas = pd.DataFrame(conn.execute("SELECT zcta, county FROM areas").fetchall(), columns=["zcta", "county"])
    picked = pick_rows(hud, areas)
    fetched_at = dt.datetime.fromtimestamp(HUD_FILE.stat().st_mtime, dt.timezone.utc).isoformat()
    rows = to_metric_rows(picked, fetched_at)
    missing = picked["0br"].isna().sum()
    print(f"  {len(picked)} areas; {missing} without HUD rents")
    print(picked[["0br", "1br", "2br", "3br", "4br"]].describe().loc[["min", "50%", "max"]].round().to_string())
    upsert_metrics(rows)
    print("done")


if __name__ == "__main__":
    main()
