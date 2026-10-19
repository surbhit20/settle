// Puts both commute times on every area and picks the one the user commutes by (D048). Pure,
// so it is unit tested. Drive times come from openrouteservice (lib/commute.ts); transit times
// from the precomputed `transit_times` table (lib/transit.ts).

import type { AreaInputs, CommuteMode, SourceRef } from "@/lib/scoring/types";

// 511.org's license requires this credit, with a link to 511.org, next to the data.
export const TRANSIT_SOURCE: SourceRef = {
  name: "Transit timetables: data provided by 511.org",
  url: "http://www.511.org",
};

export type TransitTimes = {
  officeZcta: string; // the area the office is in; times are to this area's center
  minutesByZcta: Map<string, number | null>;
  estimated: Set<string>; // same-area trips (estimated, not routed)
  serviceDate: string; // the timetable day routed, e.g. "2026-10-27"
};

export function withCommuteMode(areas: AreaInputs[], transit: TransitTimes | null, mode: CommuteMode): AreaInputs[] {
  return areas.map((a) => {
    // `commuteMin` arrives holding the drive time (loadAreaInputs fills it from the ORS matrix).
    const driveMin = a.commuteMin;
    const transitMin = transit ? (transit.minutesByZcta.get(a.zcta) ?? null) : null;
    const both = {
      ...a,
      driveMin,
      driveSource: a.commuteSource,
      transitMin,
      transitEstimated: transit?.estimated.has(a.zcta) ?? false,
      transitSource: transit ? TRANSIT_SOURCE : null,
    };
    return mode === "transit" ? { ...both, commuteMin: transitMin, commuteSource: TRANSIT_SOURCE } : both;
  });
}
