import { connection } from "next/server";
import { getCommutes } from "@/lib/commute";
import { geocodeOffice } from "@/lib/geocode";
import { loadAreaInputs } from "@/lib/scoring/loadInputs";
import { ScoringInputError, scoreAreas } from "@/lib/scoring/score";
import { parseScoreRequest } from "@/lib/scoring/request";
import type { UserInputs } from "@/lib/scoring/types";

// POST /api/score: geocode office -> commute matrix -> load area data -> deterministic scoring.
export async function POST(req: Request) {
  await connection();
  const started = Date.now();

  const parsed = parseScoreRequest(await req.json().catch(() => null));
  if (typeof parsed === "string") return Response.json({ error: parsed }, { status: 400 });

  try {
    const office = await geocodeOffice(parsed.officeAddress);
    if (!office.ok) return Response.json({ error: office.message, field: "officeAddress" }, { status: 422 });

    const { minutesByZcta, fromCache } = await getCommutes(office);
    const areas = await loadAreaInputs(minutesByZcta);
    const user: UserInputs = {
      salaryUsd: parsed.salaryUsd,
      maxCommuteMin: parsed.maxCommuteMin,
      rentBudgetUsd: parsed.rentBudgetUsd,
      priorities: parsed.priorities,
    };
    const result = scoreAreas(areas, user);

    return Response.json({
      office: { lat: office.lat, lng: office.lng, address: office.normalizedAddress, accuracy: office.accuracyType },
      commuteFromCache: fromCache,
      timingMs: Date.now() - started,
      ...result,
    });
  } catch (err) {
    if (err instanceof ScoringInputError) return Response.json({ error: err.message }, { status: 400 });
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Scoring failed: ${message}` }, { status: 502 });
  }
}
