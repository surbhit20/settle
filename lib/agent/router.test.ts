import { describe, expect, it, vi } from "vitest";
import { toolToAction, type LlmResponder } from "@/lib/agent/claude";
import { buildContext } from "@/lib/agent/context";
import { intentRequest, parseIntentAnswer } from "@/lib/agent/jev";
import { ROUTER_CONFIDENCE, routeMessage, type RouterInput } from "@/lib/agent/router";
import { parseViewState, type Intent } from "@/lib/agent/types";
import type { AreaInputs, ScoredArea, ScoreResult } from "@/lib/scoring/types";

function scored(zcta: string, name: string, rank: number, score: number): ScoredArea {
  const sub = { score: 80, explanation: "x", inputs: {}, sources: [{ name: "Src", url: "https://s" }] };
  return {
    rank, zcta, name, county: "C", score, partial: false, missing: [],
    weightsUsed: { affordability: 0.25, commute: 0.25, safety: 0.25, risks: 0.25 },
    subScores: { affordability: sub, commute: sub, safety: sub, risks: sub },
  };
}

const result: ScoreResult = {
  homeType: "any",
  monthlyIncomeUsd: 15000,
  budgetUsd: 4500,
  budgetDerived: true,
  ranked: [scored("94110", "San Francisco", 1, 90), scored("95035", "Milpitas", 7, 70), scored("94112", "San Francisco", 3, 85)],
  filtered: [{ zcta: "94301", name: "Palo Alto", county: "C", reason: "rent_over_budget", detail: "too pricey" }],
  unavailableEverywhere: [],
};

const input = (message: string): RouterInput => ({
  message,
  request: {
    salaryUsd: 180_000, officeAddress: "1 Market St", maxCommuteMin: 45, rentBudgetUsd: null,
    priorities: { affordability: 5, commute: 5, safety: 5, risks: 5 },
  },
  result,
  areas: [
    { zcta: "94110", name: "San Francisco" }, { zcta: "94112", name: "San Francisco" },
    { zcta: "95035", name: "Milpitas" }, { zcta: "94301", name: "Palo Alto" },
  ],
});

function deps(intent: Intent, confidence = 0.95) {
  const llm = vi.fn<LlmResponder>(async () => ({ reply: "from claude", actions: [] }));
  return { classify: async () => ({ intent, confidence }), llm, now: () => 0 };
}

describe("routeMessage", () => {
  it("'what if my budget goes up 300' updates the filter with no LLM call", async () => {
    const d = deps("update_filter");
    const r = await routeMessage(input("what if my budget goes up 300"), d);
    expect(r.route).toBe("jev");
    expect(r.actions).toEqual([{ type: "update_filter", changes: { rentBudgetUsd: 4800 } }]);
    expect(r.reply).toBe("Updated rent budget from $4,500 to $4,800 per month.");
    expect(d.llm).not.toHaveBeenCalled();
  });

  it("sets a priority on the fast path", async () => {
    const r = await routeMessage(input("I care more about safety"), deps("set_priority"));
    expect(r.route).toBe("jev");
    expect(r.actions[0]).toEqual({ type: "set_priority", priorities: { affordability: 5, commute: 5, safety: 8, risks: 5 } });
    expect(r.reply).toBe("Updated safety priority from 5 to 8 out of 10.");
  });

  it("compares places deterministically, best ZIP per place", async () => {
    const r = await routeMessage(input("compare Milpitas and San Francisco"), deps("compare"));
    expect(r.route).toBe("jev");
    expect(r.actions).toEqual([{ type: "compare", zctas: ["94110", "95035"] }]);
    expect(r.reply).toContain("San Francisco: best is 94110 at #1, score 90 (2 of 2 ZIPs ranked).");
    expect(r.reply).toContain("Milpitas: #7, score 70.");
  });

  it("says when a compared place was filtered out", async () => {
    const r = await routeMessage(input("Palo Alto vs Milpitas"), deps("compare"));
    expect(r.reply).toContain("Palo Alto: filtered out (94301).");
  });

  it("sends explain questions to Claude with grounding for the named area", async () => {
    const d = deps("explain");
    const r = await routeMessage(input("why is Milpitas ranked low"), d);
    expect(r.route).toBe("llm");
    expect(r.reply).toBe("from claude");
    const context = d.llm.mock.calls[0][1] as { mentioned_areas: { zcta: string }[] };
    expect(context.mentioned_areas.map((a) => a.zcta)).toEqual(["95035"]);
  });

  it(`falls back to Claude when Jev's confidence is below ${ROUTER_CONFIDENCE}`, async () => {
    const r = await routeMessage(input("what if my budget goes up 300"), deps("update_filter", 0.69));
    expect(r.route).toBe("llm");
    expect(r.confidence).toBe(0.69);
  });

  it("falls back to Claude when the parser can't read a fast-path message", async () => {
    const r = await routeMessage(input("increase my budget a bit"), deps("update_filter"));
    expect(r.route).toBe("llm");
  });

  it("falls back to Claude when Jev is down, logging a null intent", async () => {
    const d = { classify: async () => { throw new Error("down"); }, llm: vi.fn(async () => ({ reply: "ok", actions: [] })) };
    const r = await routeMessage(input("budget up 300"), d);
    expect(r.route).toBe("llm");
    expect(r.intent).toBeNull();
  });
});

describe("Jev intent helpers", () => {
  it("asks one choice question over all six intents", () => {
    const q = intentRequest("hi").questions.intent;
    expect(q.type).toBe("choice");
    expect(Object.keys(q.criteria).sort()).toEqual(["area_info", "compare", "explain", "other", "set_priority", "update_filter"]);
  });

  it("parses the answer and rejects unknown intents", () => {
    expect(parseIntentAnswer({ answers: { intent: { choice: "compare", confidence: 0.9 } } })).toEqual({ intent: "compare", confidence: 0.9 });
    expect(() => parseIntentAnswer({ answers: { intent: { choice: "dance", confidence: 1 } } })).toThrow();
  });
});

describe("toolToAction", () => {
  it("keeps only the filters Claude actually changed", () => {
    expect(toolToAction("update_filter", { rent_budget_usd: 3800, max_commute_min: null, salary_usd: null }))
      .toEqual({ type: "update_filter", changes: { rentBudgetUsd: 3800 } });
    expect(toolToAction("update_filter", { rent_budget_usd: null, max_commute_min: null, salary_usd: null })).toBeNull();
  });

  it("validates ZIPs and requires two for a comparison", () => {
    expect(toolToAction("compare_areas", { zctas: ["94110", "nope", "95035"] })).toEqual({ type: "compare", zctas: ["94110", "95035"] });
    expect(toolToAction("compare_areas", { zctas: ["94110"] })).toBeNull();
    expect(toolToAction("select_area", { zcta: "9411" })).toBeNull();
  });

  it("clamps priorities to 0..10", () => {
    expect(toolToAction("set_priority", { affordability: 12, commute: -1, safety: 5, risks: 5 }))
      .toEqual({ type: "set_priority", priorities: { affordability: 10, commute: 0, safety: 5, risks: 5 } });
  });
});

describe("buildContext", () => {
  it("includes inputs, top 5, and mentioned areas (scored or filtered) with sources", () => {
    const c = buildContext(input("x").request, result, ["95035", "94301", "99999"]);
    expect(c.budget_used_usd).toBe(4500);
    expect(c.top_5).toHaveLength(3);
    expect(c.mentioned_areas[0]).toMatchObject({ zcta: "95035", rank: 7 });
    expect(c.mentioned_areas[1]).toMatchObject({ zcta: "94301", filtered_out: "rent_over_budget" });
    expect(c.mentioned_areas[2]).toMatchObject({ zcta: "99999", note: "not in the results" });
    expect(JSON.stringify(c.top_5[0].sub_scores.affordability.sources)).toContain("Src <https://s>");
  });
});

import { contextNumbers, numbersIn, ungroundedNumbers } from "@/lib/agent/grounding";

describe("grounding check", () => {
  const ctx = {
    rent: 4486.4,
    share_pct: 29.91,
    weights: { safety: 0.25 },
    note: "About 17 min drive; office 1 Market St; 94121",
    rate: 22.8,
  };

  it("reads numbers with $, commas, decimals and %", () => {
    expect(numbersIn("Rent $4,486/mo is 29.9% of $15,000.")).toEqual([4486, 29.9, 15000]);
  });

  it("collects numbers from nested values and strings", () => {
    expect(contextNumbers(ctx)).toEqual(expect.arrayContaining([4486.4, 29.91, 0.25, 17, 1, 94121, 22.8]));
  });

  it("accepts numbers that match or round to context values, and fractions written as percents", () => {
    expect(ungroundedNumbers("Rent is $4,486 (29.9%), 17 min, 22.8 per 1,000... wait 94121 safety 25%", { ...ctx, per: 1000 })).toEqual([]);
  });

  it("flags numbers that aren't in the context", () => {
    expect(ungroundedNumbers("Typical rent is $3,518, about 40% of income.", ctx)).toEqual([3518, 40]);
  });

  it("ignores single-digit counting words", () => {
    expect(ungroundedNumbers("All 5 flags are clear; 2 of 4 parts.", ctx)).toEqual([]);
  });
});

import { mentionedAreas } from "@/lib/agent/router";

describe("mentionedAreas", () => {
  it("uses typed ZIPs exactly, even when a place name also matches", () => {
    const i = input("why is Oakland 94612 ranked where it is?");
    i.areas.push({ zcta: "94612", name: "Oakland" }, { zcta: "94601", name: "Oakland" });
    expect(mentionedAreas(i)).toEqual(["94612"]);
  });

  it("orders a place's ZIPs by rank and caps the list", () => {
    expect(mentionedAreas(input("how is San Francisco?"))).toEqual(["94110", "94112"]); // ranks 1 and 3
    expect(mentionedAreas(input("how is San Francisco?"), 1)).toEqual(["94110"]);
  });
});

describe("home size on the fast path", () => {
  it("'what if I get a 2 bedroom' changes the home size with no LLM call", async () => {
    const d = deps("update_filter");
    const r = await routeMessage(input("what if I get a 2 bedroom"), d);
    expect(r.route).toBe("jev");
    expect(r.actions).toEqual([{ type: "update_filter", changes: { homeType: "2br" } }]);
    expect(r.reply).toBe("Updated home size from any size (typical home) to 2 bedrooms.");
    expect(d.llm).not.toHaveBeenCalled();
  });

  it("Claude's update_filter tool can set the home size", () => {
    expect(toolToAction("update_filter", { rent_budget_usd: null, max_commute_min: null, salary_usd: null, home_type: "studio" }))
      .toEqual({ type: "update_filter", changes: { homeType: "studio" } });
    expect(toolToAction("update_filter", { rent_budget_usd: null, max_commute_min: null, salary_usd: null, home_type: "castle" })).toBeNull();
  });
});

describe("buildContext facts for filtered-out areas", () => {
  it("includes population, neighborhood crime rate and rents even when an area was filtered", () => {
    const inputs = [{
      zcta: "94301", name: "Palo Alto", county: "C", rentUsd: 4219, rentSource: null, commuteMin: 30,
      commuteSource: { name: "ORS", url: "u" }, crimeRatePer1000: 18.24,
      crimeSource: { name: "Some PD", url: "https://pd" }, risks: [], population: 17508,
      rentsBySize: { "2br": { usd: 4100, source: null } },
    }];
    const c = buildContext(input("x").request, result, ["94301"], inputs);
    expect(c.mentioned_areas[0]).toMatchObject({
      zcta: "94301",
      filtered_out: "rent_over_budget",
      facts: { population: 17508, neighborhood_crime_rate_per_1000: 18.2, typical_rent_usd: 4219, rent_by_size_usd: { "2br": 4100 } },
    });
  });
});

// Area data for the on-screen tests: Los Altos (open on screen) and two San Jose ZIPs.
function area(zcta: string, name: string, rentUsd: number | null, commuteMin: number | null): AreaInputs {
  return {
    zcta, name, county: "Santa Clara", rentUsd, rentSource: null, commuteMin,
    commuteSource: { name: "ORS", url: "u" }, crimeRatePer1000: null, crimeSource: null, risks: [], population: 30000,
    rentsBySize: { "1br": { usd: rentUsd === null ? null : rentUsd - 1000, source: null } },
  };
}

const viewResult: ScoreResult = {
  ...result,
  ranked: [scored("94022", "Los Altos", 2, 88), scored("95125", "San Jose", 9, 74), scored("95112", "San Jose", 15, 66)],
  filtered: [],
};

const viewInput = (message: string, selectedZcta: string | null): RouterInput => ({
  ...input(message),
  result: viewResult,
  areas: [
    { zcta: "94022", name: "Los Altos" }, { zcta: "95125", name: "San Jose" }, { zcta: "95112", name: "San Jose" },
  ],
  inputs: [area("94022", "Los Altos", 4200, 9), area("95125", "San Jose", 3500, 24), area("95112", "San Jose", 3000, 27)],
  view: { selectedZcta, compared: [] },
});

describe("what's on screen", () => {
  it("'compare it with San Jose' compares the open area, with rent and commute differences", async () => {
    const d = deps("compare");
    const r = await routeMessage(viewInput("compare it with San Jose for rent and commute", "94022"), d);
    expect(r.route).toBe("jev");
    expect(r.actions).toEqual([{ type: "compare", zctas: ["94022", "95125"] }]);
    expect(r.reply).toContain("Los Altos 94022: #2, score 88; typical rent $4,200/mo, about 9 min drive.");
    expect(r.reply).toContain(
      "San Jose: best is 95125 at #9, score 74 (2 of 2 ZIPs ranked); typical rent $3,500/mo ($700 less), about 24 min drive (15 min more).",
    );
    expect(d.llm).not.toHaveBeenCalled();
  });

  it("uses the rent for the user's home size", async () => {
    const i = viewInput("compare it with San Jose", "94022");
    i.request = { ...i.request, homeType: "1br" };
    const r = await routeMessage(i, deps("compare"));
    expect(r.reply).toContain("1-bedroom rent $3,200/mo");
    expect(r.reply).toContain("1-bedroom rent $2,500/mo ($700 less)");
  });

  it("a comparison about safety goes to Claude, with the open area in context", async () => {
    const d = deps("compare");
    const r = await routeMessage(viewInput("is this area safer than San Jose?", "94022"), d);
    expect(r.route).toBe("llm");
    const context = d.llm.mock.calls[0][1] as { on_screen: unknown; mentioned_areas: { zcta: string }[] };
    expect(context.on_screen).toEqual({ selected_area: "94022", compared_areas: [] });
    expect(context.mentioned_areas[0].zcta).toBe("94022");
  });

  it("with nothing open, one named place still goes to Claude", async () => {
    const d = deps("compare");
    const r = await routeMessage(viewInput("compare it with San Jose", null), d);
    expect(r.route).toBe("llm");
  });

  it("puts the open area first in Claude's context, with precomputed differences", async () => {
    const i = viewInput("is this area cheaper than San Jose?", "94022");
    expect(mentionedAreas(i)).toEqual(["94022", "95125", "95112"]);
    const c = buildContext(i.request, i.result, mentionedAreas(i), i.inputs, i.view);
    expect(c.on_screen).toEqual({ selected_area: "94022", compared_areas: [] });
    expect(c.mentioned_areas[1]).toMatchObject({
      zcta: "95125",
      vs_selected_area: { compared_with: "94022", rent_difference_usd_per_month: -700, commute_difference_min: 15 },
    });
    expect(c.mentioned_areas[0]).not.toHaveProperty("vs_selected_area");
  });

  it("validates the view sent by the browser", () => {
    expect(parseViewState({ selectedZcta: "94022", compared: ["95125", "95125", "nope", 7] })).toEqual({
      selectedZcta: "94022",
      compared: ["95125"],
    });
    expect(parseViewState({ selectedZcta: "<script>" })).toEqual({ selectedZcta: null, compared: [] });
    expect(parseViewState(undefined)).toEqual({ selectedZcta: null, compared: [] });
  });
});
