"""Step 4: download Zillow Research public CSVs (ZORI rent, ZHVI home value) by ZIP.

Free public files; no API, no key. Files already on disk are skipped. Delete them to pick up
Zillow's monthly refresh.

Run: uv run --project pipeline python -m settle_pipeline.fetch_zillow
"""

import httpx

from settle_pipeline.config import RAW_DIR

ZILLOW_DIR = RAW_DIR / "zillow"

DOWNLOADS: dict[str, str] = {
    # Zillow Observed Rent Index, all homes (SFR + condo + multifamily), smoothed, monthly, by ZIP (~10 MB).
    "Zip_zori_uc_sfrcondomfr_sm_month.csv": "https://files.zillowstatic.com/research/public_csvs/zori/Zip_zori_uc_sfrcondomfr_sm_month.csv",
    # Zillow Home Value Index, SFR + condo, middle tier, smoothed + seasonally adjusted, by ZIP (~124 MB).
    "Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv": "https://files.zillowstatic.com/research/public_csvs/zhvi/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
}


def main() -> None:
    ZILLOW_DIR.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=300) as client:
        for name, url in DOWNLOADS.items():
            dest = ZILLOW_DIR / name
            if dest.exists():
                print(f"  cached   {name}")
                continue
            print(f"  fetching {name} ...", flush=True)
            tmp = dest.with_suffix(".part")
            with client.stream("GET", url) as resp:
                resp.raise_for_status()
                with open(tmp, "wb") as f:
                    for chunk in resp.iter_bytes():
                        f.write(chunk)
            tmp.rename(dest)
    print("done")


if __name__ == "__main__":
    main()
