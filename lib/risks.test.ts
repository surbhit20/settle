import { describe, expect, it } from "vitest";
import { evaluateRisks, flagPrevalence, type Metric, type MetricMap } from "@/lib/risks";

function m(name: string, value: number | null, extra: Partial<Metric> = {}): Metric {
  return {
    metric_name: name,
    value,
    value_text: null,
    unit: null,
    source: "Mireye / TEST",
    source_url: "https://example.test",
    status: value === null ? "absent" : "ok",
    confidence: "high",
    notes: null,
    dataset_vintage: null,
    fetched_at: "2026-10-18T00:00:00Z",
    ...extra,
  };
}

function flag(metrics: MetricMap, key: string) {
  return evaluateRisks(metrics).find((f) => f.key === key)!;
}

const clearArea: MetricMap = {
  within_floodplain_polygon: m("within_floodplain_polygon", 0),
  wildfire_annual_frequency: m("wildfire_annual_frequency", 0.00001),
  seismic_design_category: m("seismic_design_category", null, { value_text: "C", status: "ok" }),
  seismic_pga_2pct_50yr_g: m("seismic_pga_2pct_50yr_g", 0.4),
  high_hazard_dams_within_10km: m("high_hazard_dams_within_10km", 0),
  nearest_dam_distance_m: m("nearest_dam_distance_m", 8000),
  nearest_hazardous_facility_distance_m: m("nearest_hazardous_facility_distance_m", 5000),
  nearest_hazardous_facility_name: m("nearest_hazardous_facility_name", null, { value_text: "Acme Plant", status: "ok" }),
};

describe("evaluateRisks", () => {
  it("returns all five flags, clear for a low-risk area", () => {
    const flags = evaluateRisks(clearArea);
    expect(flags.map((f) => f.key)).toEqual(["flood", "wildfire", "seismic", "dam", "hazardous_facility"]);
    expect(flags.every((f) => f.flagged === false)).toBe(true);
  });

  it("flags each risk at its threshold", () => {
    const risky: MetricMap = {
      ...clearArea,
      within_floodplain_polygon: m("within_floodplain_polygon", 1),
      wildfire_annual_frequency: m("wildfire_annual_frequency", 0.003), // exactly the threshold
      seismic_design_category: m("seismic_design_category", null, { value_text: "D", status: "ok" }),
      high_hazard_dams_within_10km: m("high_hazard_dams_within_10km", 1),
      nearest_hazardous_facility_distance_m: m("nearest_hazardous_facility_distance_m", 999),
    };
    expect(evaluateRisks(risky).every((f) => f.flagged === true)).toBe(true);
  });

  it("treats missing or failed data as unknown (null), never as clear", () => {
    const flags = evaluateRisks({
      within_floodplain_polygon: m("within_floodplain_polygon", null, { status: "failed" }),
    });
    expect(flags.every((f) => f.flagged === null)).toBe(true);
    expect(flags[0].detail).toBe("No data");
  });

  it("reads an absent hazardous facility as 'none within 10 km' (clear), not unknown", () => {
    const f = flag(
      { ...clearArea, nearest_hazardous_facility_distance_m: m("nearest_hazardous_facility_distance_m", null, { status: "absent" }) },
      "hazardous_facility",
    );
    expect(f.flagged).toBe(false);
    expect(f.detail).toMatch(/within 10 km/);
  });

  it("includes the facility name and distance in the detail", () => {
    const f = flag({ ...clearArea, nearest_hazardous_facility_distance_m: m("x", 450) }, "hazardous_facility");
    expect(f.flagged).toBe(true);
    expect(f.detail).toBe("Nearest: Acme Plant, 450 m away");
  });

  it("links the sources each flag was decided from", () => {
    const f = flag(clearArea, "seismic");
    expect(f.sources.map((s) => s.metric_name)).toEqual(["seismic_design_category", "seismic_pga_2pct_50yr_g"]);
  });
});

describe("flagPrevalence", () => {
  it("counts flagged areas per risk", () => {
    const flooded = { ...clearArea, within_floodplain_polygon: m("within_floodplain_polygon", 1) };
    const p = flagPrevalence([clearArea, flooded, flooded]);
    expect(p.flood).toEqual({ flagged: 2, total: 3 });
    expect(p.wildfire).toEqual({ flagged: 0, total: 3 });
  });
});
