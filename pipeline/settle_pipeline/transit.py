"""Pure helpers for the transit-time matrix (decisions.md D048). Unit tested; no network or Java."""

import csv
import datetime as dt
import io
import math
import zipfile
from pathlib import Path


def feed_service_range(calendar_csv: str) -> tuple[dt.date, dt.date]:
    """Earliest start_date and latest end_date in a GTFS calendar.txt (YYYYMMDD strings)."""
    rows = list(csv.DictReader(io.StringIO(calendar_csv)))
    if not rows:
        raise ValueError("calendar.txt has no rows")
    parse = lambda s: dt.datetime.strptime(s.strip(), "%Y%m%d").date()  # noqa: E731
    return min(parse(r["start_date"]) for r in rows), max(parse(r["end_date"]) for r in rows)


# US federal holidays that fall on a Tuesday/Wednesday often enough to matter are skipped by
# date; a typical weekday is wanted, so the chosen day avoids these.
def _is_us_holiday(d: dt.date) -> bool:
    fixed = {(1, 1), (6, 19), (7, 4), (11, 11), (12, 24), (12, 25), (12, 31)}
    if (d.month, d.day) in fixed:
        return True
    # Thanksgiving: 4th Thursday of November, plus the Wednesday before it.
    if d.month == 11:
        first_thu = 1 + (3 - dt.date(d.year, 11, 1).weekday()) % 7
        thanksgiving = first_thu + 21
        return d.day in (thanksgiving - 1, thanksgiving)
    return False


def pick_weekday(start: dt.date, end: dt.date, today: dt.date) -> dt.date:
    """A typical Tuesday inside the feed's service range: the first one at least 7 days after
    max(start, today), skipping holidays. Raises if the feed has no such day."""
    d = max(start, today) + dt.timedelta(days=7)
    d += dt.timedelta(days=(1 - d.weekday()) % 7)  # next Tuesday (weekday() == 1)
    while d <= end:
        if not _is_us_holiday(d):
            return d
        d += dt.timedelta(days=7)
    raise ValueError(f"No non-holiday Tuesday between {start} and {end}")


def fill_intrazonal(times: dict[tuple[str, str], float | None], zones: list[str]) -> dict[tuple[str, str], float | None]:
    """Trips that start and end in the same area.

    The router measures center to center, which is 0 for the same area. A standard transport-model
    estimate is half the time to the nearest other area (people live and work spread across an
    area, not at its center). If an area reaches no other area, its own time stays unknown (None).
    """
    out = dict(times)
    for z in zones:
        others = [t for (a, b), t in times.items() if a == z and b != z and t is not None and t > 0]
        out[(z, z)] = round(min(others) / 2, 1) if others else None
    return out


def clean_minutes(value) -> float | None:
    """r5py returns NaN (or a missing value) when no trip fits within max_time."""
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f


def fill_blank_stop_names(stops_csv: str) -> tuple[str, int]:
    """GTFS lets pathway nodes and boarding areas (location_type 3 and 4) have no stop_name, but R5
    rejects the whole feed if any name is blank. Give those rows their stop_id as a name; nothing
    else changes. Returns the new CSV text and how many rows were filled."""
    reader = csv.DictReader(io.StringIO(stops_csv))
    fields = reader.fieldnames or []
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    filled = 0
    for row in reader:
        if not (row.get("stop_name") or "").strip() and row.get("location_type", "").strip() in ("3", "4"):
            row["stop_name"] = row["stop_id"]
            filled += 1
        writer.writerow(row)
    return out.getvalue(), filled


def write_r5_ready_gtfs(src: Path, dest: Path) -> int:
    """Copy a GTFS zip, rewriting only stops.txt with fill_blank_stop_names(). Returns rows filled."""
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zout:
        filled = 0
        for name in zin.namelist():
            data = zin.read(name)
            if name == "stops.txt":
                text, filled = fill_blank_stop_names(data.decode("utf-8-sig"))
                data = text.encode("utf-8")
            zout.writestr(name, data)
    return filled
