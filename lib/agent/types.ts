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

export type ChatReply = {
  reply: string;
  actions: AgentAction[];
  route: Route;
  intent: Intent | null; // Jev's intent (null if Jev itself failed)
  confidence: number | null;
  latencyMs: number;
};
