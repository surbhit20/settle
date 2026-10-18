// Colors for the personal-score heat map: higher score = darker green. Filtered-out areas are
// light grey so they recede. Same pattern as lib/rentScale.ts: one module feeds map and legend.

export const SCORE_BANDS = [40, 55, 70, 85] as const; // lower bounds of bands 2..5
export const SCORE_COLORS = ["#edf8e9", "#bae4b3", "#74c476", "#31a354", "#006d2c"] as const;
export const FILTERED_COLOR = "#e4e4e7";

if (SCORE_COLORS.length !== SCORE_BANDS.length + 1) {
  throw new Error("SCORE_COLORS must have one more entry than SCORE_BANDS");
}

export function scoreColor(score: number | null): string {
  if (score === null) return FILTERED_COLOR;
  const band = SCORE_BANDS.findIndex((lower) => score < lower);
  return SCORE_COLORS[band === -1 ? SCORE_COLORS.length - 1 : band];
}

export function scoreLegend(): { label: string; color: string }[] {
  const rows = SCORE_BANDS.map((lower, i) => ({
    label: i === 0 ? `Under ${lower}` : `${SCORE_BANDS[i - 1]} to ${lower}`,
    color: SCORE_COLORS[i],
  }));
  rows.push({ label: `${SCORE_BANDS[SCORE_BANDS.length - 1]} and up`, color: SCORE_COLORS[SCORE_COLORS.length - 1] });
  return rows.reverse(); // best first
}

// MapLibre expression reading the per-area score from feature-state (set after each scoring run).
// A missing score (filtered out) uses the grey.
export function scoreFillExpression(): unknown[] {
  const s = ["feature-state", "score"];
  const step: unknown[] = ["step", s, SCORE_COLORS[0]];
  SCORE_BANDS.forEach((b, i) => step.push(b, SCORE_COLORS[i + 1]));
  return ["case", ["==", ["typeof", s], "number"], step, FILTERED_COLOR];
}
