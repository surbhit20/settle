// Deterministic scoring (CLAUDE.md section 5). Pure functions only: no database, no network,
// no randomness, no clock. Same inputs always give the same ranking. The LLM never calls
// into this to compute numbers; it only explains what this returns.

import { SCORING } from "@/lib/scoring/config";
import {
  SUB_SCORE_KEYS,
  type AreaInputs,
  type FilteredArea,
  type Priorities,
  type ScoreResult,
  type ScoredArea,
  type SubScore,
  type SubScoreKey,
  type UserInputs,
} from "@/lib/scoring/types";

export class ScoringInputError extends Error {}

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

// ---------- Sub-scores (each 0..100, or null for no data) ----------

// Piecewise-linear lookup on SCORING.affordabilityCurve.
export function affordabilityFromShare(share: number): number {
  const curve = SCORING.affordabilityCurve;
  if (share <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [x0, y0] = curve[i - 1];
    const [x1, y1] = curve[i];
    if (share <= x1) return y0 + ((share - x0) / (x1 - x0)) * (y1 - y0);
  }
  return curve[curve.length - 1][1];
}

export function affordabilitySubScore(area: AreaInputs, monthlyIncomeUsd: number): SubScore {
  if (area.rentUsd === null) {
    return {
      score: null,
      explanation: "No rent data for this area, so affordability is left out of its score.",
      inputs: { rent_usd: null, monthly_income_usd: monthlyIncomeUsd },
      sources: area.rentSource ? [area.rentSource] : [],
    };
  }
  const share = area.rentUsd / monthlyIncomeUsd;
  return {
    score: round1(affordabilityFromShare(share)),
    explanation: `Typical rent ${usd(area.rentUsd)}/mo is ${round1(share * 100).toFixed(1)}% of your gross monthly income of ${usd(monthlyIncomeUsd)}.`,
    inputs: {
      rent_usd: Math.round(area.rentUsd),
      monthly_income_usd: Math.round(monthlyIncomeUsd),
      rent_share_pct: round1(share * 100),
    },
    sources: area.rentSource ? [area.rentSource] : [],
  };
}

// Linear: 0 minutes -> 100, the user's max -> 0. (Areas over the max are filtered out earlier.)
export function commuteSubScore(area: AreaInputs, maxCommuteMin: number): SubScore {
  const minutes = area.commuteMin;
  if (minutes === null) {
    return { score: null, explanation: "No driving route found.", inputs: { commute_min: null }, sources: [area.commuteSource] };
  }
  return {
    score: round1(clamp(100 * (1 - minutes / maxCommuteMin), 0, 100)),
    explanation: `About ${Math.round(minutes)} min drive without traffic, against your max of ${maxCommuteMin} min.`,
    inputs: { commute_min: round1(minutes), max_commute_min: maxCommuteMin },
    sources: [area.commuteSource],
  };
}

// Where `value` falls among `all` (0 = lowest, 1 = highest), using mid-rank for ties
// so equal values always get equal percentiles.
export function midRankPercentile(value: number, all: number[]): number {
  if (all.length <= 1) return 0.5;
  const less = all.filter((v) => v < value).length;
  const equal = all.filter((v) => v === value).length;
  return (less + (equal - 1) / 2) / (all.length - 1);
}

// Inverted percentile of crime per 1,000 residents across all areas WITH data.
export function safetySubScore(area: AreaInputs, regionRates: number[]): SubScore {
  const rate = area.crimeRatePer1000;
  if (rate === null) {
    return {
      score: null,
      explanation: "No neighborhood crime data here (only SF, Oakland and San Jose publish it), so safety is left out of its score. The card shows a city-wide FBI figure for context.",
      inputs: { crime_rate_per_1000: null },
      sources: area.crimeSource ? [area.crimeSource] : [],
    };
  }
  const pct = midRankPercentile(rate, regionRates);
  return {
    score: round1(100 * (1 - pct)),
    explanation: `${round1(rate).toFixed(1)} violent and property incidents per 1,000 residents a year; safer than ${Math.round((1 - pct) * 100)}% of the ${regionRates.length} areas with data.`,
    inputs: { crime_rate_per_1000: round1(rate), percentile: round1(pct * 100) },
    sources: area.crimeSource ? [area.crimeSource] : [],
  };
}

// 100 minus a fixed penalty per flagged risk. Unknown flags add no penalty but make it partial.
export function risksSubScore(area: AreaInputs): SubScore & { partial: boolean } {
  const known = area.risks.filter((r) => r.flagged !== null);
  const sources = area.risks.flatMap((r) =>
    r.sources.map((s) => ({ name: s.source, url: s.source_url, vintage: s.dataset_vintage })),
  );
  // One link per source name, in first-seen order.
  const uniqueSources = sources.filter((s, i) => sources.findIndex((o) => o.name === s.name) === i);
  if (known.length === 0) {
    return { score: null, explanation: "No hidden-risk data for this area.", inputs: {}, sources: uniqueSources, partial: true };
  }
  const flagged = known.filter((r) => r.flagged);
  const penalty = flagged.reduce((sum, r) => sum + SCORING.riskPenalties[r.key], 0);
  const inputs: Record<string, number | string | null> = {};
  for (const r of area.risks) inputs[r.key] = r.flagged === null ? null : r.flagged ? "flagged" : "clear";
  return {
    score: clamp(100 - penalty, 0, 100),
    explanation:
      flagged.length === 0
        ? "None of the five hidden-risk flags apply."
        : `Flagged: ${flagged.map((r) => r.label.toLowerCase()).join(", ")} (−${penalty} points).`,
    inputs,
    sources: uniqueSources,
    partial: known.length < area.risks.length,
  };
}

// ---------- Weights ----------

// Normalize the user's sliders over only the sub-scores that have data, so missing data
// redistributes its weight instead of counting as zero (CLAUDE.md section 5.3).
// If every available slider is 0, fall back to equal weights.
export function normalizeWeights(priorities: Priorities, available: SubScoreKey[]): Record<SubScoreKey, number> {
  const weights: Record<SubScoreKey, number> = { affordability: 0, commute: 0, safety: 0, risks: 0 };
  if (available.length === 0) return weights;
  const total = available.reduce((s, k) => s + Math.max(0, priorities[k]), 0);
  for (const k of available) {
    weights[k] = total > 0 ? Math.max(0, priorities[k]) / total : 1 / available.length;
  }
  return weights;
}

// ---------- Main entry ----------

function validate(user: UserInputs): void {
  if (!(user.salaryUsd > 0)) throw new ScoringInputError("Salary must be greater than 0.");
  if (!(user.maxCommuteMin > 0)) throw new ScoringInputError("Max commute must be greater than 0 minutes.");
  if (user.rentBudgetUsd !== null && !(user.rentBudgetUsd > 0)) {
    throw new ScoringInputError("Rent budget must be greater than 0, or left empty.");
  }
}

export function scoreAreas(areas: AreaInputs[], user: UserInputs): ScoreResult {
  validate(user);
  const monthlyIncomeUsd = user.salaryUsd / 12;
  const budgetDerived = user.rentBudgetUsd === null;
  const budgetUsd = user.rentBudgetUsd ?? monthlyIncomeUsd * SCORING.derivedBudgetShareOfGross;
  const rentCeiling = budgetUsd * (1 + SCORING.rentOverBudgetTolerance);

  // 1. Hard filters.
  const filtered: FilteredArea[] = [];
  const kept: AreaInputs[] = [];
  for (const a of areas) {
    const base = { zcta: a.zcta, name: a.name, county: a.county };
    if (a.commuteMin === null) {
      filtered.push({ ...base, reason: "no_route", detail: "No driving route found from your office." });
    } else if (a.commuteMin > user.maxCommuteMin) {
      filtered.push({
        ...base,
        reason: "commute_too_long",
        detail: `About ${Math.round(a.commuteMin)} min drive, over your ${user.maxCommuteMin} min max.`,
      });
    } else if (a.rentUsd !== null && a.rentUsd > rentCeiling) {
      filtered.push({
        ...base,
        reason: "rent_over_budget",
        detail: `Typical rent ${usd(a.rentUsd)} is more than 15% over your ${usd(budgetUsd)} budget.`,
      });
    } else {
      // Areas with no rent data are kept (we can't prove they're over budget) and marked partial.
      kept.push(a);
    }
  }

  // 2. Sub-scores. Safety percentiles are relative to every area with crime data, filtered or not,
  //    so an area's safety score doesn't change when the user moves a filter.
  const regionRates = areas.map((a) => a.crimeRatePer1000).filter((r): r is number => r !== null);
  const unavailableEverywhere: SubScoreKey[] = [];
  if (regionRates.length === 0) unavailableEverywhere.push("safety");
  if (areas.every((a) => a.rentUsd === null)) unavailableEverywhere.push("affordability");

  const scored = kept.map((a) => {
    const risks = risksSubScore(a);
    const subScores: Record<SubScoreKey, SubScore> = {
      affordability: affordabilitySubScore(a, monthlyIncomeUsd),
      commute: commuteSubScore(a, user.maxCommuteMin),
      safety: safetySubScore(a, regionRates),
      risks: { score: risks.score, explanation: risks.explanation, inputs: risks.inputs, sources: risks.sources },
    };
    const available = SUB_SCORE_KEYS.filter((k) => subScores[k].score !== null);
    // "Partial data" flags gaps specific to this area. A sub-score with no data anywhere in the
    // region (safety before M4) is reported once in `unavailableEverywhere`, not on every area (D026).
    const missing = SUB_SCORE_KEYS.filter(
      (k) => subScores[k].score === null && !unavailableEverywhere.includes(k),
    );
    const weightsUsed = normalizeWeights(user.priorities, available);
    // 3. Final score: weighted average over the sub-scores that have data.
    const score = round1(available.reduce((s, k) => s + weightsUsed[k] * (subScores[k].score as number), 0));
    return {
      zcta: a.zcta,
      name: a.name,
      county: a.county,
      score,
      subScores,
      weightsUsed,
      partial: missing.length > 0 || risks.partial,
      missing,
    };
  });

  // 4. Rank (D030): areas with verified rent first, because only they are proven to fit the
  //    budget. Areas without rent keep their score and "partial" label but come after.
  //    Within each group: higher score first, ties broken by ZIP so the order is always the same.
  const rentVerified = (s: (typeof scored)[number]) => (s.subScores.affordability.score !== null ? 0 : 1);
  scored.sort(
    (x, y) => rentVerified(x) - rentVerified(y) || y.score - x.score || x.zcta.localeCompare(y.zcta),
  );
  const ranked: ScoredArea[] = scored.map((s, i) => ({ rank: i + 1, ...s }));

  return { monthlyIncomeUsd, budgetUsd, budgetDerived, ranked, filtered, unavailableEverywhere };
}
