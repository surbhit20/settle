"""Step 11: load FBI city-level violent and property crime rates into `area_metrics`.

Reads only data/raw/fbi/ (run fetch_fbi first). Every area gets the rates of the agency that
polices it (its city police department, or the county sheriff), stored as:
  fbi_violent_per_1000, fbi_property_per_1000   (value = per 1,000 residents per year)
These are CONTEXT on the area card only; scoring never reads them (decisions.md D033).

Run: uv run --project pipeline python -m settle_pipeline.load_fbi
"""

import json

from settle_pipeline.fbi import summarize
from settle_pipeline.fetch_fbi import FROM, OFFENSES, TO, area_agencies, response_path
from settle_pipeline.metrics import upsert_metrics

CDE_URL = "https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/explorer/crime/crime-trend"
METRIC = {"violent-crime": "fbi_violent_per_1000", "property-crime": "fbi_property_per_1000"}
VINTAGE = "FBI UCR, Jul 2025 to Jun 2026"


def main() -> None:
    mapping = area_agencies()
    summaries: dict[tuple[str, str], dict] = {}
    for agency, _ in mapping.values():
        if not agency:
            continue
        for off in OFFENSES:
            key = (agency["ori"], off)
            if key not in summaries:
                resp = json.loads(response_path(*key).read_text())
                summaries[key] = summarize(resp, agency["agency_name"])

    rows = []
    for zcta, (agency, reason) in sorted(mapping.items()):
        for off in OFFENSES:
            s = summaries.get((agency["ori"], off)) if agency else None
            has = s is not None and s["rate_per_1000"] is not None
            note = None
            if agency and s:
                note = (
                    f"City-wide figure for {agency['agency_name']} ({reason}), population {s['population']:,}; "
                    f"{s['months_reported']} of 12 months reported. California: {s['state_rate_per_1000']} per 1,000. "
                    "Not used in ranking."
                ) if s["population"] else f"{agency['agency_name']}: no population reported."
            rows.append({
                "zcta": zcta,
                "metric_name": METRIC[off],
                "value": s["rate_per_1000"] if has else None,
                "value_text": agency["agency_name"] if agency else None,
                "unit": "per 1,000 residents per year",
                "source": f"FBI Crime Data Explorer: {agency['agency_name']}" if agency else "FBI Crime Data Explorer",
                "source_url": CDE_URL,
                "fetched_at": f"{TO[3:]}-{TO[:2]}-30T00:00:00Z",
                "confidence": None,
                "status": "ok" if has else "no_data",
                "notes": note,
                "dataset_vintage": VINTAGE,
            })

    by_agency = {}
    for (ori, off), s in summaries.items():
        by_agency.setdefault(ori, {})[off] = s
    names = {a["ori"]: a["agency_name"] for a, _ in mapping.values() if a}
    print(f"  {'agency':45s} {'pop':>9s} {'violent/1k':>10s} {'property/1k':>11s} months")
    for ori in sorted(by_agency, key=lambda o: -(by_agency[o]['violent-crime']['population'] or 0))[:70]:
        v, p = by_agency[ori]["violent-crime"], by_agency[ori]["property-crime"]
        print(f"  {names[ori][:45]:45s} {v['population'] or 0:>9,} {str(v['rate_per_1000']):>10s} {str(p['rate_per_1000']):>11s} "
              f"{v['months_reported']}/{p['months_reported']}")
    upsert_metrics(rows)
    print("done")


if __name__ == "__main__":
    main()
