import { describe, expect, it } from "vitest";
import { parseScoreRequest } from "@/lib/scoring/request";

const valid = {
  salaryUsd: 180000,
  officeAddress: "1 Market St, San Francisco, CA",
  maxCommuteMin: 45,
  rentBudgetUsd: null,
  priorities: { affordability: 5, commute: 5, safety: 5, risks: 5 },
};

describe("parseScoreRequest", () => {
  it("accepts a valid request and trims the address", () => {
    const r = parseScoreRequest({ ...valid, officeAddress: "  1 Market St, SF  " });
    expect(r).toMatchObject({ officeAddress: "1 Market St, SF", rentBudgetUsd: null });
  });

  it("treats a missing budget as 'derive from salary'", () => {
    const noBudget: Record<string, unknown> = { ...valid };
    delete noBudget.rentBudgetUsd;
    expect(parseScoreRequest(noBudget)).toMatchObject({ rentBudgetUsd: null });
  });

  it("rejects missing or non-numeric fields with a readable message", () => {
    expect(parseScoreRequest({ ...valid, salaryUsd: "lots" })).toBe("Salary is required.");
    expect(parseScoreRequest({ ...valid, officeAddress: "SF" })).toMatch(/street address/);
    expect(parseScoreRequest({ ...valid, priorities: { ...valid.priorities, risks: 11 } })).toMatch(/between 0 and 10/);
    expect(parseScoreRequest(null)).toBe("Salary is required.");
  });
});

describe("parseScoreRequest home type", () => {
  const base = {
    salaryUsd: 180000, officeAddress: "1 Market St, San Francisco, CA", maxCommuteMin: 45, rentBudgetUsd: null,
    priorities: { affordability: 5, commute: 5, safety: 5, risks: 5 },
  };
  it("defaults to any and accepts known types", () => {
    expect(parseScoreRequest(base)).toMatchObject({ homeType: "any" });
    expect(parseScoreRequest({ ...base, homeType: "2br" })).toMatchObject({ homeType: "2br" });
  });
  it("rejects unknown types", () => {
    expect(parseScoreRequest({ ...base, homeType: "castle" })).toBe("Unknown home type.");
  });
});
