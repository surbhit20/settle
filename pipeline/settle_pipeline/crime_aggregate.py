"""Pure crime aggregation logic (tests/test_crime_aggregate.py). Decisions.md D032.

Two problems this solves:
1. ZIP areas and city limits don't line up. An area half inside San Jose only has San Jose
   crimes for its San Jose half. So the denominator is the population living INSIDE the
   covered city, and a rate is published only when most residents live there.
2. Cities differ in how many records can be mapped (SF 95%, Oakland 96%, San Jose 66%).
   Counts are scaled by 1 / placement rate so poorly mapped cities aren't made to look safer.
"""

import geopandas as gpd
import pandas as pd

# Census place name for each city whose data we load.
CITY_PLACES = {"sf": "San Francisco", "oakland": "Oakland", "sanjose": "San Jose"}

# Publish a rate only if at least this share of the area's residents live in a covered city...
MIN_COVERED_SHARE = 0.5
# ...and at least this many residents live there (tiny populations make per-1,000 rates explode).
MIN_COVERED_POPULATION = 1000

SEVERITY = {"violent": 3, "property": 2, "minor": 1}
# Classes that count toward the safety rate. "minor" (parking, noise, etc.) is tallied but not rated.
RATED_CLASSES = ("violent", "property")


def city_coverage(
    zctas: gpd.GeoDataFrame, bg_points: gpd.GeoDataFrame, places: gpd.GeoDataFrame
) -> pd.DataFrame:
    """Share of each area's residents living inside each covered city.

    zctas: zcta, geometry. bg_points: population, geometry (2020 block group centers).
    places: NAME, geometry (Census places). Returns columns zcta, city, covered_share.
    """
    covered = places[places["NAME"].isin(CITY_PLACES.values())][["NAME", "geometry"]]
    name_to_city = {v: k for k, v in CITY_PLACES.items()}
    pts = gpd.sjoin(bg_points[bg_points["population"] > 0], zctas[["zcta", "geometry"]], predicate="within")
    pts = pts.drop(columns="index_right")
    total = pts.groupby("zcta")["population"].sum()
    in_city = gpd.sjoin(pts, covered, predicate="within")
    by_city = in_city.groupby(["zcta", "NAME"])["population"].sum().reset_index()
    by_city["city"] = by_city["NAME"].map(name_to_city)
    by_city["covered_share"] = by_city["population"] / by_city["zcta"].map(total)
    return by_city[["zcta", "city", "covered_share"]].sort_values(["zcta", "city"], ignore_index=True)


def incidents_by_class(records: pd.DataFrame, classes: dict[tuple[str, str], str]) -> pd.DataFrame:
    """One row per incident with its most severe class and its area.

    records: city, incident_key, label, zcta. classes: (city, label) -> 'violent'|'property'|'minor'.
    An incident's area is taken from its first located row. Unclassified labels are dropped.
    """
    df = records.copy()
    df["class"] = [classes.get((c, l)) for c, l in zip(df["city"], df["label"])]
    df = df[df["class"].notna()]
    df["sev"] = df["class"].map(SEVERITY)
    df = df.sort_values(["city", "incident_key", "sev"], ascending=[True, True, False])
    first_zcta = df.dropna(subset=["zcta"]).groupby(["city", "incident_key"])["zcta"].first()
    top = df.drop_duplicates(["city", "incident_key"])[["city", "incident_key", "class"]]
    top = top.set_index(["city", "incident_key"]).join(first_zcta).reset_index()
    return top


def aggregate(
    incidents: pd.DataFrame,
    coverage: pd.DataFrame,
    population: dict[str, int | None],
    scale: dict[str, float],
) -> pd.DataFrame:
    """Per-area counts and rate per 1,000 residents.

    incidents: city, incident_key, class, zcta (from incidents_by_class).
    coverage: zcta, city, covered_share. population: zcta -> ACS population.
    scale: city -> 1 / placement rate.
    Rate = sum over covered cities of (violent + property) x scale / covered population x 1,000,
    or None when the covered share or covered population is too small.
    """
    located = incidents.dropna(subset=["zcta"])
    counts = located.groupby(["zcta", "city", "class"]).size().unstack("class", fill_value=0)
    for c in SEVERITY:
        if c not in counts:
            counts[c] = 0
    counts = counts.reset_index()

    rows = []
    for zcta, cov in coverage.groupby("zcta"):
        pop = population.get(zcta)
        share = float(cov["covered_share"].sum())
        c = counts[counts["zcta"] == zcta]
        raw = {k: int(c[k].sum()) for k in SEVERITY}
        scaled_rated = sum(
            float(c[c["city"] == city][list(RATED_CLASSES)].to_numpy().sum()) * scale.get(city, 1.0)
            for city in cov["city"]
        )
        covered_pop = (pop or 0) * share
        ok = pop is not None and share >= MIN_COVERED_SHARE and covered_pop >= MIN_COVERED_POPULATION
        rows.append({
            "zcta": zcta,
            "violent_count": raw["violent"],
            "property_count": raw["property"],
            "minor_count": raw["minor"],
            "covered_share": round(share, 4),
            "covered_population": round(covered_pop),
            "rate_per_1000": round(scaled_rated / covered_pop * 1000, 2) if ok else None,
        })
    return pd.DataFrame(rows).sort_values("zcta", ignore_index=True)
