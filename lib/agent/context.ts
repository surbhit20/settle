// Grounding context for Claude: only the numbers the app actually computed, with their
// sources. Claude is told to state no number that isn't in here (CLAUDE.md section 6.3).
// Pure, so it is unit tested.

import type { FilteredArea, ScoredArea, ScoreResult } from "@/lib/scoring/types";
import type { ScoreRequest } from "@/lib/scoring/request";

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

export function buildContext(request: ScoreRequest, result: ScoreResult, mentioned: string[]) {
  const scoredBy = new Map(result.ranked.map((a) => [a.zcta, a]));
  const filteredBy = new Map(result.filtered.map((a) => [a.zcta, a]));
  return {
    user_inputs: {
      salary_usd: request.salaryUsd,
      office_address: request.officeAddress,
      max_commute_min: request.maxCommuteMin,
      rent_budget_usd: request.rentBudgetUsd,
      priorities_0_to_10: request.priorities,
    },
    budget_used_usd: Math.round(result.budgetUsd),
    budget_was_derived_from_salary: result.budgetDerived,
    areas_ranked: result.ranked.length,
    areas_filtered_out: result.filtered.length,
    not_scored_anywhere: result.unavailableEverywhere,
    top_5: result.ranked.slice(0, 5).map(scoredSummary),
    mentioned_areas: mentioned.map((z) =>
      scoredBy.has(z) ? scoredSummary(scoredBy.get(z)!) : filteredBy.has(z) ? filteredSummary(filteredBy.get(z)!) : { zcta: z, note: "not in the results" },
    ),
  };
}
