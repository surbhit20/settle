// Every scoring weight, threshold and penalty lives here (CLAUDE.md section 5).
// Changing a number here changes rankings, so each change needs a decisions.md entry.

export const RISK_THRESHOLDS = {
  // FEMA NRI annualized wildfire frequency for the Census tract, events per year.
  // Provisional: ~90th percentile across the 208 Bay Area areas (decisions.md D019).
  wildfireHighFrequencyPerYear: 0.003,
  // Peak ground acceleration (g) with 2% chance in 50 years, at or above which we flag.
  // Replaces the brief's "category D or above", which flags all 208 areas (D023). 1.1 g flags 50.
  seismicPgaFlagG: 1.1,
  // Flag when the NEAREST dam is High hazard-potential and closer than this.
  // Replaces the brief's "any High dam within 10 km", which flags 197 of 208 (D023). 2 km flags 33.
  highHazardDamMaxMeters: 2000,
  // An EPA RMP-registered hazardous chemical facility closer than this.
  hazardousFacilityMaxMeters: 1000,
} as const;

// Rent color bands for the rent map, in USD per month (Zillow ZORI).
// Upper bounds of each band; the last band is everything at or above the final bound.
export const RENT_BANDS_USD = [2500, 3000, 3500, 4000, 5000] as const;

export const SCORING = {
  // When the user gives no rent budget: budget = this share of gross monthly income (D026).
  derivedBudgetShareOfGross: 0.3,
  // Hard filter: drop areas whose rent exceeds the budget by more than this (CLAUDE.md: 15%).
  rentOverBudgetTolerance: 0.15,

  // Affordability: rent as a share of gross monthly income -> score, piecewise linear.
  // At or below the first share scores 100; at or above the last scores 0.
  // Gentle from 30% to 40%, then steep: "30% or less scores high, falling steeply after 40%".
  affordabilityCurve: [
    [0.3, 100],
    [0.4, 75],
    [0.5, 0],
  ] as const,

  // Hidden risks: start at 100, subtract these per flagged risk (floor 0).
  riskPenalties: {
    flood: 25,
    wildfire: 20,
    seismic: 15,
    dam: 15,
    hazardous_facility: 20,
  },

  // Priority slider range and the "Balanced" default.
  priorityMax: 10,
  defaultPriorities: { affordability: 5, commute: 5, safety: 5, risks: 5 },
} as const;
