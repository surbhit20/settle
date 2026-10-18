// The full scoring pipeline for one request, shared by POST /api/score and POST /api/chat:
// geocode office (cached) -> commute matrix (cached) -> load area inputs -> deterministic score.

import { getCommutes } from "@/lib/commute";
import { geocodeOffice } from "@/lib/geocode";
import { loadAreaInputs } from "@/lib/scoring/loadInputs";
import type { ScoreRequest, ScoreResponse } from "@/lib/scoring/request";
import { scoreAreas } from "@/lib/scoring/score";
import type { AreaInputs } from "@/lib/scoring/types";

export type RunOutcome =
  | { ok: true; response: ScoreResponse; areas: AreaInputs[] }
  | { ok: false; status: number; error: string; field?: string };

export async function runScoring(req: ScoreRequest): Promise<RunOutcome> {
  const started = Date.now();
  const office = await geocodeOffice(req.officeAddress);
  if (!office.ok) return { ok: false, status: 422, error: office.message, field: "officeAddress" };

  const { minutesByZcta, fromCache } = await getCommutes(office);
  const areas = await loadAreaInputs(minutesByZcta);
  // scoreAreas throws ScoringInputError for bad numbers; callers turn that into a 400.
  const result = scoreAreas(areas, {
    salaryUsd: req.salaryUsd,
    maxCommuteMin: req.maxCommuteMin,
    rentBudgetUsd: req.rentBudgetUsd,
    priorities: req.priorities,
  });
  return {
    ok: true,
    areas,
    response: {
      office: { lat: office.lat, lng: office.lng, address: office.normalizedAddress, accuracy: office.accuracyType },
      commuteFromCache: fromCache,
      timingMs: Date.now() - started,
      ...result,
    },
  };
}
