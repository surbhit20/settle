import { describe, expect, it } from "vitest";
import { groupMetrics } from "@/lib/areaDetails";

const base = {
  value_text: null,
  unit: null,
  source: "s",
  source_url: "u",
  status: "ok",
  confidence: null,
  notes: null,
  dataset_vintage: null,
  fetched_at: "2026-10-18",
};

describe("groupMetrics", () => {
  it("groups rows by area, then by metric name, without the zcta field", () => {
    const grouped = groupMetrics([
      { ...base, zcta: "94110", metric_name: "rent_zori_usd", value: 4931 },
      { ...base, zcta: "94110", metric_name: "within_floodplain_polygon", value: 0 },
      { ...base, zcta: "94301", metric_name: "rent_zori_usd", value: 4219 },
    ]);
    expect(Object.keys(grouped)).toEqual(["94110", "94301"]);
    expect(grouped["94110"].rent_zori_usd?.value).toBe(4931);
    expect(grouped["94110"].within_floodplain_polygon?.value).toBe(0);
    expect(grouped["94301"].rent_zori_usd).not.toHaveProperty("zcta");
  });

  it("returns an empty object for no rows", () => {
    expect(groupMetrics([])).toEqual({});
  });
});
