import { describe, expect, it } from "vitest";
import { TRANSIT_SOURCE, withCommuteMode, type TransitTimes } from "@/lib/scoring/commuteMode";
import { parseScoreRequest } from "@/lib/scoring/request";
import { commuteSubScore, scoreAreas } from "@/lib/scoring/score";
import type { AreaInputs } from "@/lib/scoring/types";

const ORS = { name: "ORS", url: "https://ors" };

function area(zcta: string, driveMin: number | null): AreaInputs {
  return {
    zcta, name: zcta, county: "C", rentUsd: 3000, rentSource: null, commuteMin: driveMin, commuteSource: ORS,
    crimeRatePer1000: null, crimeSource: null, risks: [], population: 30000,
  };
}

const transit: TransitTimes = {
  officeZcta: "94105",
  minutesByZcta: new Map([["94105", 6], ["94110", 28], ["94601", null]]),
  estimated: new Set(["94105"]),
  serviceDate: "2026-10-27",
};

const user = { salaryUsd: 150000, maxCommuteMin: 45, rentBudgetUsd: null, priorities: { affordability: 5, commute: 5, safety: 5, risks: 5 } };

describe("withCommuteMode", () => {
  const areas = [area("94105", 5), area("94110", 15), area("94601", 22)];

  it("keeps drive as the scored commute and adds transit for context", () => {
    const [a] = withCommuteMode(areas, transit, "drive");
    expect(a).toMatchObject({ commuteMin: 5, commuteSource: ORS, driveMin: 5, transitMin: 6, transitEstimated: true, transitSource: TRANSIT_SOURCE });
  });

  it("scores on transit in transit mode, keeping the drive time", () => {
    const out = withCommuteMode(areas, transit, "transit");
    expect(out[1]).toMatchObject({ commuteMin: 28, commuteSource: TRANSIT_SOURCE, driveMin: 15, driveSource: ORS });
    expect(out[2].commuteMin).toBeNull(); // no transit route: not zero
  });

  it("leaves transit empty when there are no transit times", () => {
    const [a] = withCommuteMode(areas, null, "drive");
    expect(a).toMatchObject({ transitMin: null, transitSource: null, transitEstimated: false });
  });
});

describe("transit scoring", () => {
  const areas = withCommuteMode([area("94105", 5), area("94110", 15), area("94601", 22)], transit, "transit");

  it("explains a transit commute, with the drive time for context and both sources", () => {
    const s = commuteSubScore(areas[1], 45, "transit");
    expect(s.explanation).toBe(
      "About 28 min by public transit on a typical weekday morning, against your max of 45 min. Driving: about 15 min without traffic.",
    );
    expect(s.inputs).toMatchObject({ commute_min: 28, mode: "transit", drive_min: 15, transit_min: 28 });
    expect(s.sources).toEqual([TRANSIT_SOURCE, ORS]);
  });

  it("labels the same-area trip as an estimate", () => {
    expect(commuteSubScore(areas[0], 45, "transit").explanation).toContain("within the same area (estimated)");
  });

  it("filters areas with no transit trip, saying so", () => {
    const r = scoreAreas(areas, { ...user, commuteMode: "transit" });
    expect(r.filtered.find((f) => f.zcta === "94601")).toMatchObject({
      reason: "no_route",
      detail: "No public-transit trip to your office within 2 hours.",
    });
  });

  it("drive mode mentions the transit time too", () => {
    const drive = withCommuteMode([area("94110", 15)], transit, "drive");
    expect(commuteSubScore(drive[0], 45, "drive").explanation).toBe(
      "About 15 min drive without traffic, against your max of 45 min. By public transit: about 28 min.",
    );
  });
});

describe("commute mode in requests", () => {
  const base = { salaryUsd: 1, officeAddress: "1 Market St", maxCommuteMin: 45, priorities: user.priorities };

  it("defaults to drive and accepts transit", () => {
    expect(parseScoreRequest(base)).toMatchObject({ commuteMode: "drive" });
    expect(parseScoreRequest({ ...base, commuteMode: "transit" })).toMatchObject({ commuteMode: "transit" });
  });

  it("rejects unknown modes", () => {
    expect(parseScoreRequest({ ...base, commuteMode: "teleport" })).toBe("Unknown commute mode.");
  });
});
