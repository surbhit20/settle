// Side-by-side comparison: turns 2-3 areas into one table of matched rows (the same metric in
// every column) and marks the better value in each row. Pure, so it is unit tested; the
// component only draws what this returns.

import type { AreaDetails } from "@/lib/areaDetails";
import type { Metric } from "@/lib/risks";
import { HOME_TYPES } from "@/lib/scoring/config";
import type { FilteredArea, HomeType, ScoredArea, SubScoreKey } from "@/lib/scoring/types";

// Which way is better for a row. null = neither (e.g. population): nothing is highlighted.
export type Better = "higher" | "lower" | null;

export type CellSource = { name: string; url: string; vintage?: string | null };

export type Cell = {
  text: string;
  value: number | null; // what "better" compares; null = no data, never highlighted
  source?: CellSource | null;
  title?: string; // extra detail on hover
};

export type Row = {
  key: string;
  label: string;
  better: Better;
  cells: Cell[]; // one per area, in column order
  best: number[]; // column indexes to highlight (ties all count)
  yourPick?: boolean; // the user's chosen home size
};

export type Section = { title: string; rows: Row[] };

export type CompareColumn = {
  details: AreaDetails;
  scored?: ScoredArea;
  filtered?: FilteredArea;
};

const ACS = { name: "Census ACS 5-year", url: "https://www.census.gov/programs-surveys/acs" };

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
const dist = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

// Indexes of the best value(s), or [] when fewer than two areas have data or all are equal
// (highlighting a tie between everyone would say nothing).
export function bestIndexes(values: (number | null)[], better: Better): number[] {
  if (better === null) return [];
  const known = values.filter((v): v is number => v !== null);
  if (known.length < 2) return [];
  const target = better === "higher" ? Math.max(...known) : Math.min(...known);
  if (known.every((v) => v === target)) return [];
  return values.flatMap((v, i) => (v === target ? [i] : []));
}

function row(key: string, label: string, better: Better, cells: Cell[], extra: Partial<Row> = {}): Row {
  return { key, label, better, cells, best: bestIndexes(cells.map((c) => c.value), better), ...extra };
}

function sourceOf(m: Metric): CellSource {
  return { name: m.source.replace(/_/g, " "), url: m.source_url, vintage: m.dataset_vintage };
}

// One metric from the area's metric map, formatted; "No data" unless its status is ok.
function metricCell(m: Metric | undefined, format: (v: number) => string): Cell {
  if (!m) return { text: "No data", value: null };
  if (m.status !== "ok" || m.value === null) return { text: "No data", value: null, source: sourceOf(m), title: m.notes ?? undefined };
  return { text: format(m.value), value: m.value, source: sourceOf(m) };
}

const SUB_LABELS: Record<SubScoreKey, string> = {
  affordability: "Affordability",
  commute: "Commute",
  safety: "Safety",
  risks: "Hidden risks",
};

export function buildCompareSections(cols: CompareColumn[], homeType: HomeType = "any", hasResult = true): Section[] {
  const sections: Section[] = [];
  const metric = (name: string, label: string, better: Better, format: (v: number) => string, extra?: Partial<Row>) =>
    row(name, label, better, cols.map((c) => metricCell(c.details.metrics[name], format)), extra);

  // 1. Your score (only after a search).
  if (hasResult) {
    const notRanked = (c: CompareColumn): Cell =>
      c.filtered ? { text: "Filtered out", value: null, title: c.filtered.detail } : { text: "—", value: null };
    const rows: Row[] = [
      row("score", "Your score", "higher", cols.map((c) => (c.scored ? { text: c.scored.score.toFixed(0), value: c.scored.score } : notRanked(c)))),
      row("rank", "Rank", "lower", cols.map((c) => (c.scored ? { text: `#${c.scored.rank}`, value: c.scored.rank } : notRanked(c)))),
    ];
    for (const k of Object.keys(SUB_LABELS) as SubScoreKey[]) {
      rows.push(
        row(`sub_${k}`, SUB_LABELS[k], "higher", cols.map((c) => {
          const sub = c.scored?.subScores[k];
          if (!sub) return notRanked(c);
          return sub.score === null
            ? { text: "No data", value: null, title: sub.explanation }
            : { text: sub.score.toFixed(0), value: sub.score, title: sub.explanation };
        })),
      );
    }
    // Both commute modes, whichever one the user scores on.
    const commuteRow = (key: "drive_min" | "transit_min", label: string, sourceIdx: (c: CompareColumn) => number) =>
      row(key, label, "lower", cols.map((c) => {
        const sub = c.scored?.subScores.commute;
        const min = sub?.inputs[key];
        if (typeof min !== "number") return c.filtered ? { text: "—", value: null, title: c.filtered.detail } : { text: "No data", value: null };
        const src = sub!.sources[sourceIdx(c)];
        return { text: `${Math.round(min)} min`, value: Math.round(min), source: src ? { name: src.name, url: src.url, vintage: src.vintage } : null };
      }));
    // The chosen mode's source is listed first in sub.sources, the other mode's second.
    const isTransit = (c: CompareColumn) => c.scored?.subScores.commute.inputs.mode === "transit";
    rows.push(
      commuteRow("drive_min", "Drive to your office", (c) => (isTransit(c) ? 1 : 0)),
      commuteRow("transit_min", "Public transit (typical weekday am)", (c) => (isTransit(c) ? 0 : 1)),
    );
    sections.push({ title: "Your score", rows });
  }

  // 2. Housing. Rent by home size: each size is its own row, so sizes line up across areas.
  const housing: Row[] = [metric("rent_zori_usd", "Typical rent", "lower", (v) => `${usd(v)}/mo`, { yourPick: homeType === "any" })];
  for (const t of Object.keys(HOME_TYPES) as HomeType[]) {
    if (t === "any") continue;
    const label = HOME_TYPES[t].label + (t === "shared" ? " (estimate)" : "");
    housing.push(metric(HOME_TYPES[t].metric, label, "lower", (v) => `${usd(v)}/mo`, { yourPick: t === homeType }));
  }
  housing.push(
    metric("rent_zori_usd_3yr_change_pct", "Rent change, 3 yrs", "lower", pct),
    metric("home_value_zhvi_usd", "Typical home value", null, usd),
    row("population", "Population", null, cols.map((c) =>
      c.details.population === null
        ? { text: "No data", value: null, source: ACS }
        : { text: c.details.population.toLocaleString("en-US"), value: c.details.population, source: ACS },
    )),
  );
  sections.push({ title: "Housing", rows: housing });

  // 3. Hidden risks: clear beats flagged; "No data" is never treated as clear.
  const riskKeys = cols[0]?.details.risks.map((r) => r.key) ?? [];
  sections.push({
    title: "Hidden risks",
    rows: riskKeys.map((key) => {
      const label = cols[0].details.risks.find((r) => r.key === key)!.label;
      return row(`risk_${key}`, label, "lower", cols.map((c) => {
        const r = c.details.risks.find((x) => x.key === key);
        const src = r?.sources[0];
        const source = src ? sourceOf(src) : null;
        if (!r || r.flagged === null) return { text: "No data", value: null, source, title: r?.detail };
        return { text: r.flagged ? "Flagged" : "Clear", value: r.flagged ? 1 : 0, source, title: r.detail };
      }));
    }),
  });

  // 4. City-wide crime (FBI), per 1,000 residents a year.
  sections.push({
    title: "City-wide crime (FBI)",
    rows: [
      metric("fbi_violent_per_1000", "Violent, per 1,000", "lower", (v) => v.toFixed(1)),
      metric("fbi_property_per_1000", "Property, per 1,000", "lower", (v) => v.toFixed(1)),
    ],
  });

  // 5. More about the area. Airport and major road distance are left neutral: closer can mean
  //    noise or convenience depending on the person.
  sections.push({
    title: "More about the area",
    rows: [
      metric("landslide_susceptibility_index", "Landslide susceptibility", "lower", (v) => `${v} / 81`),
      metric("fiber_provider_count", "Fiber internet providers", "higher", (v) => String(v)),
      metric("days_above_32c_annual_count", "Days above 32°C a year", "lower", (v) => String(v)),
      metric("nearest_airport_distance_m", "Nearest airport", null, dist),
      metric("nearest_major_road_distance_m", "Nearest major road", null, dist),
    ],
  });

  return sections;
}
