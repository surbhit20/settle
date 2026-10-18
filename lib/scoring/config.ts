// All scoring thresholds live here (CLAUDE.md section 5). M2 uses only the risk-flag
// thresholds, to label the hidden-risks card; the penalties and weights arrive in M3.

export const RISK_THRESHOLDS = {
  // FEMA NRI annualized wildfire frequency for the Census tract, events per year.
  // Provisional: ~90th percentile across the 208 Bay Area areas (decisions.md D019).
  wildfireHighFrequencyPerYear: 0.003,
  // ASCE 7-22 seismic design categories that count as a flag ("D or above").
  seismicFlagCategories: ["D", "E", "F"],
  // A High hazard-potential dam within this distance (Mireye counts within 10 km).
  highHazardDamMinCount: 1,
  // An EPA RMP-registered hazardous chemical facility closer than this.
  hazardousFacilityMaxMeters: 1000,
} as const;

// Rent color bands for the map, in USD per month (Zillow ZORI).
// Upper bounds of each band; the last band is everything at or above the final bound.
export const RENT_BANDS_USD = [2500, 3000, 3500, 4000, 5000] as const;
