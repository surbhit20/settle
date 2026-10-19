// Jev intent classifier for the chat router. Same API as the pipeline's crime classifier
// (pipeline/settle_pipeline/jev.py, decisions.md D034): one "choice" question.

import { INTENTS, type Intent } from "@/lib/agent/types";

export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-1.13.0";

const CRITERIA: Record<Intent, string> = {
  update_filter: "Changes a search filter: rent budget, maximum commute time, salary, home size, or driving vs public transit (e.g. 'what if my budget goes up 300', 'max commute 30 minutes', 'show me 2 bedrooms', 'what if I take the train').",
  set_priority: "Changes how much they care about affordability, commute, safety, or hidden risks (e.g. 'safety matters more to me').",
  compare: "Asks to compare two or more named neighborhoods, cities, or ZIP codes.",
  explain: "Asks why an area is ranked or scored the way it is.",
  area_info: "Asks for information about one named area (rent, risks, crime, what it's like).",
  other: "Anything else: greetings, general questions, unclear requests.",
};

export function intentRequest(message: string) {
  return {
    state: `A user of a neighborhood-finder app for the SF Bay Area typed this chat message: ${message}`,
    model: JEV_MODEL,
    questions: {
      intent: { type: "choice", instructions: "What is the user asking the app to do?", criteria: CRITERIA },
    },
  };
}

export type IntentResult = { intent: Intent; confidence: number };

export function parseIntentAnswer(body: unknown): IntentResult {
  const ans = (body as { answers?: { intent?: { choice?: string; confidence?: number } } }).answers?.intent;
  if (!ans || !INTENTS.includes(ans.choice as Intent) || typeof ans.confidence !== "number") {
    throw new Error("Jev: unexpected intent answer");
  }
  return { intent: ans.choice as Intent, confidence: ans.confidence };
}

export type IntentClassifier = (message: string) => Promise<IntentResult>;

export const jevClassifier: IntentClassifier = async (message) => {
  const key = process.env.JEV_API_KEY;
  if (!key) throw new Error("JEV_API_KEY is not set");
  const res = await fetch(JEV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(intentRequest(message)),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Jev: HTTP ${res.status}`);
  return parseIntentAnswer(await res.json());
};
