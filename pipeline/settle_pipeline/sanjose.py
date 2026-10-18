"""Pure helpers for San Jose police calls (tested in tests/test_sanjose.py). See decisions.md D032."""

import re

import pandas as pd

# Calls that produced a police report, an arrest, or a criminal citation. Everything else
# (no report, canceled, gone on arrival, unfounded, traffic citations, warrant arrests made
# elsewhere, supplemental reports that repeat an existing case) is not counted as an incident.
KEEP_DISPOSITIONS = {"Report taken", "Arrest Made", "Criminal Citation"}

BLOCK_RE = re.compile(r"^\[(\d+)\]-\[(\d+)\]\s+(.+?)\s*$")


# San Jose PD street-type abbreviations that the Census geocoder doesn't always recognize.
SUFFIXES = {"AV": "AVE", "WY": "WAY", "BL": "BLVD", "CL": "CIR", "LP": "LOOP", "PY": "PKWY",
            "EX": "EXPY", "TR": "TER", "SQ": "SQ", "PZ": "PLZ", "HY": "HWY"}


def expand_suffix(street: str) -> str:
    """'TRADEWINDS WY' -> 'TRADEWINDS WAY'; other names unchanged."""
    parts = street.split()
    if parts and parts[-1] in SUFFIXES:
        parts[-1] = SUFFIXES[parts[-1]]
    return " ".join(parts)


def block_candidates(address: str) -> list[str]:
    """Street addresses to try, in order, for a hundred-block like '[300]-[400] TRADEWINDS WY'.

    1. midpoint number, original street ('350 TRADEWINDS WY')
    2. midpoint number, expanded suffix ('350 TRADEWINDS WAY')
    3. low end of the block + 1, expanded suffix ('301 TRADEWINDS WAY'): short streets often end
       before the midpoint.
    Empty for intersections ('A ST & B ST') and anything else that isn't a single block.
    """
    if not isinstance(address, str):
        return []
    m = BLOCK_RE.match(address.strip())
    if not m:
        return []
    lo, hi, street = int(m.group(1)), int(m.group(2)), m.group(3).strip()
    if not street or hi < lo:
        return []
    mid = (lo + hi) // 2
    expanded = expand_suffix(street)
    out = [f"{mid} {street}", f"{mid} {expanded}", f"{lo + 1} {expanded}"]
    return list(dict.fromkeys(out))  # drop duplicates, keep order


def block_to_street(address: str) -> str | None:
    """First candidate for an address (see block_candidates), or None if it isn't a block."""
    c = block_candidates(address)
    return c[0] if c else None


def select_incidents(calls: pd.DataFrame) -> pd.DataFrame:
    """One row per call (dedupe by EID) with a counted disposition, plus a geocodable `street`."""
    df = calls.drop_duplicates("EID")
    df = df[df["FINAL_DISPO"].isin(KEEP_DISPOSITIONS)].copy()
    df["street"] = df["ADDRESS"].map(block_to_street)
    return df


def parse_census_batch(text: str) -> dict[str, tuple[float, float] | None]:
    """Census batch output (CSV, no header) -> {id: (lat, lng) or None}.

    Columns: id, input address, match status, match type, matched address, "lon,lat", tiger id, side.
    """
    import csv
    import io

    out: dict[str, tuple[float, float] | None] = {}
    for row in csv.reader(io.StringIO(text)):
        if not row:
            continue
        rid = row[0]
        if len(row) >= 6 and row[2] == "Match" and row[5]:
            lon, lat = (float(v) for v in row[5].split(","))
            out[rid] = (lat, lon)
        else:
            out[rid] = None
    return out
