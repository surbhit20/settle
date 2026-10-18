import { RENT_BANDS_USD } from "@/lib/scoring/config";

// Light-to-dark orange/red: cheaper areas are lighter (ColorBrewer OrRd, 6 classes).
export const RENT_COLORS = ["#fef0d9", "#fdd49e", "#fdbb84", "#fc8d59", "#e34a33", "#b30000"] as const;
export const NO_DATA_COLOR = "#a1a1aa";

// RENT_BANDS_USD has 5 bounds, giving 6 bands; one color per band.
if (RENT_COLORS.length !== RENT_BANDS_USD.length + 1) {
  throw new Error("RENT_COLORS must have one more entry than RENT_BANDS_USD");
}

export function rentColor(rent: number | null): string {
  if (rent === null) return NO_DATA_COLOR;
  const band = RENT_BANDS_USD.findIndex((upper) => rent < upper);
  return RENT_COLORS[band === -1 ? RENT_COLORS.length - 1 : band];
}

// Legend rows, e.g. "Under $2,500", "$2,500 to $3,000", ..., "$5,000 and up".
export function rentLegend(): { label: string; color: string }[] {
  const fmt = (n: number) => `$${n.toLocaleString("en-US")}`;
  const rows = RENT_BANDS_USD.map((upper, i) => ({
    label: i === 0 ? `Under ${fmt(upper)}` : `${fmt(RENT_BANDS_USD[i - 1])} to ${fmt(upper)}`,
    color: RENT_COLORS[i],
  }));
  rows.push({ label: `${fmt(RENT_BANDS_USD[RENT_BANDS_USD.length - 1])} and up`, color: RENT_COLORS[RENT_COLORS.length - 1] });
  return rows;
}

// The same scale as a MapLibre style expression (MapLibre evaluates it on the GPU per feature).
// ["step", input, color0, bound1, color1, ...] picks color_i for input >= bound_i.
export function rentFillExpression(): unknown[] {
  const step: unknown[] = ["step", ["get", "rent_usd"], RENT_COLORS[0]];
  RENT_BANDS_USD.forEach((bound, i) => step.push(bound, RENT_COLORS[i + 1]));
  return ["case", ["==", ["get", "rent_usd"], null], NO_DATA_COLOR, step];
}
