// Builds AreaInputs (what score.ts needs) from the database plus a commute map.
// Kept separate from score.ts so scoring stays pure and testable without a database.

import { groupMetrics } from "@/lib/areaDetails";
import { ORS_SOURCE } from "@/lib/commute";
import { getPool } from "@/lib/db";
import { evaluateRisks, type Metric } from "@/lib/risks";
import type { AreaInputs } from "@/lib/scoring/types";

const AREAS_SQL = `
  SELECT a.zcta, a.name, a.county,
         -- Latest crime period per area; crime_aggregates stays empty until M4, giving NULL.
         (SELECT c.rate_per_1000 FROM crime_aggregates c
           WHERE c.zcta = a.zcta ORDER BY c.period DESC LIMIT 1) AS crime_rate_per_1000
  FROM areas a
  ORDER BY a.zcta
`;

const METRICS_SQL = `
  SELECT zcta, metric_name, value, value_text, unit, source, source_url, status,
         confidence, notes, dataset_vintage, fetched_at::text AS fetched_at
  FROM area_metrics
`;

export async function loadAreaInputs(commuteByZcta: Map<string, number | null>): Promise<AreaInputs[]> {
  const pool = getPool();
  const [areas, metricRows] = await Promise.all([
    pool.query<{ zcta: string; name: string | null; county: string; crime_rate_per_1000: number | null }>(AREAS_SQL),
    pool.query<Metric & { zcta: string }>(METRICS_SQL),
  ]);
  const metricsByArea = groupMetrics(metricRows.rows);

  return areas.rows.map((a) => {
    const m = metricsByArea[a.zcta] ?? {};
    const rent = m.rent_zori_usd;
    const rentOk = rent?.status === "ok" && rent.value !== null;
    return {
      zcta: a.zcta,
      name: a.name,
      county: a.county,
      rentUsd: rentOk ? rent.value : null,
      rentSource: rent ? { name: rent.source, url: rent.source_url, vintage: rent.dataset_vintage } : null,
      commuteMin: commuteByZcta.get(a.zcta) ?? null,
      commuteSource: ORS_SOURCE,
      crimeRatePer1000: a.crime_rate_per_1000,
      crimeSource: null, // set in M4 when crime data is loaded
      risks: evaluateRisks(m),
    };
  });
}
