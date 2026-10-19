import type { FilterChanges } from "@/lib/agent/parse";
import type { Priorities } from "@/lib/scoring/types";

// The six intents Jev chooses between (CLAUDE.md section 6.1).
export type Intent = "update_filter" | "set_priority" | "compare" | "explain" | "area_info" | "other";
export const INTENTS: Intent[] = ["update_filter", "set_priority", "compare", "explain", "area_info", "other"];

// What the browser does with a reply. Both routes (Jev fast path and Claude) emit these same
// shapes, so the UI doesn't care which one answered.
export type AgentAction =
  | { type: "update_filter"; changes: FilterChanges }
  | { type: "set_priority"; priorities: Priorities }
  | { type: "compare"; zctas: string[] }
  | { type: "select_area"; zcta: string };

export type Route = "jev" | "llm";

// What the user has on screen when they send a message, so "it", "this" or "here" can be
// resolved: the area card that's open, and the areas outlined by the last comparison.
export type ViewState = {
  selectedZcta: string | null;
  compared: string[];
};

export const EMPTY_VIEW: ViewState = { selectedZcta: null, compared: [] };

const ZIP = /^9\d{4}$/;

// Validates the untrusted `view` object from the browser. Bad or missing parts become empty.
export function parseViewState(raw: unknown): ViewState {
  const v = (raw ?? {}) as { selectedZcta?: unknown; compared?: unknown };
  const selectedZcta = typeof v.selectedZcta === "string" && ZIP.test(v.selectedZcta) ? v.selectedZcta : null;
  const compared = Array.isArray(v.compared)
    ? [...new Set(v.compared.filter((z): z is string => typeof z === "string" && ZIP.test(z)))].slice(0, 8)
    : [];
  return { selectedZcta, compared };
}

export type ChatReply = {
  reply: string;
  actions: AgentAction[];
  route: Route;
  intent: Intent | null; // Jev's intent (null if Jev itself failed)
  confidence: number | null;
  latencyMs: number;
};
