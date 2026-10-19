"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { AreaDetails } from "@/lib/areaDetails";
import type { Metric, RiskFlag } from "@/lib/risks";
import SourceLink from "@/components/SourceLink";
import { HOME_TYPES } from "@/lib/scoring/config";
import type { HomeType } from "@/lib/scoring/types";

const ACS_URL = "https://www.census.gov/programs-surveys/acs";

// Shared styles: a small uppercase section title, and the rounded panel each section sits in.
const SECTION = "mt-7 mb-2 text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-muted";
const PANEL = "rounded-2xl border border-line bg-surface px-4";
const SOURCE_LINK = "text-[0.75rem] text-muted underline decoration-dotted underline-offset-2 hover:text-ink";

// Formatting helpers. Each returns "No data" for missing values, never 0.
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
const dist = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

// Pulls "N of 12 months reported" and the California average out of the FBI note written by
// pipeline/settle_pipeline/load_fbi.py, e.g. ", 6 of 12 months reported (annualized); California 3.4 per 1,000".
function fbiContext(notes: string | null): string {
  if (!notes) return "";
  const months = notes.match(/(\d+) of 12 months reported/);
  const ca = notes.match(/California: ([\d.]+) per 1,000/);
  const parts: string[] = [];
  if (months && months[1] !== "12") parts.push(`${months[1]} of 12 months reported (annualized)`);
  if (ca) parts.push(`California average ${ca[1]} violent per 1,000`);
  return parts.length ? `; ${parts.join("; ")}` : "";
}

// One labelled number with its source link. `format` turns the raw value into text.
// `highlight` marks the user's chosen home size.
function MetricRow({
  label,
  metric,
  format,
  highlight = false,
}: {
  label: string;
  metric?: Metric;
  format: (m: Metric) => string;
  highlight?: boolean;
}) {
  const hasData = metric?.status === "ok";
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-2.5 last:border-b-0">
      <dt className={highlight ? "font-semibold text-ink" : "text-muted"}>
        {label}
        {highlight && <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[0.75rem] font-medium text-accent">your pick</span>}
      </dt>
      {/* Value on top, its source underneath in small print, so long source names never squeeze the row. */}
      <dd className="text-right">
        <div className="font-medium tabular-nums">
          {hasData ? format(metric) : <span className="font-normal text-muted" title={metric?.notes ?? undefined}>No data</span>}
        </div>
        {metric && <SourceLink metric={metric} />}
      </dd>
    </div>
  );
}

function RiskRow({ risk, flagged, total }: { risk: RiskFlag; flagged: number; total: number }) {
  // Three states: flagged, clear, or unknown (no data is never shown as clear).
  const badge =
    risk.flagged === null
      ? { text: "?", cls: "bg-sunken text-muted", sr: "No data" }
      : risk.flagged
        ? { text: "!", cls: "bg-amber-500 text-white", sr: "Flagged" }
        : { text: "✓", cls: "bg-accent text-accent-ink", sr: "Clear" };
  return (
    <li className="flex gap-3 border-b border-line py-3 last:border-b-0">
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
          <span className="text-xs font-normal text-muted">
            {flagged} of {total} areas flagged
          </span>
        </div>
        <div className="mt-0.5 text-muted">{risk.detail}</div>
        <div className="mt-1 flex flex-wrap gap-x-3">
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

// `scoreSection` (optional) is rendered above the data sections: the personal score breakdown
// after a search. ReactNode = "anything React can render".
export default function AreaCard({
  zcta,
  onClose,
  scoreSection,
  homeType = "any",
}: {
  zcta: string;
  onClose: () => void;
  scoreSection?: ReactNode;
  homeType?: HomeType; // highlights the user's chosen size in the rent list
}) {
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

  if (error) return <p className="text-sm text-red-600">Could not load {zcta}: {error}</p>;
  if (!details) return <p className="text-sm text-muted">Loading {zcta}…</p>;

  const m = details.metrics;
  return (
    <div className="text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-3xl leading-tight">{details.name ?? "Unnamed area"}</h2>
          <p className="mt-1 text-muted">
            {details.zcta} · {details.county} County
          </p>
        </div>
        <button
          onClick={onClose}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-lg leading-none text-muted transition hover:bg-sunken hover:text-ink"
          aria-label="Close details"
        >
          ×
        </button>
      </div>

      {scoreSection && <div className="mt-5">{scoreSection}</div>}

      <h3 className={SECTION}>Housing</h3>
      <dl className={PANEL}>
        <MetricRow label="Typical rent" metric={m.rent_zori_usd} format={(x) => `${usd(x.value!)}/mo`} />
        <MetricRow label="Rent, 3-yr change" metric={m.rent_zori_usd_3yr_change_pct} format={(x) => pct(x.value!)} />
      </dl>
      {/* Rent by home size (HUD, D038). The user's chosen size is highlighted. */}
      <h3 className={SECTION}>Rent by home size</h3>
      <dl className={PANEL}>
          {(Object.keys(HOME_TYPES) as HomeType[])
            .filter((t) => t !== "any")
            .map((t) => (
              <MetricRow
                key={t}
                label={HOME_TYPES[t].label + (t === "shared" ? " (estimate)" : "")}
                metric={m[HOME_TYPES[t].metric]}
                format={(x) => `${usd(x.value!)}/mo`}
                highlight={t === homeType}
              />
            ))}
      </dl>

      <h3 className={SECTION}>The area</h3>
      <dl className={PANEL}>
        <MetricRow label="Typical home value" metric={m.home_value_zhvi_usd} format={(x) => usd(x.value!)} />
        <div className="flex items-start justify-between gap-4 border-b border-line py-2.5 last:border-b-0">
          <dt className="text-muted">Population</dt>
          <dd className="text-right">
            <div className="font-medium tabular-nums">
              {details.population === null ? "No data" : details.population.toLocaleString("en-US")}
            </div>
            <a className={SOURCE_LINK} href={ACS_URL} target="_blank" rel="noreferrer">
              Census ACS 5-year
            </a>
          </dd>
        </div>
      </dl>

      <h3 className={SECTION}>Hidden risks</h3>
      <ul className={PANEL}>
        {details.risks.map((r) => (
          <RiskRow key={r.key} risk={r} {...details.prevalence[r.key]} />
        ))}
      </ul>

      {/* FBI city-level crime. Used for the safety score only where there's no neighborhood data (D040). */}
      <h3 className={SECTION}>City-wide crime (FBI)</h3>
      <dl className={PANEL}>
        <MetricRow label="Violent crime" metric={m.fbi_violent_per_1000} format={(x) => `${x.value!.toFixed(1)} per 1,000`} />
        <MetricRow label="Property crime" metric={m.fbi_property_per_1000} format={(x) => `${x.value!.toFixed(1)} per 1,000`} />
      </dl>
      {m.fbi_violent_per_1000?.value_text && (
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Whole-jurisdiction figures for {m.fbi_violent_per_1000.value_text}, July 2025 to June 2026
          {/* notes carry months reported and the California average; extract both for the reader */}
          {fbiContext(m.fbi_violent_per_1000.notes)}. Your safety score uses these only where the city
          publishes no neighborhood crime data.
        </p>
      )}

      <h3 className={SECTION}>More about the area</h3>
      <dl className={PANEL}>
        <MetricRow label="Landslide susceptibility" metric={m.landslide_susceptibility_index} format={(x) => `${x.value} / 81`} />
        {/* USGS scale: 0-81 = susceptible 10 m cells within the surrounding 90 m cell. */}
        <MetricRow label="Fiber internet providers" metric={m.fiber_provider_count} format={(x) => String(x.value)} />
        <MetricRow label="Days above 32°C a year" metric={m.days_above_32c_annual_count} format={(x) => String(x.value)} />
        <MetricRow label="Nearest airport" metric={m.nearest_airport_distance_m} format={(x) => dist(x.value!)} />
        <MetricRow label="Nearest major road" metric={m.nearest_major_road_distance_m} format={(x) => dist(x.value!)} />
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        Point values are measured at the area&apos;s population-weighted center, not every address.
      </p>
    </div>
  );
}
