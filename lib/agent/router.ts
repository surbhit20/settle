// Chat router (CLAUDE.md section 6): Jev classifies the intent; confident filter, priority and
// compare requests are applied with deterministic parsing and a templated reply (no LLM).
// Everything else, or anything Jev is unsure about or the parser can't read, goes to Claude.
// Dependencies are injected so tests never call Jev or Claude.

import { buildContext } from "@/lib/agent/context";
import { findAreas, parseFilterChange, parsePriorityChange, type AreaRef } from "@/lib/agent/parse";
import type { IntentClassifier, IntentResult } from "@/lib/agent/jev";
import type { LlmResponder } from "@/lib/agent/claude";
import type { AgentAction, ChatReply, Intent } from "@/lib/agent/types";
import type { ScoreRequest } from "@/lib/scoring/request";
import type { ScoreResult, SubScoreKey } from "@/lib/scoring/types";

// Below this Jev confidence, Claude handles the message (CLAUDE.md: start at 0.7; D036).
export const ROUTER_CONFIDENCE = 0.7;
const FAST_INTENTS: Intent[] = ["update_filter", "set_priority", "compare"];

export type RouterDeps = {
  classify: IntentClassifier;
  llm: LlmResponder;
  now?: () => number;
};

export type RouterInput = {
  message: string;
  request: ScoreRequest;
  result: ScoreResult; // the user's current ranking, for replies and grounding
  areas: AreaRef[];
};

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const LABEL: Record<SubScoreKey, string> = {
  affordability: "Affordability",
  commute: "Commute",
  safety: "Safety",
  risks: "Hidden risks",
};

function filterReply(input: RouterInput, changes: NonNullable<ReturnType<typeof parseFilterChange>>): string {
  const parts: string[] = [];
  if (changes.rentBudgetUsd !== undefined) {
    parts.push(`rent budget ${usd(input.result.budgetUsd)} → ${usd(changes.rentBudgetUsd)}/mo`);
  }
  if (changes.maxCommuteMin !== undefined) {
    parts.push(`max commute ${input.request.maxCommuteMin} → ${changes.maxCommuteMin} min`);
  }
  if (changes.salaryUsd !== undefined) parts.push(`salary ${usd(input.request.salaryUsd)} → ${usd(changes.salaryUsd)}`);
  return `Updated: ${parts.join(", ")}. The map is recoloring.`;
}

function priorityReply(before: ScoreRequest["priorities"], after: ScoreRequest["priorities"]): string {
  const k = (Object.keys(after) as SubScoreKey[]).find((key) => after[key] !== before[key])!;
  return `${LABEL[k]} now weighs ${after[k]} of 10 (was ${before[k]}). The map is recoloring.`;
}

// Group the mentioned ZIPs by place and describe each from the current results.
// Returns null if fewer than two places are named (then Claude handles it).
export function compareReply(input: RouterInput, zctas: string[]): { reply: string; zctas: string[] } | null {
  const nameOf = new Map(input.areas.map((a) => [a.zcta, a.name ?? a.zcta]));
  const groups = new Map<string, string[]>();
  for (const z of zctas) {
    const place = nameOf.get(z) ?? z;
    groups.set(place, [...(groups.get(place) ?? []), z]);
  }
  if (groups.size < 2) return null;
  const ranked = new Map(input.result.ranked.map((a) => [a.zcta, a]));
  const lines: string[] = [];
  const shown: string[] = [];
  for (const [place, zs] of groups) {
    const inList = zs.map((z) => ranked.get(z)).filter((a) => a !== undefined).sort((a, b) => a!.rank - b!.rank);
    if (inList.length === 0) {
      lines.push(`${place}: filtered out (${zs.length === 1 ? zs[0] : `${zs.length} ZIPs`}).`);
      shown.push(zs[0]);
      continue;
    }
    const best = inList[0]!;
    const count = zs.length > 1 ? ` (${inList.length} of ${zs.length} ZIPs ranked)` : "";
    lines.push(`${place}: best is ${best.zcta} at #${best.rank}, score ${best.score.toFixed(0)}${count}.`);
    shown.push(best.zcta);
  }
  return { reply: `${lines.join(" ")} Click an area for the full breakdown.`, zctas: shown };
}

// Areas to put in Claude's context. ZIPs the user typed win outright ("Oakland 94612" means
// 94612, not all 15 Oakland ZIPs). For place names, keep the best-ranked ZIPs, up to 8.
export function mentionedAreas(input: RouterInput, max = 8): string[] {
  const typed = [...input.message.matchAll(/\b(9\d{4})\b/g)].map((m) => m[1]);
  const known = new Set(input.areas.map((a) => a.zcta));
  const zips = [...new Set(typed.filter((z) => known.has(z)))];
  if (zips.length) return zips.slice(0, max);
  const rank = new Map(input.result.ranked.map((a) => [a.zcta, a.rank]));
  return findAreas(input.message, input.areas)
    .sort((x, y) => (rank.get(x) ?? Infinity) - (rank.get(y) ?? Infinity) || x.localeCompare(y))
    .slice(0, max);
}

export async function routeMessage(input: RouterInput, deps: RouterDeps): Promise<ChatReply> {
  const now = deps.now ?? Date.now;
  const started = now();
  let jev: IntentResult | null = null;
  try {
    jev = await deps.classify(input.message);
  } catch {
    jev = null; // Jev down: Claude answers, and the log records a null intent
  }

  const done = (route: ChatReply["route"], reply: string, actions: AgentAction[]): ChatReply => ({
    reply,
    actions,
    route,
    intent: jev?.intent ?? null,
    confidence: jev?.confidence ?? null,
    latencyMs: Math.round(now() - started),
  });

  if (jev && jev.confidence >= ROUTER_CONFIDENCE && FAST_INTENTS.includes(jev.intent)) {
    if (jev.intent === "update_filter") {
      const changes = parseFilterChange(input.message, {
        salaryUsd: input.request.salaryUsd,
        maxCommuteMin: input.request.maxCommuteMin,
        budgetUsd: input.result.budgetUsd,
      });
      if (changes) return done("jev", filterReply(input, changes), [{ type: "update_filter", changes }]);
    }
    if (jev.intent === "set_priority") {
      const next = parsePriorityChange(input.message, input.request.priorities);
      if (next) return done("jev", priorityReply(input.request.priorities, next), [{ type: "set_priority", priorities: next }]);
    }
    if (jev.intent === "compare") {
      const c = compareReply(input, findAreas(input.message, input.areas));
      if (c) return done("jev", c.reply, [{ type: "compare", zctas: c.zctas }]);
    }
  }

  const mentioned = mentionedAreas(input);
  const { reply, actions } = await deps.llm(input.message, buildContext(input.request, input.result, mentioned));
  return done("llm", reply, actions);
}
