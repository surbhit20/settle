import { SCORING } from "@/lib/scoring/config";
import { HOME_TYPES } from "@/lib/scoring/config";
import { COMMUTE_MODES, SUB_SCORE_KEYS, type CommuteMode, type HomeType, type Priorities } from "@/lib/scoring/types";

// The JSON body the form sends.
export type ScoreRequest = {
  salaryUsd: number;
  officeAddress: string;
  maxCommuteMin: number;
  rentBudgetUsd: number | null;
  priorities: Priorities;
  homeType?: HomeType; // defaults to "any"
  commuteMode?: CommuteMode; // defaults to "drive"
};

// Validates untrusted JSON into a ScoreRequest, or returns an error message.
export function parseScoreRequest(body: unknown): ScoreRequest | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
  const salaryUsd = num(b.salaryUsd);
  const maxCommuteMin = num(b.maxCommuteMin);
  const rentBudgetUsd = b.rentBudgetUsd === null || b.rentBudgetUsd === undefined ? null : num(b.rentBudgetUsd);
  const officeAddress = typeof b.officeAddress === "string" ? b.officeAddress.trim() : "";
  if (Number.isNaN(salaryUsd)) return "Salary is required.";
  if (Number.isNaN(maxCommuteMin)) return "Max commute is required.";
  if (rentBudgetUsd !== null && Number.isNaN(rentBudgetUsd)) return "Rent budget must be a number.";
  if (officeAddress.length < 5 || officeAddress.length > 256) return "Please enter your office's street address.";
  const p = (b.priorities ?? {}) as Record<string, unknown>;
  const priorities = {} as Priorities;
  for (const k of SUB_SCORE_KEYS) {
    const v = num(p[k]);
    if (Number.isNaN(v) || v < 0 || v > SCORING.priorityMax) return `Priority "${k}" must be between 0 and ${SCORING.priorityMax}.`;
    priorities[k] = v;
  }
  const homeType = b.homeType === undefined || b.homeType === null ? "any" : b.homeType;
  if (typeof homeType !== "string" || !(homeType in HOME_TYPES)) return "Unknown home type.";
  const commuteMode = b.commuteMode === undefined || b.commuteMode === null ? "drive" : b.commuteMode;
  if (!COMMUTE_MODES.includes(commuteMode as CommuteMode)) return "Unknown commute mode.";
  return {
    salaryUsd,
    officeAddress,
    maxCommuteMin,
    rentBudgetUsd,
    priorities,
    homeType: homeType as HomeType,
    commuteMode: commuteMode as CommuteMode,
  };
}

// What POST /api/score returns on success (the scoring result plus request context).
export type ScoreResponse = import("@/lib/scoring/types").ScoreResult & {
  office: { lat: number; lng: number; address: string; accuracy: string };
  commuteFromCache: boolean;
  transitOfficeZcta: string | null; // the area transit times are measured to, if available
  timingMs: number;
};
