"use client";

import { useEffect, useState } from "react";
import type { AreaDetails } from "@/lib/areaDetails";
import type { Metric, RiskFlag } from "@/lib/risks";
import SourceLink from "@/components/SourceLink";

const ACS_URL = "https://www.census.gov/programs-surveys/acs";

// Formatting helpers. Each returns "No data" for missing values, never 0.
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
const dist = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

// One labelled number with its source link. `format` turns the raw value into text.
function MetricRow({ label, metric, format }: { label: string; metric?: Metric; format: (m: Metric) => string }) {
  const hasData = metric?.status === "ok";
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right">
        {hasData ? format(metric) : <span className="text-zinc-400" title={metric?.notes ?? undefined}>No data</span>}
        {metric && (
          <>
            {" "}
            <SourceLink metric={metric} />
          </>
        )}
      </dd>
    </div>
  );
}

function RiskRow({ risk, flagged, total }: { risk: RiskFlag; flagged: number; total: number }) {
  // Three states: flagged, clear, or unknown (no data is never shown as clear).
  const badge =
    risk.flagged === null
      ? { text: "?", cls: "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300", sr: "No data" }
      : risk.flagged
        ? { text: "!", cls: "bg-amber-500 text-white", sr: "Flagged" }
        : { text: "✓", cls: "bg-emerald-600 text-white", sr: "Clear" };
  return (
    <li className="flex gap-2 py-1.5">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${badge.cls}`}
        aria-label={badge.sr}
      >
        {badge.text}
      </span>
      <div className="min-w-0">
        <div className="font-medium">
          {risk.label}{" "}
          {/* Regional context: is this flag unusual, or does almost every area have it? */}
          <span className="text-xs font-normal text-zinc-500">
            {flagged} of {total} areas flagged
          </span>
        </div>
        <div className="text-zinc-600 dark:text-zinc-400">{risk.detail}</div>
        <div className="flex flex-wrap gap-x-2">
          {/* Two metrics can share a source (e.g. both USACE NID); show each source once. */}
          {risk.sources
            .filter((s, i, all) => all.findIndex((o) => o.source === s.source) === i)
            .map((s) => (
              <SourceLink key={s.metric_name} metric={s} />
            ))}
        </div>
      </div>
    </li>
  );
}

export default function AreaCard({ zcta, onClose }: { zcta: string; onClose: () => void }) {
  const [details, setDetails] = useState<AreaDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetches once per card. The parent renders <AreaCard key={zcta}>, so selecting another area
  // creates a brand-new card with fresh (empty) state instead of reusing this one.
  useEffect(() => {
    let cancelled = false; // ignore a slow response if the card was closed meanwhile
    fetch(`/api/areas/${zcta}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as AreaDetails;
      })
      .then((d) => !cancelled && setDetails(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [zcta]);

  if (error) return <p className="text-red-600">Could not load {zcta}: {error}</p>;
  if (!details) return <p className="text-zinc-500">Loading {zcta}…</p>;

  const m = details.metrics;
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">
            {details.name ?? "Unnamed area"} <span className="font-normal text-zinc-500">{details.zcta}</span>
          </h2>
          <p className="text-zinc-600 dark:text-zinc-400">{details.county} County</p>
        </div>
        <button
          onClick={onClose}
          className="rounded px-2 text-lg leading-none text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          aria-label="Close details"
        >
          ×
        </button>
      </div>

      <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Housing</h3>
      <dl>
        <MetricRow label="Typical rent" metric={m.rent_zori_usd} format={(x) => `${usd(x.value!)}/mo`} />
        <MetricRow label="Rent, 3-yr change" metric={m.rent_zori_usd_3yr_change_pct} format={(x) => pct(x.value!)} />
        <MetricRow label="Typical home value" metric={m.home_value_zhvi_usd} format={(x) => usd(x.value!)} />
        <div className="flex items-baseline justify-between gap-2 py-0.5">
          <dt className="text-zinc-500">Population</dt>
          <dd>
            {details.population === null ? "No data" : details.population.toLocaleString("en-US")}{" "}
            <a className="text-xs text-zinc-500 underline decoration-dotted" href={ACS_URL} target="_blank" rel="noreferrer">
              Census ACS 5-year
            </a>
          </dd>
        </div>
      </dl>

      <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Hidden risks</h3>
      <ul>
        {details.risks.map((r) => (
          <RiskRow key={r.key} risk={r} {...details.prevalence[r.key]} />
        ))}
      </ul>

      <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">More about the area</h3>
      <dl>
        <MetricRow label="Landslide susceptibility" metric={m.landslide_susceptibility_index} format={(x) => `${x.value} / 81`} />
        {/* USGS scale: 0-81 = susceptible 10 m cells within the surrounding 90 m cell. */}
        <MetricRow label="Fiber internet providers" metric={m.fiber_provider_count} format={(x) => String(x.value)} />
        <MetricRow label="Days above 32°C a year" metric={m.days_above_32c_annual_count} format={(x) => String(x.value)} />
        <MetricRow label="Nearest airport" metric={m.nearest_airport_distance_m} format={(x) => dist(x.value!)} />
        <MetricRow label="Nearest major road" metric={m.nearest_major_road_distance_m} format={(x) => dist(x.value!)} />
      </dl>
      <p className="mt-2 text-xs text-zinc-500">
        Point values are measured at the area&apos;s population-weighted center, not every address.
      </p>
    </div>
  );
}
