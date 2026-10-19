import { describe, expect, it } from "vitest";
import type { AreaDetails } from "@/lib/areaDetails";
import { bestIndexes, buildCompareSections, type CompareColumn } from "@/lib/compare";
import type { Metric, RiskFlag } from "@/lib/risks";
import type { ScoredArea } from "@/lib/scoring/types";

function m(metric_name: string, value: number | null, status = "ok"): Metric {
  return {
    metric_name, value, value_text: null, unit: null, source: "Src_A", source_url: "https://src",
    status, confidence: null, notes: null, dataset_vintage: null, fetched_at: "2026-01-01",
  };
}

function risk(key: RiskFlag["key"], flagged: boolean | null): RiskFlag {
  return { key, label: key, flagged, detail: "d", sources: [] };
}

function details(zcta: string, rent: number, shared: number | null, opts: Partial<AreaDetails> = {}): AreaDetails {
  const metrics: AreaDetails["metrics"] = {
    rent_zori_usd: m("rent_zori_usd", rent),
    rent_shared_room_est: shared === null ? m("rent_shared_room_est", null, "absent") : m("rent_shared_room_est", shared),
    fbi_violent_per_1000: m("fbi_violent_per_1000", 3.1),
  };
  return {
    zcta, name: zcta, county: "C", population: 30000, metrics,
    risks: [risk("flood", false), risk("wildfire", null)],
    prevalence: {} as AreaDetails["prevalence"],
    ...opts,
  };
}

function scored(zcta: string, rank: number, score: number, commuteMin: number, transitMin: number | null = null): ScoredArea {
  const sub = (s: number | null) => ({ score: s, explanation: "x", inputs: {}, sources: [] });
  return {
    rank, zcta, name: zcta, county: "C", score, partial: false, missing: [],
    weightsUsed: { affordability: 0.25, commute: 0.25, safety: 0.25, risks: 0.25 },
    subScores: {
      affordability: sub(80), safety: sub(null), risks: sub(100),
      commute: {
        score: 50, explanation: "x",
        inputs: { commute_min: commuteMin, mode: "drive", drive_min: commuteMin, transit_min: transitMin },
        sources: [{ name: "ORS", url: "https://ors" }, { name: "511", url: "http://www.511.org" }],
      },
    },
  };
}

const rowsOf = (cols: CompareColumn[], homeType: Parameters<typeof buildCompareSections>[1] = "any") =>
  Object.fromEntries(buildCompareSections(cols, homeType).flatMap((s) => s.rows).map((r) => [r.key, r]));

describe("bestIndexes", () => {
  it("picks the lowest or highest, with ties all highlighted", () => {
    expect(bestIndexes([3000, 2500, 2800], "lower")).toEqual([1]);
    expect(bestIndexes([70, 90, 90], "higher")).toEqual([1, 2]);
  });

  it("highlights nothing when values are all equal, missing, or the row is neutral", () => {
    expect(bestIndexes([5, 5], "lower")).toEqual([]);
    expect(bestIndexes([5, null], "lower")).toEqual([]);
    expect(bestIndexes([1, 2], null)).toEqual([]);
  });

  it("ignores missing values (no data is never best)", () => {
    expect(bestIndexes([null, 4, 2], "lower")).toEqual([2]);
  });
});

describe("buildCompareSections", () => {
  const a: CompareColumn = { details: details("94022", 4200, 1500), scored: scored("94022", 1, 95, 4, 18) };
  const b: CompareColumn = { details: details("95129", 3500, null), scored: scored("95129", 3, 87, 21, null) };

  it("lines up the same metric in every column, one row per home size", () => {
    const rows = rowsOf([a, b]);
    expect(rows.rent_shared_room_est.cells.map((c) => c.text)).toEqual(["$1,500/mo", "No data"]);
    expect(rows.rent_hud_2br.cells).toHaveLength(2); // present even when neither area has the metric
    expect(rows.rent_hud_2br.cells.map((c) => c.text)).toEqual(["No data", "No data"]);
  });

  it("highlights the better value: cheaper rent, higher score, shorter drive", () => {
    const rows = rowsOf([a, b]);
    expect(rows.rent_zori_usd.best).toEqual([1]);
    expect(rows.score.best).toEqual([0]);
    expect(rows.rank.best).toEqual([0]);
    expect(rows.drive_min.cells.map((c) => c.text)).toEqual(["4 min", "21 min"]);
    expect(rows.drive_min.best).toEqual([0]);
    expect(rows.drive_min.cells[0].source?.name).toBe("ORS");
    // Transit: one area has no route within 2 hours, so nothing is highlighted.
    expect(rows.transit_min.cells.map((c) => c.text)).toEqual(["18 min", "No data"]);
    expect(rows.transit_min.cells[0].source?.name).toBe("511");
    expect(rows.transit_min.best).toEqual([]);
    expect(rows.rent_shared_room_est.best).toEqual([]); // only one area has data
  });

  it("never treats missing risk data as clear, and doesn't highlight ties", () => {
    const rows = rowsOf([a, b]);
    expect(rows.risk_wildfire.cells.map((c) => c.text)).toEqual(["No data", "No data"]);
    expect(rows.risk_flood.best).toEqual([]); // both clear
    expect(rows.fbi_violent_per_1000.best).toEqual([]); // equal
  });

  it("marks the user's chosen home size and shows filtered-out areas", () => {
    const c: CompareColumn = { details: details("94301", 5000, 1900), filtered: { zcta: "94301", name: "Palo Alto", county: "C", reason: "rent_over_budget", detail: "too pricey" } };
    const rows = rowsOf([a, c], "shared");
    expect(rows.rent_shared_room_est.yourPick).toBe(true);
    expect(rows.rent_zori_usd.yourPick).toBe(false);
    expect(rows.score.cells[1]).toMatchObject({ text: "Filtered out", value: null, title: "too pricey" });
  });

  it("leaves out the score section before any search", () => {
    const sections = buildCompareSections([{ details: a.details }, { details: b.details }], "any", false);
    expect(sections.map((s) => s.title)).not.toContain("Your score");
  });
});
