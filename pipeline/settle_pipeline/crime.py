"""Pure transforms: raw city police data -> one normalized incident table (tests/test_crime.py).

Normalized columns (one row per raw record; an incident can have several rows):
  city          'sf' | 'oakland' | 'sanjose'
  incident_key  per-city id: SF incident_id, Oakland casenumber, San Jose EID
  occurred_at   ISO timestamp (string)
  label         the text Jev classifies (SF incident_description, Oakland description,
                San Jose CALL_TYPE), uppercased and whitespace-trimmed
  lat, lng      WGS84, or NaN when the record has no usable location

Rows are deduplicated to incidents only after classification, keeping each incident's most
severe class (violent > property > minor), because SF supplemental reports and Oakland
multi-charge cases can carry different labels for the same incident (decisions.md D032).
"""

import math

import pandas as pd

COLUMNS = ["city", "incident_key", "occurred_at", "label", "lat", "lng"]


def _clean_label(s: pd.Series) -> pd.Series:
    return s.fillna("").astype(str).str.strip().str.upper().str.replace(r"\s+", " ", regex=True)


def _num(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s, errors="coerce")


def normalize_sf(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    out = pd.DataFrame({
        "city": "sf",
        "incident_key": df["incident_id"].astype(str),
        "occurred_at": df["incident_datetime"],
        "label": _clean_label(df["incident_description"]),
        "lat": _num(df.get("latitude")),
        "lng": _num(df.get("longitude")),
    })
    return out[COLUMNS]


def _oakland_point(loc) -> tuple[float, float]:
    """Socrata point {'type': 'Point', 'coordinates': [lng, lat]} -> (lat, lng), NaN if missing/zero."""
    try:
        lng, lat = loc["coordinates"]
        lat, lng = float(lat), float(lng)
        if lat == 0 or lng == 0:
            return (math.nan, math.nan)
        return (lat, lng)
    except (TypeError, KeyError, ValueError):
        return (math.nan, math.nan)


def normalize_oakland(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    points = df["location"].map(_oakland_point) if "location" in df else pd.Series([(math.nan, math.nan)] * len(df))
    out = pd.DataFrame({
        "city": "oakland",
        "incident_key": df["casenumber"].astype(str),
        "occurred_at": df["datetime"],
        "label": _clean_label(df["description"]),
        "lat": points.map(lambda p: p[0]),
        "lng": points.map(lambda p: p[1]),
    })
    return out[COLUMNS]


def normalize_sanjose(incidents: pd.DataFrame, lookup: dict[str, list[float] | None]) -> pd.DataFrame:
    """`incidents` = sanjose.select_incidents(calls); `lookup` = ADDRESS -> [lat, lng] | None."""
    coords = incidents["ADDRESS"].map(lambda a: lookup.get(a) if isinstance(a, str) else None)
    out = pd.DataFrame({
        "city": "sanjose",
        "incident_key": incidents["EID"].astype(str),
        "occurred_at": incidents["OFFENSE_DATE"],
        "label": _clean_label(incidents["CALL_TYPE"]),
        "lat": coords.map(lambda c: c[0] if c else math.nan),
        "lng": coords.map(lambda c: c[1] if c else math.nan),
    })
    return out[COLUMNS].reset_index(drop=True)


def placement_rates(df: pd.DataFrame) -> dict[str, float]:
    """Per city: share of distinct incidents with at least one located row.

    Used to scale counts so cities with more unmappable records aren't made to look safer (D032).
    """
    located = df.assign(has=df["lat"].notna() & df["lng"].notna()).groupby(["city", "incident_key"])["has"].any()
    return located.groupby(level="city").mean().to_dict()
