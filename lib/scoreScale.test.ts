import { describe, expect, it } from "vitest";
import { FILTERED_COLOR, SCORE_COLORS, scoreColor, scoreFillExpression, scoreLegend } from "@/lib/scoreScale";

describe("scoreScale", () => {
  it("colors filtered areas grey and puts band edges in the upper band", () => {
    expect(scoreColor(null)).toBe(FILTERED_COLOR);
    expect(scoreColor(0)).toBe(SCORE_COLORS[0]);
    expect(scoreColor(39.9)).toBe(SCORE_COLORS[0]);
    expect(scoreColor(40)).toBe(SCORE_COLORS[1]);
    expect(scoreColor(85)).toBe(SCORE_COLORS[4]);
    expect(scoreColor(100)).toBe(SCORE_COLORS[4]);
  });

  it("legend lists best first, one row per color", () => {
    const rows = scoreLegend();
    expect(rows).toHaveLength(SCORE_COLORS.length);
    expect(rows[0]).toEqual({ label: "85 and up", color: SCORE_COLORS[4] });
    expect(rows[4]).toEqual({ label: "Under 40", color: SCORE_COLORS[0] });
  });

  it("map expression falls back to grey when no score is set", () => {
    const e = scoreFillExpression();
    expect(e[0]).toBe("case");
    expect(e[3]).toBe(FILTERED_COLOR);
  });
});
