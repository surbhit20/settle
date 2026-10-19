import { connection } from "next/server";
import { claudeResponder } from "@/lib/agent/claude";
import { jevClassifier } from "@/lib/agent/jev";
import { logAgentMessage } from "@/lib/agent/log";
import { routeMessage } from "@/lib/agent/router";
import { parseViewState } from "@/lib/agent/types";
import { parseScoreRequest } from "@/lib/scoring/request";
import { runScoring } from "@/lib/scoring/run";
import { ScoringInputError } from "@/lib/scoring/score";

const MAX_MESSAGE = 500;

// POST /api/chat { message, request }: route one chat message (CLAUDE.md section 6).
// Re-runs scoring for the user's current inputs (geocode and commute are cached, so this is
// fast and free) to ground the reply, then Jev routes it; Claude only when needed.
export async function POST(req: Request) {
  await connection();
  const body = (await req.json().catch(() => null)) as { message?: unknown; request?: unknown; view?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message || message.length > MAX_MESSAGE) {
    return Response.json({ error: `Message must be 1-${MAX_MESSAGE} characters.` }, { status: 400 });
  }
  const request = parseScoreRequest(body?.request);
  if (typeof request === "string") return Response.json({ error: request }, { status: 400 });
  const view = parseViewState(body?.view); // the open area card and compared areas, if any

  try {
    const outcome = await runScoring(request);
    if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });

    const reply = await routeMessage(
      {
        message,
        request,
        result: outcome.response,
        areas: outcome.areas.map((a) => ({ zcta: a.zcta, name: a.name })),
        inputs: outcome.areas,
        view,
      },
      { classify: jevClassifier, llm: claudeResponder },
    );
    // Logging must never break the chat; it's for later reporting (CLAUDE.md section 6.4).
    await logAgentMessage(message, reply).catch(() => undefined);
    return Response.json(reply);
  } catch (err) {
    if (err instanceof ScoringInputError) return Response.json({ error: err.message }, { status: 400 });
    // Log the real error for us; show the user a plain message, never raw API text.
    console.error("chat failed:", err);
    return Response.json(
      { error: "Sorry, I couldn't answer that just now. Try again, or ask about budget, commute, safety or a specific area." },
      { status: 502 },
    );
  }
}
