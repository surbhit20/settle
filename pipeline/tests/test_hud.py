"""Tests for settle_pipeline.hud (no network, no DB)."""

import pandas as pd

from settle_pipeline.hud import normalize, pick_rows, to_metric_rows


def raw(rows):
    cols = ["ZIP\nCode", "HUD Area Code", "HUD Fair Market Rent Area Name"]
    for b in ["0BR", "1BR", "2BR", "3BR", "4BR"]:
        cols += [f"SAFMR\n{b}", f"SAFMR\n{b} - 90%\nPayment\nStandard", f"SAFMR\n{b} - 110%\nPayment\nStandard"]
    data = []
    for zip_, area, rents in rows:
        r = [zip_, "X", area]
        for v in rents:
            r += [str(v), "0", "0"]
        data.append(r)
    return pd.DataFrame(data, columns=cols)


def test_normalize_reads_rents_and_pads_zips():
    df = normalize(raw([("9411", "San Francisco, CA HUD Metro FMR Area", [2980, 3300, 4000, 5100, 5600])]))
    assert df.loc[0, "zip"] == "09411"
    assert df.loc[0, ["0br", "4br"]].tolist() == [2980, 5600]
    assert "SAFMR 0BR - 90% Payment Standard" not in df.columns


def test_pick_rows_prefers_the_area_for_the_county():
    hud = normalize(raw([
        ("94550", "Modesto, CA MSA", [1, 1, 1, 1, 1]),
        ("94550", "Oakland-Fremont, CA HUD Metro FMR Area", [2380, 2600, 3100, 4000, 4500]),
        ("94110", "San Francisco, CA HUD Metro FMR Area", [2900, 3200, 3900, 5000, 5500]),
    ]))
    areas = pd.DataFrame({"zcta": ["94110", "94550", "99999"], "county": ["San Francisco", "Alameda", "Alameda"]})
    picked = pick_rows(hud, areas).set_index("zcta")
    assert picked.loc["94550", "hud_area"].startswith("Oakland-Fremont")
    assert picked.loc["94550", "0br"] == 2380
    assert pd.isna(picked.loc["99999", "0br"])  # not in HUD's file: kept, no rents


def test_metric_rows_include_shared_room_estimate_and_no_data():
    hud = normalize(raw([("94110", "San Francisco, CA HUD Metro FMR Area", [2900, 3200, 3900, 5100, 5500])]))
    picked = pick_rows(hud, pd.DataFrame({"zcta": ["94110", "99999"], "county": ["San Francisco", "Alameda"]}))
    by = {(r["zcta"], r["metric_name"]): r for r in to_metric_rows(picked, "t")}
    assert by[("94110", "rent_hud_2br")]["value"] == 3900
    assert by[("94110", "rent_shared_room_est")]["value"] == 1700  # 5100 / 3
    assert "Estimate" in by[("94110", "rent_shared_room_est")]["notes"]
    assert by[("99999", "rent_hud_0br")]["value"] is None and by[("99999", "rent_hud_0br")]["status"] == "no_data"
    assert all(r["source"].startswith("HUD Small Area") for r in by.values())
