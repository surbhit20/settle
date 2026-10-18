import { RISK_THRESHOLDS } from "@/lib/scoring/config";

// One row of `area_metrics`, as the API sends it to the browser.
export type Metric = {
  metric_name: string;
  value: number | null;
  value_text: string | null;
  unit: string | null;
  source: string;
  source_url: string;
  status: string;
  confidence: string | null;
  notes: string | null;
  dataset_vintage: string | null;
  fetched_at: string;
};

// Metrics for one area, keyed by metric name.
// Record<K, V> is TypeScript for "an object whose keys are K and values are V".
export type MetricMap = Record<string, Metric | undefined>;

export type RiskKey = "flood" | "wildfire" | "seismic" | "dam" | "hazardous_facility";

export type RiskFlag = {
  key: RiskKey;
  label: string;
  // true = flagged, false = checked and clear, null = no data (never treated as clear).
  flagged: boolean | null;
  detail: string;
  // The metrics this flag was decided from, so the UI can link every source.
  sources: Metric[];
};

// A metric "has data" only when Mireye (or our loader) says it is ok.
function ok(m: Metric | undefined): m is Metric {
  return m !== undefined && m.status === "ok";
}

function km(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

// Filter out undefined entries; the `m is Metric` return type tells TypeScript the result has no undefineds.
function present(...ms: (Metric | undefined)[]): Metric[] {
  return ms.filter((m): m is Metric => m !== undefined);
}

export function evaluateRisks(metrics: MetricMap): RiskFlag[] {
  const t = RISK_THRESHOLDS;
  const flags: RiskFlag[] = [];

  // 1. Flood zone
  const flood = metrics.within_floodplain_polygon;
  flags.push({
    key: "flood",
    label: "Flood zone",
    flagged: ok(flood) ? flood.value === 1 : null,
    detail: !ok(flood)
      ? "No data"
      : flood.value === 1
        ? "Inside a FEMA-mapped flood hazard area"
        : "Outside FEMA-mapped flood hazard areas",
    sources: present(flood),
  });

  // 2. Wildfire
  const fire = metrics.wildfire_annual_frequency;
  const fireRate = ok(fire) ? fire.value : null;
  flags.push({
    key: "wildfire",
    label: "Wildfire",
    flagged: fireRate === null ? null : fireRate >= t.wildfireHighFrequencyPerYear,
    detail:
      fireRate === null
        ? "No data"
        : fireRate === 0
          ? "No recorded wildfire frequency for this tract"
          : `About 1 event every ${Math.round(1 / fireRate).toLocaleString()} years (tract average)`,
    sources: present(fire),
  });

  // 3. Earthquake
  const sdc = metrics.seismic_design_category;
  const pga = metrics.seismic_pga_2pct_50yr_g;
  const category = ok(sdc) ? sdc.value_text : null;
  flags.push({
    key: "seismic",
    label: "Earthquake",
    flagged:
      category === null
        ? null
        : (t.seismicFlagCategories as readonly string[]).includes(category),
    detail:
      category === null
        ? "No data"
        : `Seismic design category ${category}` +
          (ok(pga) && pga.value !== null ? `; peak ground acceleration ${pga.value.toFixed(2)} g (2% in 50 yrs)` : ""),
    sources: present(sdc, pga),
  });

  // 4. High hazard dam nearby
  const dams = metrics.high_hazard_dams_within_10km;
  const nearestDam = metrics.nearest_dam_distance_m;
  const damCount = ok(dams) ? dams.value : null;
  flags.push({
    key: "dam",
    label: "High hazard dam",
    flagged: damCount === null ? null : damCount >= t.highHazardDamMinCount,
    detail:
      damCount === null
        ? "No data"
        : `${damCount} high hazard-potential dam${damCount === 1 ? "" : "s"} within 10 km` +
          (ok(nearestDam) && nearestDam.value !== null ? `; nearest dam ${km(nearestDam.value)}` : ""),
    sources: present(dams, nearestDam),
  });

  // 5. Hazardous chemical facility nearby. Mireye's "absent" here means "none within 10 km",
  //    which is a real answer (clear), not missing data.
  const facDist = metrics.nearest_hazardous_facility_distance_m;
  const facName = metrics.nearest_hazardous_facility_name;
  let facFlag: boolean | null = null;
  let facDetail = "No data";
  if (ok(facDist) && facDist.value !== null) {
    facFlag = facDist.value < t.hazardousFacilityMaxMeters;
    const name = ok(facName) && facName.value_text ? facName.value_text : "unnamed facility";
    facDetail = `Nearest: ${name}, ${km(facDist.value)} away`;
  } else if (facDist?.status === "absent") {
    facFlag = false;
    facDetail = "No registered hazardous chemical facility within 10 km";
  }
  flags.push({
    key: "hazardous_facility",
    label: "Hazardous facility",
    flagged: facFlag,
    detail: facDetail,
    sources: present(facDist, facName),
  });

  return flags;
}

// For each risk, how many areas in the region are flagged. Used as context on the card
// ("197 of 208 areas") so a near-universal flag is not read as unusual.
export function flagPrevalence(allAreas: MetricMap[]): Record<RiskKey, { flagged: number; total: number }> {
  const out = {} as Record<RiskKey, { flagged: number; total: number }>;
  for (const metrics of allAreas) {
    for (const f of evaluateRisks(metrics)) {
      out[f.key] ??= { flagged: 0, total: 0 };
      out[f.key].total += 1;
      if (f.flagged) out[f.key].flagged += 1;
    }
  }
  return out;
}
