// The full scoring pipeline for one request, shared by POST /api/score and POST /api/chat:
// geocode office (cached) -> commute matrix (cached) -> load area inputs -> deterministic score.

import { getCommutes } from "@/lib/commute";
import { geocodeOffice } from "@/lib/geocode";
import { withCommuteMode, type TransitTimes } from "@/lib/scoring/commuteMode";
import { loadAreaInputs } from "@/lib/scoring/loadInputs";
import type { ScoreRequest, ScoreResponse } from "@/lib/scoring/request";
import { scoreAreas } from "@/lib/scoring/score";
import type { AreaInputs } from "@/lib/scoring/types";
import { getTransitTimes } from "@/lib/transit";

export type RunOutcome =
  | { ok: true; response: ScoreResponse; areas: AreaInputs[] }
  | { ok: false; status: number; error: string; field?: string };

export async function runScoring(req: ScoreRequest): Promise<RunOutcome> {
  const started = Date.now();
  const office = await geocodeOffice(req.officeAddress);
  if (!office.ok) return { ok: false, status: 422, error: office.message, field: "officeAddress" };

  const mode = req.commuteMode ?? "drive";
  // Transit times are a database lookup (free). Required in transit mode; otherwise shown if present.
  const transit = await getTransitTimes(office);
  if (mode === "transit" && !transit.ok) return { ok: false, status: 422, error: transit.message, field: "commuteMode" };
  const transitTimes: TransitTimes | null = transit.ok ? transit.times : null;

  // Drive times (openrouteservice, cached per office). In transit mode they're extra context, so
  // an ORS failure there leaves them blank instead of failing the search.
  let drive: Awaited<ReturnType<typeof getCommutes>>;
  try {
    drive = await getCommutes(office);
  } catch (err) {
    if (mode === "drive") throw err;
    console.error("drive times unavailable in transit mode:", err);
    drive = { minutesByZcta: new Map(), fromCache: false };
  }
  const areas = withCommuteMode(await loadAreaInputs(drive.minutesByZcta), transitTimes, mode);
  // scoreAreas throws ScoringInputError for bad numbers; callers turn that into a 400.
  const result = scoreAreas(areas, {
    salaryUsd: req.salaryUsd,
    maxCommuteMin: req.maxCommuteMin,
    rentBudgetUsd: req.rentBudgetUsd,
    priorities: req.priorities,
    homeType: req.homeType,
    commuteMode: mode,
  });
  return {
    ok: true,
    areas,
    response: {
      office: { lat: office.lat, lng: office.lng, address: office.normalizedAddress, accuracy: office.accuracyType },
      commuteFromCache: drive.fromCache,
      transitOfficeZcta: transitTimes?.officeZcta ?? null,
      timingMs: Date.now() - started,
      ...result,
    },
  };
}
