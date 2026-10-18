// Deterministic parsers for chat messages Jev routes to a fast path (CLAUDE.md section 6.2).
// They turn "what if my budget goes up 300" into an exact change, with no LLM call. When a
// parser can't find what it needs it returns null, and the router falls back to Claude.

import type { Priorities, SubScoreKey } from "@/lib/scoring/types";
import { SCORING } from "@/lib/scoring/config";

export type FilterChanges = {
  salaryUsd?: number;
  maxCommuteMin?: number;
  rentBudgetUsd?: number;
};

// Current values the parser needs to apply relative changes ("up 300").
export type FilterBaseline = { salaryUsd: number; maxCommuteMin: number; budgetUsd: number };

// "$3,500" -> 3500, "3.5k" -> 3500, "200k" -> 200000, "300" -> 300.
export function parseAmount(raw: string): number | null {
  const m = raw.trim().toLowerCase().match(/^\$?\s*([\d,]*\.?\d+)\s*(k|thousand)?$/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return m[2] ? n * 1000 : n;
}

const NUM = String.raw`\$?\s*[\d,]*\.?\d+\s*(?:k|thousand)?`;
const UP = String.raw`(?:up|increase[sd]?|raise[sd]?|goes up|go up|more|higher|bump(?:ed)?(?: up)?|add(?:ed)?)`;
const DOWN = String.raw`(?:down|decrease[sd]?|lower(?:ed)?|drop(?:s|ped)?|cut|less|reduce[sd]?|goes down|go down)`;

function find(msg: string, re: RegExp): RegExpMatchArray | null {
  return msg.match(re);
}

// Topic words for each filter. "rent"/"budget" both mean the monthly rent budget.
const TOPICS = {
  rentBudgetUsd: String.raw`(?:rent(?: budget)?|budget)`,
  maxCommuteMin: String.raw`(?:max(?:imum)? commute|commute(?: time| limit)?|drive(?: time)?)`,
  salaryUsd: String.raw`(?:salary|pay|income)`,
} as const;

// One topic: a relative change ("budget up 300", "300 more for rent") or an absolute value
// ("budget to 3500", "max commute 30"). Returns the new absolute value or null.
function parseTopic(msg: string, topic: string, current: number): number | null {
  // [pattern, true if the amount is captured before the direction word]
  const rel: [RegExp, boolean][] = [
    [new RegExp(String.raw`${topic}\b[^.\d$]*?\b(${UP}|${DOWN})\b[^.\d$]*?(${NUM})`, "i"), false], // budget goes up by 300
    [new RegExp(String.raw`\b(${UP}|${DOWN})\b[^.\d$]*?${topic}\b[^.\d$]*?(${NUM})`, "i"), false], // raise my budget by 300
    [new RegExp(String.raw`${topic}\b[^.\d$]*?(${NUM})\s*(${UP}|${DOWN})\b`, "i"), true], // drive 15 more minutes
    [new RegExp(String.raw`(${NUM})\s*(${UP}|${DOWN})\b[^.\d$]*?${topic}`, "i"), true], // 300 more for rent
  ];
  for (const [re, amountFirst] of rel) {
    const m = find(msg, re);
    if (!m) continue;
    const [dirWord, amountRaw] = amountFirst ? [m[2], m[1]] : [m[1], m[2]];
    const amount = parseAmount(amountRaw);
    if (amount === null) continue;
    const down = new RegExp(`^${DOWN}$`, "i").test(dirWord.trim());
    return current + (down ? -amount : amount);
  }
  const abs = [
    new RegExp(String.raw`${topic}\b[^.\d$]*?\b(?:to|of|is|at|=|be|under|below|max)\b\s*(${NUM})`, "i"), // budget to 3500
    new RegExp(String.raw`${topic}\s*(?:of\s*)?(${NUM})`, "i"), // max commute 30
    new RegExp(String.raw`(${NUM})\s*(?:\/\s*mo(?:nth)?|a month|per month)?\s*(?:rent )?${topic}`, "i"), // $3500 budget
  ];
  for (const re of abs) {
    const m = find(msg, re);
    if (!m) continue;
    const v = parseAmount(m[1]);
    if (v !== null) return v;
  }
  return null;
}

export function parseFilterChange(message: string, base: FilterBaseline): FilterChanges | null {
  const msg = message.replace(/minutes?|mins?\b/gi, "").replace(/\s+/g, " ");
  const changes: FilterChanges = {};

  const budget = parseTopic(msg, TOPICS.rentBudgetUsd, base.budgetUsd);
  if (budget !== null && budget > 0) changes.rentBudgetUsd = Math.round(budget);

  const commute = parseTopic(msg, TOPICS.maxCommuteMin, base.maxCommuteMin);
  if (commute !== null && commute > 0 && commute <= 240) changes.maxCommuteMin = Math.round(commute);

  const salary = parseTopic(msg, TOPICS.salaryUsd, base.salaryUsd);
  // "salary 200" almost certainly means $200k; anything under 1,000 a year is treated that way.
  if (salary !== null && salary > 0) changes.salaryUsd = Math.round(salary < 1000 ? salary * 1000 : salary);

  return Object.keys(changes).length > 0 ? changes : null;
}

// ---------- Priorities ----------

const PRIORITY_WORDS: Record<SubScoreKey, RegExp> = {
  affordability: /\b(afford\w*|cheap\w*|rent|cost|price\w*|money)\b/i,
  commute: /\b(commut\w*|drive|driving|traffic|close to (?:work|the office)|travel)\b/i,
  safety: /\b(safe\w*|crime|dangerous|security)\b/i,
  risks: /\b(risk\w*|flood\w*|fire|wildfire|earthquake\w*|quake|hazard\w*|dam|chemical)\b/i,
};

const MORE = /\b(more|most|top|higher|priori\w*|focus|matters? (?:a lot|most)|really care|important|weight)\b/i;
const LESS = /\b(less|least|lower|don'?t care|do not care|doesn'?t matter|ignore|not important|deprioriti\w*)\b/i;
const STEP = 3;

// "I care more about safety" -> safety +3 (max 10). "commute doesn't matter" -> commute 0.
// Returns the full new priorities, or null if no single topic and direction is clear.
export function parsePriorityChange(message: string, current: Priorities): Priorities | null {
  const keys = (Object.keys(PRIORITY_WORDS) as SubScoreKey[]).filter((k) => PRIORITY_WORDS[k].test(message));
  if (keys.length !== 1) return null; // zero or several topics: let Claude interpret
  const key = keys[0];
  const less = LESS.test(message);
  const more = MORE.test(message);
  if (less === more) return null; // no direction, or both
  const max = SCORING.priorityMax;
  const ignore = /\b(don'?t care|do not care|doesn'?t matter|ignore)\b/i.test(message);
  const next = { ...current };
  next[key] = ignore ? 0 : Math.min(max, Math.max(0, current[key] + (more ? STEP : -STEP)));
  if (next[key] === current[key]) return null;
  return next;
}

// ---------- Areas ----------

export type AreaRef = { zcta: string; name: string | null };

// Every area the message names, by ZIP ("94110") or by place name ("Milpitas"), longest names
// first so "South San Francisco" isn't read as "San Francisco". A name shared by several ZIPs
// (e.g. "San Jose") returns all of them.
export function findAreas(message: string, areas: AreaRef[]): string[] {
  const found = new Set<string>();
  const valid = new Set(areas.map((a) => a.zcta));
  for (const m of message.matchAll(/\b(9\d{4})\b/g)) if (valid.has(m[1])) found.add(m[1]);

  let rest = message.toLowerCase();
  const names = [...new Set(areas.map((a) => a.name).filter((n): n is string => !!n && !n.startsWith("Unincorporated")))]
    .sort((a, b) => b.length - a.length);
  for (const name of names) {
    const re = new RegExp(String.raw`\b${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\b`);
    if (re.test(rest)) {
      for (const a of areas) if (a.name === name) found.add(a.zcta);
      rest = rest.replace(re, " "); // consume, so a shorter overlapping name doesn't match too
    }
  }
  return [...found].sort();
}
