import { connection } from "next/server";
import { parseScoreRequest } from "@/lib/scoring/request";
import { runScoring } from "@/lib/scoring/run";
import { ScoringInputError } from "@/lib/scoring/score";

// POST /api/score: geocode office -> commute matrix -> load area data -> deterministic scoring.
export async function POST(req: Request) {
  await connection();

  const parsed = parseScoreRequest(await req.json().catch(() => null));
  if (typeof parsed === "string") return Response.json({ error: parsed }, { status: 400 });

  try {
    const outcome = await runScoring(parsed);
    if (!outcome.ok) return Response.json({ error: outcome.error, field: outcome.field }, { status: outcome.status });
    return Response.json(outcome.response);
  } catch (err) {
    if (err instanceof ScoringInputError) return Response.json({ error: err.message }, { status: 400 });
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Scoring failed: ${message}` }, { status: 502 });
  }
}
