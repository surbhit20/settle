import type { RiskFlag } from "@/lib/risks";
import type { HOME_TYPES } from "@/lib/scoring/config";

// "any" | "shared" | "studio" | "1br" | ... (keyof typeof = the object's key names as a type).
export type HomeType = keyof typeof HOME_TYPES;

// The four things a user can prioritize. Used as object keys throughout scoring.
export type SubScoreKey = "affordability" | "commute" | "safety" | "risks";
export const SUB_SCORE_KEYS: SubScoreKey[] = ["affordability", "commute", "safety", "risks"];

// How the user gets to work (D048). Drive = openrouteservice drive time without traffic;
// transit = precomputed typical weekday-morning public-transit time.
export type CommuteMode = "drive" | "transit";
export const COMMUTE_MODES: CommuteMode[] = ["drive", "transit"];

// Slider values, 0..SCORING.priorityMax each.
export type Priorities = Record<SubScoreKey, number>;

export type UserInputs = {
  salaryUsd: number; // annual gross
  maxCommuteMin: number;
  rentBudgetUsd: number | null; // monthly; null = derive from salary
  priorities: Priorities;
  homeType?: HomeType; // defaults to "any"
  commuteMode?: CommuteMode; // defaults to "drive"
};

// Where a number came from; shown as a link next to it in the UI.
export type SourceRef = { name: string; url: string; vintage?: string | null };

// Everything scoring needs to know about one area. Built by lib/scoring/loadInputs.ts.
export type AreaInputs = {
  zcta: string;
  name: string | null;
  county: string;
  rentUsd: number | null; // Zillow typical rent ("any" home type)
  rentSource: SourceRef | null;
  // Rent per specific home size (HUD SAFMR; "shared" is an estimate). Missing = no data.
  rentsBySize?: Partial<Record<Exclude<HomeType, "any">, { usd: number | null; source: SourceRef | null }>>;
  // The commute for the user's chosen mode (what's scored and filtered on); null = no route.
  commuteMin: number | null;
  commuteSource: SourceRef;
  // Both modes, for display and the chat. Set by lib/scoring/commuteMode.ts.
  driveMin?: number | null;
  driveSource?: SourceRef;
  transitMin?: number | null;
  transitEstimated?: boolean; // same-area trip: estimated, not routed
  transitSource?: SourceRef | null;
  crimeRatePer1000: number | null; // null until M4, or where a city has no open data
  population?: number | null; // ACS residents; areas under SCORING.minPopulation aren't ranked
  // City-wide FBI rate (violent + property per 1,000) for the area's police agency: the safety
  // fallback where there's no neighborhood data (D040).
  fbiRatePer1000?: number | null;
  fbiAgency?: string | null;
  fbiSource?: SourceRef | null;
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

export type FilterReason = "few_residents" | "no_route" | "commute_too_long" | "rent_over_budget";

export type FilteredArea = {
  zcta: string;
  name: string | null;
  county: string;
  reason: FilterReason;
  detail: string;
};

export type ScoreResult = {
  homeType: HomeType;
  monthlyIncomeUsd: number;
  budgetUsd: number;
  budgetDerived: boolean;
  ranked: ScoredArea[];
  filtered: FilteredArea[];
  // Sub-scores with no data in ANY area (e.g. safety before crime data is loaded).
  // Left out of every area's score and shown once as a notice, not as "partial data" everywhere.
  unavailableEverywhere: SubScoreKey[];
};
