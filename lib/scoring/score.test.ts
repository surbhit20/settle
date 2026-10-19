import { describe, expect, it } from "vitest";
import type { RiskFlag, RiskKey } from "@/lib/risks";
import { SCORING } from "@/lib/scoring/config";
import {
  ScoringInputError,
  affordabilityFromShare,
  midRankPercentile,
  normalizeWeights,
  scoreAreas,
} from "@/lib/scoring/score";
import type { AreaInputs, UserInputs } from "@/lib/scoring/types";

const KEYS: RiskKey[] = ["flood", "wildfire", "seismic", "dam", "hazardous_facility"];

function risks(flagged: Partial<Record<RiskKey, boolean | null>> = {}): RiskFlag[] {
  return KEYS.map((key) => ({
    key,
    label: key,
    flagged: key in flagged ? (flagged[key] as boolean | null) : false,
    detail: "",
    sources: [],
  }));
}

function area(zcta: string, over: Partial<AreaInputs> = {}): AreaInputs {
  return {
    zcta,
    name: `Area ${zcta}`,
    county: "Test",
    rentUsd: 3000,
    rentSource: { name: "Zillow Research (ZORI)", url: "https://z" },
    commuteMin: 20,
    commuteSource: { name: "OpenRouteService", url: "https://ors" },
    crimeRatePer1000: null,
    crimeSource: null,
    risks: risks(),
    ...over,
  };
}

// $180k/yr = $15k/mo gross; derived budget = $4,500; ceiling with 15% = $5,175.
const user: UserInputs = {
  salaryUsd: 180_000,
  maxCommuteMin: 45,
  rentBudgetUsd: null,
  priorities: { affordability: 5, commute: 5, safety: 5, risks: 5 },
};

describe("affordabilityFromShare", () => {
  it("follows the configured curve", () => {
    expect(affordabilityFromShare(0.2)).toBe(100);
    expect(affordabilityFromShare(0.3)).toBe(100);
    expect(affordabilityFromShare(0.35)).toBeCloseTo(87.5);
    expect(affordabilityFromShare(0.4)).toBe(75);
    expect(affordabilityFromShare(0.45)).toBeCloseTo(37.5);
    expect(affordabilityFromShare(0.5)).toBe(0);
    expect(affordabilityFromShare(0.9)).toBe(0);
  });

  it("falls more steeply after 40% than between 30% and 40%", () => {
    const gentle = affordabilityFromShare(0.3) - affordabilityFromShare(0.4);
    const steep = affordabilityFromShare(0.4) - affordabilityFromShare(0.5);
    expect(steep).toBeGreaterThan(gentle);
  });
});

describe("midRankPercentile", () => {
  it("gives equal values equal percentiles", () => {
    expect(midRankPercentile(5, [1, 5, 5, 9])).toBe(midRankPercentile(5, [1, 5, 5, 9]));
    expect(midRankPercentile(1, [1, 5, 9])).toBe(0);
    expect(midRankPercentile(9, [1, 5, 9])).toBe(1);
    expect(midRankPercentile(5, [5])).toBe(0.5);
  });
});

describe("normalizeWeights", () => {
  it("normalizes over available sub-scores only", () => {
    const w = normalizeWeights({ affordability: 6, commute: 2, safety: 8, risks: 2 }, ["affordability", "commute", "risks"]);
    expect(w.safety).toBe(0);
    expect(w.affordability).toBeCloseTo(0.6);
    expect(w.affordability + w.commute + w.risks).toBeCloseTo(1);
  });

  it("falls back to equal weights when every slider is zero", () => {
    const w = normalizeWeights({ affordability: 0, commute: 0, safety: 0, risks: 0 }, ["affordability", "commute"]);
    expect(w).toEqual({ affordability: 0.5, commute: 0.5, safety: 0, risks: 0 });
  });
});

describe("scoreAreas", () => {
  it("derives the budget from salary when none is given", () => {
    const r = scoreAreas([area("1")], user);
    expect(r.monthlyIncomeUsd).toBe(15_000);
    expect(r.budgetUsd).toBe(15_000 * SCORING.derivedBudgetShareOfGross);
    expect(r.budgetDerived).toBe(true);
  });

  it("filters commute over max, no route, and rent more than 15% over budget", () => {
    const r = scoreAreas(
      [
        area("ok", { rentUsd: 5175 }), // exactly at the 15% ceiling: kept
        area("far", { commuteMin: 46 }),
        area("noroute", { commuteMin: null }),
        area("pricey", { rentUsd: 5176 }),
      ],
      user,
    );
    expect(r.ranked.map((a) => a.zcta)).toEqual(["ok"]);
    expect(Object.fromEntries(r.filtered.map((f) => [f.zcta, f.reason]))).toEqual({
      far: "commute_too_long",
      noroute: "no_route",
      pricey: "rent_over_budget",
    });
  });

  it("keeps an area with no rent data, reweights, and marks it partial", () => {
    const r = scoreAreas([area("norent", { rentUsd: null }), area("rent")], user);
    const a = r.ranked.find((x) => x.zcta === "norent")!;
    expect(a.subScores.affordability.score).toBeNull();
    expect(a.weightsUsed.affordability).toBe(0);
    expect(a.weightsUsed.commute + a.weightsUsed.risks).toBeCloseTo(1);
    expect(a.partial).toBe(true);
    expect(a.missing).toEqual(["affordability"]);
  });

  it("ranks every area with verified rent above any area without rent, even a higher-scoring one (D030)", () => {
    const r = scoreAreas(
      [
        area("norent-close", { rentUsd: null, commuteMin: 2 }), // would score highest
        area("rent-far", { rentUsd: 4500, commuteMin: 40 }),
        area("rent-mid", { rentUsd: 3000, commuteMin: 20 }),
      ],
      user,
    );
    expect(r.ranked.map((a) => a.zcta)).toEqual(["rent-mid", "rent-far", "norent-close"]);
    const noRent = r.ranked[2];
    expect(noRent.score).toBeGreaterThan(r.ranked[0].score); // keeps its own score...
    expect(noRent.partial).toBe(true); // ...and its partial label
    expect(r.ranked.map((a) => a.rank)).toEqual([1, 2, 3]);
  });

  it("sorts areas without rent among themselves by score, then ZIP", () => {
    const r = scoreAreas(
      [
        area("94300", { rentUsd: null, commuteMin: 10 }),
        area("94200", { rentUsd: null, commuteMin: 30 }),
        area("94100", { rentUsd: null, commuteMin: 10 }),
      ],
      user,
    );
    expect(r.ranked.map((a) => a.zcta)).toEqual(["94100", "94300", "94200"]);
  });

  it("missing crime data everywhere: safety left out, reported once, areas not marked partial", () => {
    const r = scoreAreas([area("1"), area("2")], user);
    expect(r.unavailableEverywhere).toEqual(["safety"]);
    for (const a of r.ranked) {
      expect(a.subScores.safety.score).toBeNull();
      expect(a.weightsUsed.safety).toBe(0);
      expect(a.partial).toBe(false);
    }
  });

  it("missing crime data for some areas: those are partial, the rest use safety", () => {
    const r = scoreAreas(
      [area("sf", { crimeRatePer1000: 40 }), area("oak", { crimeRatePer1000: 80 }), area("nodata")],
      user,
    );
    const by = Object.fromEntries(r.ranked.map((a) => [a.zcta, a]));
    expect(r.unavailableEverywhere).toEqual([]);
    expect(by.sf.subScores.safety.score).toBe(100); // lowest rate of those with data
    expect(by.oak.subScores.safety.score).toBe(0);
    expect(by.nodata.subScores.safety.score).toBeNull();
    expect(by.nodata.partial).toBe(true);
    expect(by.nodata.missing).toEqual(["safety"]);
  });

  it("rejects zero or negative salary instead of scoring", () => {
    expect(() => scoreAreas([area("1")], { ...user, salaryUsd: 0 })).toThrow(ScoringInputError);
    expect(() => scoreAreas([area("1")], { ...user, salaryUsd: -5 })).toThrow(ScoringInputError);
  });

  it("rejects a zero max commute and a zero budget", () => {
    expect(() => scoreAreas([area("1")], { ...user, maxCommuteMin: 0 })).toThrow(ScoringInputError);
    expect(() => scoreAreas([area("1")], { ...user, rentBudgetUsd: 0 })).toThrow(ScoringInputError);
  });

  it("commute ties: equal commute gives equal scores, order broken by ZIP deterministically", () => {
    const r = scoreAreas([area("94200"), area("94100"), area("94150")], user);
    expect(new Set(r.ranked.map((a) => a.score)).size).toBe(1);
    expect(r.ranked.map((a) => a.zcta)).toEqual(["94100", "94150", "94200"]);
    expect(r.ranked.map((a) => a.rank)).toEqual([1, 2, 3]);
  });

  it("everything filtered out: empty ranking, every area has a reason", () => {
    const r = scoreAreas([area("1", { commuteMin: 90 }), area("2", { rentUsd: 20_000 })], user);
    expect(r.ranked).toEqual([]);
    expect(r.filtered).toHaveLength(2);
  });

  it("no areas at all: empty result, no crash", () => {
    const r = scoreAreas([], user);
    expect(r.ranked).toEqual([]);
    expect(r.filtered).toEqual([]);
  });

  it("commute sub-score is linear from 0 min (100) to the max (0)", () => {
    const r = scoreAreas([area("a", { commuteMin: 0 }), area("b", { commuteMin: 45 }), area("c", { commuteMin: 22.5 })], user);
    const by = Object.fromEntries(r.ranked.map((a) => [a.zcta, a.subScores.commute.score]));
    expect(by).toEqual({ a: 100, b: 0, c: 50 });
  });

  it("risk penalties come from config and floor at 0", () => {
    const one = scoreAreas([area("1", { risks: risks({ flood: true }) })], user).ranked[0];
    expect(one.subScores.risks.score).toBe(100 - SCORING.riskPenalties.flood);
    const all = scoreAreas(
      [area("1", { risks: risks({ flood: true, wildfire: true, seismic: true, dam: true, hazardous_facility: true }) })],
      user,
    ).ranked[0];
    expect(all.subScores.risks.score).toBe(Math.max(0, 100 - 95));
  });

  it("an unknown risk flag adds no penalty but marks the area partial", () => {
    const a = scoreAreas([area("1", { risks: risks({ flood: null }) })], user).ranked[0];
    expect(a.subScores.risks.score).toBe(100);
    expect(a.partial).toBe(true);
  });

  it("final score is the weighted average of available sub-scores, using the sliders", () => {
    // rent 4500 / 15000 = 30% -> 100; commute 20/45 -> 55.6; risks 100 (safety unavailable)
    const a = scoreAreas([area("1", { rentUsd: 4500 })], {
      ...user,
      priorities: { affordability: 10, commute: 0, safety: 5, risks: 0 },
    }).ranked[0];
    expect(a.weightsUsed.affordability).toBe(1);
    expect(a.score).toBe(100);
  });

  it("raising the budget by $300 can bring a filtered area back (the 'what if' from the brief)", () => {
    const areas = [area("edge", { rentUsd: 5400 })];
    expect(scoreAreas(areas, { ...user, rentBudgetUsd: 4500 }).ranked).toHaveLength(0); // ceiling 5175
    expect(scoreAreas(areas, { ...user, rentBudgetUsd: 4800 }).ranked).toHaveLength(1); // ceiling 5520
  });

  it("is deterministic: the same inputs give identical output", () => {
    const areas = [area("1", { commuteMin: 10 }), area("2", { rentUsd: 4000 }), area("3", { crimeRatePer1000: 12 })];
    expect(scoreAreas(areas, user)).toEqual(scoreAreas(areas, user));
  });

  it("returns raw inputs and sources behind every sub-score", () => {
    const a = scoreAreas([area("1")], user).ranked[0];
    expect(a.subScores.affordability.inputs).toMatchObject({ rent_usd: 3000, monthly_income_usd: 15000, rent_share_pct: 20 });
    expect(a.subScores.affordability.sources[0].name).toBe("Zillow Research (ZORI)");
    expect(a.subScores.commute.inputs).toMatchObject({ commute_min: 20, max_commute_min: 45 });
    expect(a.subScores.commute.sources[0].name).toBe("OpenRouteService");
  });
});

describe("explanations match the rounded inputs", () => {
  it("uses the same one-decimal value in text and inputs", () => {
    const r = scoreAreas(
      [area("a", { crimeRatePer1000: 59.55, rentUsd: 2999.25 }), area("b", { crimeRatePer1000: 10 })],
      user,
    ).ranked.find((x) => x.zcta === "a")!;
    expect(r.subScores.safety.explanation).toContain(`${r.subScores.safety.inputs.crime_rate_per_1000}`);
    expect(r.subScores.affordability.explanation).toContain(`${Number(r.subScores.affordability.inputs.rent_share_pct).toFixed(1)}%`);
  });
});

describe("home type (D038)", () => {
  const sized = (zcta: string, twoBr: number | null, over: Partial<AreaInputs> = {}) =>
    area(zcta, {
      rentUsd: 3000,
      rentsBySize: {
        "2br": { usd: twoBr, source: { name: "HUD Small Area Fair Market Rents (FY2027)", url: "https://hud" } },
        shared: { usd: 1400, source: { name: "HUD Small Area Fair Market Rents (FY2027)", url: "https://hud" } },
      },
      ...over,
    });

  it("defaults to 'any' and uses Zillow's typical rent", () => {
    const r = scoreAreas([sized("1", 4000)], user);
    expect(r.homeType).toBe("any");
    expect(r.ranked[0].subScores.affordability.inputs.rent_usd).toBe(3000);
  });

  it("uses the chosen size's rent and source, and names the size in the explanation", () => {
    const a = scoreAreas([sized("1", 4000)], { ...user, homeType: "2br" }).ranked[0];
    expect(a.subScores.affordability.inputs).toMatchObject({ rent_usd: 4000, home_type: "2br" });
    expect(a.subScores.affordability.sources[0].name).toContain("HUD");
    expect(a.subScores.affordability.explanation).toContain("2-bedroom");
  });

  it("filters on the chosen size's rent, not the typical rent", () => {
    // budget 4500 -> ceiling 5175: typical rent 3000 passes, but a 6000 2-bedroom doesn't
    const r = scoreAreas([sized("1", 6000)], { ...user, homeType: "2br" });
    expect(r.ranked).toHaveLength(0);
    expect(r.filtered[0].reason).toBe("rent_over_budget");
    expect(r.filtered[0].detail).toContain("2-bedroom");
  });

  it("treats a missing size as no data (partial), never falling back to another size", () => {
    const r = scoreAreas([sized("1", null), sized("2", 3500)], { ...user, homeType: "2br" });
    const a = r.ranked.find((x) => x.zcta === "1")!;
    expect(a.subScores.affordability.score).toBeNull();
    expect(a.partial).toBe(true);
    expect(r.ranked[0].zcta).toBe("2"); // verified rent first (D030)
  });

  it("shared room uses its own (estimated) rent", () => {
    const a = scoreAreas([sized("1", 4000)], { ...user, homeType: "shared" }).ranked[0];
    expect(a.subScores.affordability.inputs.rent_usd).toBe(1400);
    expect(a.subScores.affordability.explanation).toContain("room in a shared home");
  });
});

describe("areas with few residents (D038)", () => {
  it("are filtered out with the resident count, before other filters", () => {
    const r = scoreAreas([area("94188", { population: 0 }), area("94104", { population: 498, commuteMin: 999 }), area("94110", { population: 60000 })], user);
    expect(r.ranked.map((a) => a.zcta)).toEqual(["94110"]);
    const byZ = Object.fromEntries(r.filtered.map((f) => [f.zcta, f]));
    expect(byZ["94188"].reason).toBe("few_residents");
    expect(byZ["94104"].reason).toBe("few_residents");
    expect(byZ["94104"].detail).toContain("498 residents");
  });

  it("unknown population doesn't filter (missing data isn't a fact)", () => {
    expect(scoreAreas([area("1", { population: null })], user).ranked).toHaveLength(1);
  });
});

describe("FBI city-wide safety fallback (D040)", () => {
  const fbiSrc = { name: "FBI Crime Data Explorer: Berkeley Police Department", url: "https://cde" };
  const nb = (zcta: string, rate: number) => area(zcta, { crimeRatePer1000: rate });
  const city = (zcta: string, fbi: number | null, agency = "Berkeley Police Department") =>
    area(zcta, { crimeRatePer1000: null, fbiRatePer1000: fbi, fbiAgency: agency, fbiSource: fbiSrc });

  it("scores areas without neighborhood data from their city's FBI rate, labeled as city-wide", () => {
    const r = scoreAreas([nb("sf1", 20), nb("sf2", 60), city("brk", 47.2), city("dan", 4.5, "Danville Police Department")], user);
    const by = Object.fromEntries(r.ranked.map((a) => [a.zcta, a]));
    expect(by.dan.subScores.safety.score).toBe(100); // safest of the FBI-scored areas
    expect(by.brk.subScores.safety.score).toBe(0);
    expect(by.brk.subScores.safety.inputs).toMatchObject({ basis: "city-wide (FBI)", fbi_rate_per_1000: 47.2 });
    expect(by.brk.subScores.safety.explanation).toContain("City-wide: Berkeley Police Department reports 47.2");
    expect(by.brk.subScores.safety.explanation).not.toMatch(/no neighborhood/i);
    expect(by.brk.subScores.safety.sources[0].name).toContain("FBI");
    expect(by.brk.partial).toBe(false); // it has a safety score now
  });

  it("keeps the two scales separate: FBI areas don't change neighborhood scores", () => {
    const without = scoreAreas([nb("sf1", 20), nb("sf2", 60)], user).ranked;
    const withFbi = scoreAreas([nb("sf1", 20), nb("sf2", 60), city("brk", 5), city("x", 500)], user).ranked;
    for (const z of ["sf1", "sf2"]) {
      expect(withFbi.find((a) => a.zcta === z)!.subScores.safety.score).toBe(without.find((a) => a.zcta === z)!.subScores.safety.score);
    }
  });

  it("areas with neither source still have no safety score (never zero)", () => {
    const a = scoreAreas([nb("sf1", 20), city("brk", 30), city("none", null)], user).ranked.find((x) => x.zcta === "none")!;
    expect(a.subScores.safety.score).toBeNull();
    expect(a.partial).toBe(true);
  });

  it("only FBI data anywhere: safety is still scored, not reported unavailable", () => {
    const r = scoreAreas([city("a", 10), city("b", 20)], user);
    expect(r.unavailableEverywhere).not.toContain("safety");
  });
});
