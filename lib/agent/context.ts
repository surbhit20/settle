// Grounding context for Claude: only the numbers the app actually computed, with their
// sources. Claude is told to state no number that isn't in here (CLAUDE.md section 6.3).
// Pure, so it is unit tested.

import type { AreaInputs, FilteredArea, ScoredArea, ScoreResult } from "@/lib/scoring/types";
import type { ScoreRequest } from "@/lib/scoring/request";
import { EMPTY_VIEW, type ViewState } from "@/lib/agent/types";
import { rentFor } from "@/lib/scoring/score";
import type { HomeType } from "@/lib/scoring/types";

function scoredSummary(a: ScoredArea) {
  return {
    zcta: a.zcta,
    name: a.name,
    county: a.county,
    rank: a.rank,
    score: a.score,
    partial_data: a.partial,
    missing: a.missing,
    weights_used: a.weightsUsed,
    sub_scores: Object.fromEntries(
      Object.entries(a.subScores).map(([k, s]) => [
        k,
        { score: s.score, explanation: s.explanation, inputs: s.inputs, sources: s.sources.map((x) => `${x.name} <${x.url}>`) },
      ]),
    ),
  };
}

function filteredSummary(f: FilteredArea) {
  return { zcta: f.zcta, name: f.name, county: f.county, filtered_out: f.reason, detail: f.detail };
}

// Facts about an area that exist whether or not it passed the user's filters, so Claude can
// answer "what's the crime rate in San Jose?" even for areas filtered out of the ranking.
function areaFacts(a: AreaInputs) {
  return {
    population: a.population ?? null,
    neighborhood_crime_rate_per_1000:
      a.crimeRatePer1000 === null ? "no neighborhood crime data" : Math.round(a.crimeRatePer1000 * 10) / 10,
    crime_source: a.crimeSource ? `${a.crimeSource.name} <${a.crimeSource.url}>` : null,
    city_wide_fbi_crime_rate_per_1000: a.fbiRatePer1000 == null ? null : Math.round(a.fbiRatePer1000 * 10) / 10,
    city_wide_fbi_source: a.fbiSource ? `${a.fbiSource.name} <${a.fbiSource.url}>` : null,
    typical_rent_usd: a.rentUsd === null ? null : Math.round(a.rentUsd),
    typical_rent_source: a.rentSource ? `${a.rentSource.name} <${a.rentSource.url}>` : null,
    rent_by_size_usd: Object.fromEntries(
      Object.entries(a.rentsBySize ?? {}).map(([k, v]) => [k, v?.usd == null ? null : Math.round(v.usd)]),
    ),
    rent_by_size_source: Object.values(a.rentsBySize ?? {}).find((v) => v?.source)?.source?.name ?? null,
    commute_min: a.commuteMin === null ? null : Math.round(a.commuteMin), // the user's chosen mode
    commute_source: `${a.commuteSource.name} <${a.commuteSource.url}>`,
    drive_min_without_traffic: a.driveMin == null ? null : Math.round(a.driveMin),
    transit_min_weekday_morning: a.transitMin == null ? null : Math.round(a.transitMin),
    transit_is_same_area_estimate: a.transitEstimated ?? false,
    transit_source: a.transitSource ? `${a.transitSource.name} <${a.transitSource.url}>` : null,
  };
}

// Differences from the area open on screen, precomputed so Claude can quote them: the grounding
// check only allows numbers that are in the context, so Claude must not do this arithmetic itself.
function versusSelected(a: AreaInputs, selected: AreaInputs, homeType: HomeType) {
  const rent = rentFor(a, homeType).usd;
  const baseRent = rentFor(selected, homeType).usd;
  return {
    compared_with: selected.zcta,
    rent_difference_usd_per_month: rent === null || baseRent === null ? null : Math.round(rent) - Math.round(baseRent),
    commute_difference_min:
      a.commuteMin === null || selected.commuteMin === null ? null : Math.round(a.commuteMin) - Math.round(selected.commuteMin),
    note: "positive = more than the selected area, negative = less",
  };
}

export function buildContext(
  request: ScoreRequest,
  result: ScoreResult,
  mentioned: string[],
  inputs: AreaInputs[] = [],
  view: ViewState = EMPTY_VIEW,
) {
  const inputsBy = new Map(inputs.map((a) => [a.zcta, a]));
  const selected = view.selectedZcta ? inputsBy.get(view.selectedZcta) : undefined;
  const homeType = request.homeType ?? "any";
  const facts = (z: string) => {
    const a = inputsBy.get(z);
    if (!a) return {};
    return selected && z !== selected.zcta
      ? { facts: areaFacts(a), vs_selected_area: versusSelected(a, selected, homeType) }
      : { facts: areaFacts(a) };
  };
  const scoredBy = new Map(result.ranked.map((a) => [a.zcta, a]));
  const filteredBy = new Map(result.filtered.map((a) => [a.zcta, a]));
  return {
    user_inputs: {
      salary_usd: request.salaryUsd,
      office_address: request.officeAddress,
      max_commute_min: request.maxCommuteMin,
      rent_budget_usd: request.rentBudgetUsd,
      home_type: request.homeType ?? "any",
      commute_mode: request.commuteMode ?? "drive",
      priorities_0_to_10: request.priorities,
    },
    budget_used_usd: Math.round(result.budgetUsd),
    budget_was_derived_from_salary: result.budgetDerived,
    // What the user is looking at. "it", "this" or "here" mean selected_area.
    on_screen: {
      selected_area: view.selectedZcta,
      compared_areas: view.compared,
    },
    areas_ranked: result.ranked.length,
    areas_filtered_out: result.filtered.length,
    not_scored_anywhere: result.unavailableEverywhere,
    top_5: result.ranked.slice(0, 5).map(scoredSummary),
    mentioned_areas: mentioned.map((z) =>
      scoredBy.has(z)
        ? { ...scoredSummary(scoredBy.get(z)!), ...facts(z) }
        : filteredBy.has(z)
          ? { ...filteredSummary(filteredBy.get(z)!), ...facts(z) }
          : { zcta: z, note: "not in the results", ...facts(z) },
    ),
  };
}
