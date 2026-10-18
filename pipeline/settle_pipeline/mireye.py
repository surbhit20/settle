"""Pure parsing of cached Mireye batch responses into MetricRow dicts (tested in tests/test_mireye.py)."""

from settle_pipeline.metrics import MetricRow

MIREYE_SOURCE_PREFIX = "Mireye"


def field_to_row(zcta: str, name: str, f: dict) -> MetricRow:
    """One Mireye field result -> one metric row. Keeps Mireye's status, confidence and notes."""
    raw = f.get("value")
    value: float | None = None
    value_text: str | None = None
    if isinstance(raw, bool):  # check bool before int: in Python, True is also an int
        value, value_text = (1.0 if raw else 0.0), ("true" if raw else "false")
    elif isinstance(raw, (int, float)):
        value = float(raw)
    elif raw is not None:
        value_text = str(raw)
    return {
        "zcta": zcta,
        "metric_name": name,
        "value": value,
        "value_text": value_text,
        "unit": f.get("unit"),
        # Upstream agency (e.g. FEMA_NFHL) delivered via Mireye; the link is the agency's page.
        "source": f"{MIREYE_SOURCE_PREFIX} / {f.get('source') or 'unknown'}",
        "source_url": f.get("source_url") or "https://api.mireye.com",
        "fetched_at": f["fetched_at"],
        "confidence": f.get("confidence"),
        "status": f.get("status") or "unknown",
        "notes": f.get("notes"),
        "dataset_vintage": f.get("dataset_vintage"),
    }


def parse_batch_record(record: dict, fields: list[str]) -> list[MetricRow]:
    """Turn one cached batch file into rows. Results are index-aligned with record['zctas'].

    A location with ok:false yields a 'failed' row for every requested field, so the area
    shows "no data" instead of silently missing.
    """
    rows: list[MetricRow] = []
    results = sorted(record["response"]["results"], key=lambda r: r["index"])
    if len(results) != len(record["zctas"]):
        raise ValueError(f"{len(results)} results for {len(record['zctas'])} locations")
    for zcta, res in zip(record["zctas"], results):
        if not res.get("ok"):
            err = res.get("error") or {}
            for name in fields:
                rows.append({
                    "zcta": zcta, "metric_name": name, "value": None, "value_text": None,
                    "unit": None, "source": MIREYE_SOURCE_PREFIX,
                    "source_url": "https://api.mireye.com", "fetched_at": record["fetched_at"],
                    "confidence": None, "status": "failed",
                    "notes": f"location failed: {err.get('code') or err}", "dataset_vintage": None,
                })
            continue
        for name in fields:
            f = res["fields"].get(name)
            if f is None:  # requested but not returned at all
                rows.append({
                    "zcta": zcta, "metric_name": name, "value": None, "value_text": None,
                    "unit": None, "source": MIREYE_SOURCE_PREFIX,
                    "source_url": "https://api.mireye.com", "fetched_at": res["fetched_at"],
                    "confidence": None, "status": "missing", "notes": "field not in response",
                    "dataset_vintage": None,
                })
            else:
                rows.append(field_to_row(zcta, name, f))
    return rows


def merge_rows(base: list[MetricRow], overrides: list[MetricRow]) -> list[MetricRow]:
    """Later rows (retries) replace earlier ones for the same (zcta, metric), but only when
    the retry actually succeeded, so a second failure never hides a first success."""
    out = {(r["zcta"], r["metric_name"]): r for r in base}
    for r in overrides:
        key = (r["zcta"], r["metric_name"])
        if r["status"] != "failed" or key not in out:
            out[key] = r
    return [out[k] for k in sorted(out)]
