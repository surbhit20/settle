import { describe, expect, it } from "vitest";
import { findAreas, parseAmount, parseCommuteMode, parseFilterChange, parsePriorityChange } from "@/lib/agent/parse";

const base = { salaryUsd: 180_000, maxCommuteMin: 45, budgetUsd: 4500 };

describe("parseAmount", () => {
  it("reads dollars, commas, decimals and k", () => {
    expect(parseAmount("$3,500")).toBe(3500);
    expect(parseAmount("3.5k")).toBe(3500);
    expect(parseAmount("200k")).toBe(200_000);
    expect(parseAmount("300")).toBe(300);
    expect(parseAmount("abc")).toBeNull();
  });
});

describe("parseFilterChange", () => {
  it.each([
    ["what if my budget goes up 300", { rentBudgetUsd: 4800 }],
    ["What if my budget goes up by $300?", { rentBudgetUsd: 4800 }],
    ["raise my rent budget by 500", { rentBudgetUsd: 5000 }],
    ["lower the budget by 1k", { rentBudgetUsd: 3500 }],
    ["set my budget to 3500", { rentBudgetUsd: 3500 }],
    ["$3,200 budget", { rentBudgetUsd: 3200 }],
    ["max commute 30 minutes", { maxCommuteMin: 30 }],
    ["commute under 25 min", { maxCommuteMin: 25 }],
    ["I can drive 15 more minutes", { maxCommuteMin: 60 }],
    ["my salary is 200k", { salaryUsd: 200_000 }],
    ["salary 150", { salaryUsd: 150_000 }],
  ])("%s", (msg, expected) => {
    expect(parseFilterChange(msg, base)).toEqual(expected);
  });

  it("returns null when no filter is mentioned with a number", () => {
    expect(parseFilterChange("why is Milpitas ranked low", base)).toBeNull();
    expect(parseFilterChange("increase my budget", base)).toBeNull();
  });
});

describe("parsePriorityChange", () => {
  const p = { affordability: 5, commute: 5, safety: 5, risks: 5 };

  it("raises or lowers one priority by 3, within 0..10", () => {
    expect(parsePriorityChange("I care more about safety", p)).toEqual({ ...p, safety: 8 });
    expect(parsePriorityChange("commute matters less to me", p)).toEqual({ ...p, commute: 2 });
    expect(parsePriorityChange("prioritize safety", { ...p, safety: 9 })).toEqual({ ...p, safety: 10 });
  });

  it("sets a priority to 0 when the user doesn't care", () => {
    expect(parsePriorityChange("I don't care about earthquakes", p)).toEqual({ ...p, risks: 0 });
  });

  it("returns null for several topics, no direction, or no change", () => {
    expect(parsePriorityChange("safety and commute both matter more", p)).toBeNull();
    expect(parsePriorityChange("tell me about safety", p)).toBeNull();
    expect(parsePriorityChange("care more about safety", { ...p, safety: 10 })).toBeNull();
  });
});

describe("findAreas", () => {
  const areas = [
    { zcta: "94080", name: "South San Francisco" },
    { zcta: "94110", name: "San Francisco" },
    { zcta: "94112", name: "San Francisco" },
    { zcta: "95035", name: "Milpitas" },
    { zcta: "94128", name: "Unincorporated San Mateo" },
  ];

  it("finds areas by name, including every ZIP that shares the name", () => {
    expect(findAreas("compare Milpitas and San Francisco", areas)).toEqual(["94110", "94112", "95035"]);
  });

  it("matches the longest name first", () => {
    expect(findAreas("how is South San Francisco?", areas)).toEqual(["94080"]);
  });

  it("finds ZIP codes we know, ignores ones we don't", () => {
    expect(findAreas("94110 vs 95035 vs 10001", areas)).toEqual(["94110", "95035"]);
  });

  it("never matches the 'Unincorporated' placeholder names", () => {
    expect(findAreas("unincorporated san mateo", areas)).toEqual([]);
  });
});

import { parseHomeType } from "@/lib/agent/parse";

describe("parseHomeType", () => {
  it.each([
    ["what if I get a 2 bedroom?", "2br"],
    ["show me studios", "studio"],
    ["3 bhk please", "3br"],
    ["a two-bed place", "2br"],
    ["I want to live with roommates", "shared"],
    ["a room in a shared house", "shared"],
    ["4br", "4br"],
    ["any size is fine", "any"],
  ])("%s -> %s", (msg, expected) => {
    expect(parseHomeType(msg)).toBe(expected);
  });

  it("returns null when no size is mentioned", () => {
    expect(parseHomeType("budget up 300")).toBeNull();
  });
});

describe("parseFilterChange with home size", () => {
  const b = { salaryUsd: 180_000, maxCommuteMin: 45, budgetUsd: 4500 };
  it("doesn't read the bedroom number as another filter", () => {
    expect(parseFilterChange("what if I get a 2 bedroom", b)).toEqual({ homeType: "2br" });
  });
  it("combines a size with a budget change", () => {
    expect(parseFilterChange("3 bedroom with budget up 500", b)).toEqual({ homeType: "3br", rentBudgetUsd: 5000 });
  });
});

describe("parseCommuteMode", () => {
  it("reads transit and driving phrasing", () => {
    expect(parseCommuteMode("what if I take the train")).toBe("transit");
    expect(parseCommuteMode("show me public transit times")).toBe("transit");
    expect(parseCommuteMode("I'd ride BART")).toBe("transit");
    expect(parseCommuteMode("what if I drive instead")).toBe("drive");
  });

  it("ignores words that only contain a mode name", () => {
    expect(parseCommuteMode("is this community safe?")).toBeNull();
    expect(parseCommuteMode("what if my budget goes up 300")).toBeNull();
  });

  it("is applied as a filter change", () => {
    expect(parseFilterChange("what if I take the train", { salaryUsd: 1, maxCommuteMin: 45, budgetUsd: 3000 })).toEqual({ commuteMode: "transit" });
  });
});
