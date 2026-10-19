"""Pure transform: HUD Small Area Fair Market Rents (FY2027) -> rent by home size per area.

Tested in tests/test_hud.py. Decisions.md D038.

SAFMRs are HUD's rents per ZIP for 0-4 bedrooms: the 40th percentile of gross rent (rent plus
utilities) for standard-quality units. A "room in a shared home" has no official figure, so it
is estimated as a third of the 3-bedroom rent and labeled as an estimate.
"""

import pandas as pd

from settle_pipeline.metrics import MetricRow

SOURCE = "HUD Small Area Fair Market Rents (FY2027)"
SOURCE_URL = "https://www.huduser.gov/portal/datasets/fmr/smallarea/index.html"
VINTAGE = "HUD SAFMR FY2027 (effective 2026-10-01)"

BEDROOMS = ["0br", "1br", "2br", "3br", "4br"]
SHARED_FROM = "3br"  # a room in a shared home = this unit's rent / SHARED_DIVISOR
SHARED_DIVISOR = 3

# A ZIP that straddles two HUD metro areas appears once per area; use the one for the
# area's county (HUD's names for the Bay Area metros, as they appear in the file).
COUNTY_HUD_AREA = {
    "San Francisco": "San Francisco, CA HUD Metro FMR Area",
    "San Mateo": "San Francisco, CA HUD Metro FMR Area",
    "Alameda": "Oakland-Fremont, CA HUD Metro FMR Area",
    "Contra Costa": "Oakland-Fremont, CA HUD Metro FMR Area",
    "Santa Clara": "San Jose-Sunnyvale-Santa Clara, CA HUD Metro FMR Area",
}


def normalize(df: pd.DataFrame) -> pd.DataFrame:
    """Raw HUD sheet -> columns zip, hud_area, 0br..4br (numbers). Drops payment-standard columns."""
    cols = {c: " ".join(str(c).split()) for c in df.columns}  # "SAFMR\n0BR" -> "SAFMR 0BR"
    df = df.rename(columns=cols)
    out = pd.DataFrame({
        "zip": df["ZIP Code"].astype(str).str.strip().str.zfill(5),
        "hud_area": df["HUD Fair Market Rent Area Name"].astype(str).str.strip(),
    })
    for b in BEDROOMS:
        out[b] = pd.to_numeric(df[f"SAFMR {b.upper()}"], errors="coerce")
    return out


def pick_rows(hud: pd.DataFrame, areas: pd.DataFrame) -> pd.DataFrame:
    """One HUD row per area. areas: zcta, county. ZIPs in several HUD areas use the county's metro."""
    merged = areas.merge(hud, left_on="zcta", right_on="zip", how="left")
    merged["preferred"] = merged["hud_area"] == merged["county"].map(COUNTY_HUD_AREA)
    merged = merged.sort_values(["zcta", "preferred"], ascending=[True, False])
    return merged.drop_duplicates("zcta").drop(columns=["zip", "preferred"]).reset_index(drop=True)


def to_metric_rows(picked: pd.DataFrame, fetched_at: str) -> list[MetricRow]:
    """rent_hud_0br..rent_hud_4br, plus rent_shared_room_est (3BR / 3), per area."""
    rows: list[MetricRow] = []
    for rec in picked.to_dict("records"):
        base = {"zcta": rec["zcta"], "unit": "USD", "source": SOURCE, "source_url": SOURCE_URL,
                "fetched_at": fetched_at, "confidence": None, "dataset_vintage": VINTAGE}

        def has(v) -> bool:
            return v is not None and pd.notna(v) and v > 0

        for b in BEDROOMS:
            v = rec.get(b)
            rows.append({**base, "metric_name": f"rent_hud_{b}", "value": float(v) if has(v) else None,
                         "value_text": rec["hud_area"] if has(v) else None,
                         "status": "ok" if has(v) else "no_data",
                         "notes": None if has(v) else "ZIP not in HUD's Small Area FMR file"})
        three = rec.get(SHARED_FROM)
        rows.append({**base, "metric_name": "rent_shared_room_est",
                     "value": round(float(three) / SHARED_DIVISOR, 2) if has(three) else None,
                     "value_text": rec["hud_area"] if has(three) else None,
                     "status": "ok" if has(three) else "no_data",
                     "notes": "Estimate: one third of HUD's 3-bedroom rent for this ZIP "
                              "(there is no official figure for a room in a shared home)."})
    return rows
