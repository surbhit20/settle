import { getPool } from "@/lib/db";
import { evaluateRisks, flagPrevalence, type Metric, type MetricMap, type RiskFlag, type RiskKey } from "@/lib/risks";

// Everything the detail card needs for one area.
export type AreaDetails = {
  zcta: string;
  name: string | null;
  county: string;
  population: number | null;
  metrics: MetricMap;
  risks: RiskFlag[];
  // How many of the region's areas share each flag, for context on the card.
  prevalence: Record<RiskKey, { flagged: number; total: number }>;
};

const METRICS_SQL = `
  SELECT zcta, metric_name, value, value_text, unit, source, source_url, status,
         confidence, notes, dataset_vintage, fetched_at::text AS fetched_at
  FROM area_metrics
`;

type MetricRow = Metric & { zcta: string };

// Group flat metric rows into { zcta: { metric_name: Metric } }. Pure, so it is unit tested.
export function groupMetrics(rows: MetricRow[]): Record<string, MetricMap> {
  const byArea: Record<string, MetricMap> = {};
  for (const { zcta, ...metric } of rows) {
    byArea[zcta] ??= {};
    byArea[zcta][metric.metric_name] = metric;
  }
  return byArea;
}

// Returns null when the ZCTA is not one of our areas.
export async function getAreaDetails(zcta: string): Promise<AreaDetails | null> {
  const pool = getPool();
  const area = await pool.query<{ zcta: string; name: string | null; county: string; population: number | null }>(
    "SELECT zcta, name, county, population FROM areas WHERE zcta = $1",
    [zcta],
  );
  if (area.rows.length === 0) return null;

  // All areas' metrics (~3k rows): needed anyway for the region-wide prevalence counts.
  const { rows } = await pool.query<MetricRow>(METRICS_SQL);
  const byArea = groupMetrics(rows);
  const metrics = byArea[zcta] ?? {};

  return {
    ...area.rows[0],
    metrics,
    risks: evaluateRisks(metrics),
    prevalence: flagPrevalence(Object.values(byArea)),
  };
}
