import type { RiskFlag } from "@/lib/risks";

// The four things a user can prioritize. Used as object keys throughout scoring.
export type SubScoreKey = "affordability" | "commute" | "safety" | "risks";
export const SUB_SCORE_KEYS: SubScoreKey[] = ["affordability", "commute", "safety", "risks"];

// Slider values, 0..SCORING.priorityMax each.
export type Priorities = Record<SubScoreKey, number>;

export type UserInputs = {
  salaryUsd: number; // annual gross
  maxCommuteMin: number;
  rentBudgetUsd: number | null; // monthly; null = derive from salary
  priorities: Priorities;
};

// Where a number came from; shown as a link next to it in the UI.
export type SourceRef = { name: string; url: string; vintage?: string | null };

// Everything scoring needs to know about one area. Built by lib/scoring/loadInputs.ts.
export type AreaInputs = {
  zcta: string;
  name: string | null;
  county: string;
  rentUsd: number | null;
  rentSource: SourceRef | null;
  commuteMin: number | null; // null = no driving route found
  commuteSource: SourceRef;
  crimeRatePer1000: number | null; // null until M4, or where a city has no open data
  crimeSource: SourceRef | null;
  risks: RiskFlag[];
};

export type SubScore = {
  score: number | null; // 0..100, or null = no data (never treated as 0)
  explanation: string; // one plain-English line on how the score was computed
  inputs: Record<string, number | string | null>; // the raw numbers behind it
  sources: SourceRef[];
};

export type ScoredArea = {
  rank: number; // 1 = best
  zcta: string;
  name: string | null;
  county: string;
  score: number; // final 0..100, one decimal
  subScores: Record<SubScoreKey, SubScore>;
  weightsUsed: Record<SubScoreKey, number>; // normalized to sum to 1; 0 where data is missing
  partial: boolean; // true when any sub-score (or any risk flag) had no data
  missing: SubScoreKey[];
};

export type FilterReason = "no_route" | "commute_too_long" | "rent_over_budget";

export type FilteredArea = {
  zcta: string;
  name: string | null;
  county: string;
  reason: FilterReason;
  detail: string;
};

export type ScoreResult = {
  monthlyIncomeUsd: number;
  budgetUsd: number;
  budgetDerived: boolean;
  ranked: ScoredArea[];
  filtered: FilteredArea[];
  // Sub-scores with no data in ANY area (e.g. safety before crime data is loaded).
  // Left out of every area's score and shown once as a notice, not as "partial data" everywhere.
  unavailableEverywhere: SubScoreKey[];
};
