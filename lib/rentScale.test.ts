import { describe, expect, it } from "vitest";
import { NO_DATA_COLOR, RENT_COLORS, rentColor, rentFillExpression, rentLegend } from "@/lib/rentScale";

describe("rentColor", () => {
  it("uses the no-data color for null, never the cheapest color", () => {
    expect(rentColor(null)).toBe(NO_DATA_COLOR);
  });

  it("puts band edges in the upper band (matches MapLibre step semantics)", () => {
    expect(rentColor(2499)).toBe(RENT_COLORS[0]);
    expect(rentColor(2500)).toBe(RENT_COLORS[1]);
    expect(rentColor(4999)).toBe(RENT_COLORS[4]);
    expect(rentColor(5000)).toBe(RENT_COLORS[5]);
    expect(rentColor(9000)).toBe(RENT_COLORS[5]);
  });
});

describe("rentLegend", () => {
  it("has one row per color with readable labels", () => {
    const rows = rentLegend();
    expect(rows).toHaveLength(RENT_COLORS.length);
    expect(rows[0].label).toBe("Under $2,500");
    expect(rows[1].label).toBe("$2,500 to $3,000");
    expect(rows[5].label).toBe("$5,000 and up");
  });
});

describe("rentFillExpression", () => {
  it("handles null first, then steps through every band", () => {
    const expr = rentFillExpression();
    expect(expr[0]).toBe("case");
    expect(expr[2]).toBe(NO_DATA_COLOR);
    expect(expr[3]).toEqual([
      "step", ["get", "rent_usd"], RENT_COLORS[0],
      2500, RENT_COLORS[1], 3000, RENT_COLORS[2], 3500, RENT_COLORS[3], 4000, RENT_COLORS[4], 5000, RENT_COLORS[5],
    ]);
  });
});
