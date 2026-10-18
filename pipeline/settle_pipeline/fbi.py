"""Pure helpers for FBI Crime Data Explorer city-level data (tests/test_fbi.py). Decisions.md D033.

FBI figures are shown on area cards as city-wide context only; they never enter the ranking.
"""

from typing import TypedDict


class Agency(TypedDict):
    ori: str
    agency_name: str
    agency_type_name: str
    counties: str


def sheriff_for(county: str, agencies: list[Agency]) -> Agency | None:
    target = f"{county} county sheriff's office".lower()
    return next((a for a in agencies if a["agency_name"].lower() == target), None)


def agency_for_area(name: str | None, county: str, agencies: list[Agency]) -> tuple[Agency | None, str]:
    """Which police agency's FBI numbers describe this area, and why.

    1. "Unincorporated <County>" -> that county's sheriff.
    2. A city with its own police department ("<Name> Police Department", any of our counties).
    3. Anything else (unincorporated towns like Castro Valley, cities that contract with the
       sheriff like Millbrae, Stanford) -> the county sheriff.
    Returns (agency or None, reason).
    """
    if name and not name.startswith("Unincorporated "):
        pd_name = f"{name} police department".lower()
        city_pd = next(
            (a for a in agencies if a["agency_type_name"] == "City" and a["agency_name"].lower() == pd_name), None
        )
        if city_pd:
            return city_pd, "city police department"
    sheriff = sheriff_for(county, agencies)
    if sheriff:
        return sheriff, "county sheriff (unincorporated or contract area)"
    return None, "no matching agency"


class AgencySummary(TypedDict):
    offenses: int | None        # 12-month total, annualized if some months are missing
    months_reported: int
    population: int | None
    rate_per_1000: float | None
    state_rate_per_1000: float | None  # California, same months, for context


def summarize(response: dict, agency_name: str) -> AgencySummary:
    """One /summarized/agency/{ori}/{offense} response -> a 12-month summary.

    Months the agency didn't report are left out; if 1-11 months were reported the total is
    annualized (x 12 / months) and the card says how many months were reported.
    """
    actuals = response.get("offenses", {}).get("actuals", {}).get(f"{agency_name} Offenses", {}) or {}
    months = {m: v for m, v in actuals.items() if isinstance(v, (int, float))}
    pops = response.get("populations", {}).get("population", {}).get(agency_name, {}) or {}
    pop_values = [p for p in pops.values() if isinstance(p, (int, float)) and p > 0]
    population = int(max(pop_values)) if pop_values else None

    state = response.get("offenses", {}).get("rates", {}).get("California Offenses", {}) or {}
    state_vals = [v for v in state.values() if isinstance(v, (int, float))]
    # Monthly rates are per 100,000; 12 months summed / 100 = per 1,000 per year.
    state_rate = round(sum(state_vals) * (12 / len(state_vals)) / 100, 2) if state_vals else None

    if not months or population is None:
        return {"offenses": None, "months_reported": len(months), "population": population,
                "rate_per_1000": None, "state_rate_per_1000": state_rate}
    total = sum(months.values()) * 12 / len(months)
    return {
        "offenses": round(total),
        "months_reported": len(months),
        "population": population,
        "rate_per_1000": round(total / population * 1000, 2),
        "state_rate_per_1000": state_rate,
    }
