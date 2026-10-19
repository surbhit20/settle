// Chat router (CLAUDE.md section 6): Jev classifies the intent; confident filter, priority and
// compare requests are applied with deterministic parsing and a templated reply (no LLM).
// Everything else, or anything Jev is unsure about or the parser can't read, goes to Claude.
// Dependencies are injected so tests never call Jev or Claude.

import { buildContext } from "@/lib/agent/context";
import { findAreas, parseFilterChange, parsePriorityChange, type AreaRef } from "@/lib/agent/parse";
import type { IntentClassifier, IntentResult } from "@/lib/agent/jev";
import type { LlmResponder } from "@/lib/agent/claude";
import { EMPTY_VIEW, type AgentAction, type ChatReply, type Intent, type ViewState } from "@/lib/agent/types";
import type { ScoreRequest } from "@/lib/scoring/request";
import { HOME_TYPES } from "@/lib/scoring/config";
import { rentFor } from "@/lib/scoring/score";
import type { AreaInputs, ScoreResult, SubScoreKey } from "@/lib/scoring/types";

// Below this Jev confidence, Claude handles the message (CLAUDE.md: start at 0.7; D036).
export const ROUTER_CONFIDENCE = 0.7;
const FAST_INTENTS: Intent[] = ["update_filter", "set_priority", "compare"];
// The fast compare reply covers rank, score, rent and commute. A comparison about anything else
// ("is this safer than San Jose?") goes to Claude, which has the safety and risk breakdowns.
const COMPARE_NEEDS_CLAUDE = /\b(safe\w*|crime\w*|risk\w*|flood\w*|fire\w*|earthquake\w*|seismic|dams?|why|explain\w*|schools?)\b/i;

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
  inputs?: AreaInputs[]; // full area data, so Claude can describe filtered-out areas too
  view?: ViewState; // what's on screen: the open area card and compared areas
};

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const LABEL: Record<SubScoreKey, string> = {
  affordability: "Affordability",
  commute: "Commute",
  safety: "Safety",
  risks: "Hidden risks",
};

// Plain replies for the fast path: "Updated rent budget from $4,675 to $5,675 per month."
function filterReply(input: RouterInput, changes: NonNullable<ReturnType<typeof parseFilterChange>>): string {
  const parts: string[] = [];
  if (changes.rentBudgetUsd !== undefined) {
    parts.push(`rent budget from ${usd(input.result.budgetUsd)} to ${usd(changes.rentBudgetUsd)} per month`);
  }
  if (changes.maxCommuteMin !== undefined) {
    parts.push(`max commute from ${input.request.maxCommuteMin} to ${changes.maxCommuteMin} minutes`);
  }
  if (changes.salaryUsd !== undefined) parts.push(`salary from ${usd(input.request.salaryUsd)} to ${usd(changes.salaryUsd)}`);
  if (changes.homeType !== undefined) {
    const from = HOME_TYPES[input.request.homeType ?? "any"].label.toLowerCase();
    parts.push(`home size from ${from} to ${HOME_TYPES[changes.homeType].label.toLowerCase()}`);
  }
  if (changes.commuteMode !== undefined) {
    const label = { drive: "driving", transit: "public transit" } as const;
    parts.push(`commute from ${label[input.request.commuteMode ?? "drive"]} to ${label[changes.commuteMode]}`);
  }
  return `Updated ${parts.join(", ")}.`;
}

function priorityReply(before: ScoreRequest["priorities"], after: ScoreRequest["priorities"]): string {
  const k = (Object.keys(after) as SubScoreKey[]).find((key) => after[key] !== before[key])!;
  return `Updated ${LABEL[k].toLowerCase()} priority from ${before[k]} to ${after[k]} out of 10.`;
}

// Rent for the user's home size and drive time for one ZIP, plus the difference from the first
// place in the comparison ("$600 less", "14 min more"). Empty if the area data isn't loaded.
function rentAndCommute(input: RouterInput, zcta: string, base: AreaInputs | undefined): string {
  const area = input.inputs?.find((a) => a.zcta === zcta);
  if (!area) return "";
  const homeType = input.request.homeType ?? "any";
  const rent = rentFor(area, homeType).usd;
  const baseRent = base ? rentFor(base, homeType).usd : null;
  const what = homeType === "any" ? "typical rent" : `${HOME_TYPES[homeType].short} rent`;
  const parts: string[] = [];
  if (rent !== null) {
    const diff = baseRent !== null && base !== area ? rent - baseRent : 0;
    const delta = Math.abs(diff) >= 1 ? ` (${usd(Math.abs(diff))} ${diff > 0 ? "more" : "less"})` : "";
    parts.push(`${what} ${usd(rent)}/mo${delta}`);
  } else {
    parts.push(`no ${what} data`);
  }
  if (area.commuteMin !== null) {
    const diff = base?.commuteMin != null && base !== area ? Math.round(area.commuteMin) - Math.round(base.commuteMin) : 0;
    const delta = diff !== 0 ? ` (${Math.abs(diff)} min ${diff > 0 ? "more" : "less"})` : "";
    parts.push(`about ${Math.round(area.commuteMin)} min drive${delta}`);
  }
  return parts.length ? `; ${parts.join(", ")}` : "";
}

// Group the ZIPs by place and describe each from the current results: rank, score, rent for the
// user's home size and drive time, with differences against the first place. A ZIP passed as
// `pinned` (the area open on screen) stays its own group, so "compare it with San Jose" compares
// that exact ZIP. Returns null if fewer than two places are given (then Claude handles it).
export function compareReply(
  input: RouterInput,
  zctas: string[],
  pinned: string | null = null,
): { reply: string; zctas: string[] } | null {
  const nameOf = new Map(input.areas.map((a) => [a.zcta, a.name ?? a.zcta]));
  // Map keeps insertion order, so the pinned area (added first) is the baseline for differences.
  const groups = new Map<string, string[]>();
  if (pinned) groups.set(`${nameOf.get(pinned) ?? pinned} ${pinned}`, [pinned]);
  for (const z of zctas) {
    if (z === pinned) continue;
    const place = nameOf.get(z) ?? z;
    groups.set(place, [...(groups.get(place) ?? []), z]);
  }
  if (groups.size < 2) return null;
  const ranked = new Map(input.result.ranked.map((a) => [a.zcta, a]));
  const lines: string[] = [];
  const shown: string[] = [];
  let base: AreaInputs | undefined;
  for (const [place, zs] of groups) {
    const inList = zs.map((z) => ranked.get(z)).filter((a) => a !== undefined).sort((a, b) => a!.rank - b!.rank);
    const pick = inList[0]?.zcta ?? zs[0];
    const extra = rentAndCommute(input, pick, base);
    base ??= input.inputs?.find((a) => a.zcta === pick); // `??=`: set only the first time
    shown.push(pick);
    if (inList.length === 0) {
      lines.push(`${place}: filtered out (${zs.length === 1 ? zs[0] : `${zs.length} ZIPs`})${extra}.`);
      continue;
    }
    const best = inList[0]!;
    const count = zs.length > 1 ? ` (${inList.length} of ${zs.length} ZIPs ranked)` : "";
    const head = zs.length > 1 ? `best is ${best.zcta} at #${best.rank}` : `#${best.rank}`;
    lines.push(`${place}: ${head}, score ${best.score.toFixed(0)}${count}${extra}.`);
  }
  return { reply: `${lines.join(" ")} Click an area for the full breakdown.`, zctas: shown };
}

// Areas to put in Claude's context. The area open on screen always comes first, then compared
// areas, then what the message names. ZIPs the user typed win over place names ("Oakland 94612"
// means 94612, not all 15 Oakland ZIPs). For place names, keep the best-ranked ZIPs. Up to 8.
export function mentionedAreas(input: RouterInput, max = 8): string[] {
  const known = new Set(input.areas.map((a) => a.zcta));
  const view = input.view ?? EMPTY_VIEW;
  const onScreen = [view.selectedZcta, ...view.compared].filter((z): z is string => !!z && known.has(z));
  const typed = [...input.message.matchAll(/\b(9\d{4})\b/g)].map((m) => m[1]).filter((z) => known.has(z));
  const rank = new Map(input.result.ranked.map((a) => [a.zcta, a.rank]));
  const named = typed.length
    ? typed
    : findAreas(input.message, input.areas).sort(
        (x, y) => (rank.get(x) ?? Infinity) - (rank.get(y) ?? Infinity) || x.localeCompare(y),
      );
  return [...new Set([...onScreen, ...named])].slice(0, max);
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
    if (jev.intent === "compare" && !COMPARE_NEEDS_CLAUDE.test(input.message)) {
      const named = findAreas(input.message, input.areas);
      // Two named places: compare those. One named place: compare it with the open area ("it").
      const selected = input.view?.selectedZcta ?? null;
      const c = compareReply(input, named) ?? (selected ? compareReply(input, named, selected) : null);
      if (c) return done("jev", c.reply, [{ type: "compare", zctas: c.zctas }]);
    }
  }

  const mentioned = mentionedAreas(input);
  const context = buildContext(input.request, input.result, mentioned, input.inputs, input.view);
  const { reply, actions } = await deps.llm(input.message, context);
  return done("llm", reply, actions);
}
