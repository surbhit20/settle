"use client";

import type { FilteredArea, ScoredArea, SubScoreKey } from "@/lib/scoring/types";

const LABELS: Record<SubScoreKey, string> = {
  affordability: "Affordability",
  commute: "Commute",
  safety: "Safety",
  risks: "Hidden risks",
};

type Props = {
  scored?: ScoredArea;
  filtered?: FilteredArea;
  total: number; // how many areas were ranked
  unavailable: SubScoreKey[];
};

// "Why this area scored what it did": final score, each sub-score, the plain
// explanation, the raw inputs (in the explanation) and source links.
export default function ScoreBreakdown({ scored, filtered, total, unavailable }: Props) {
  if (filtered) {
    return (
      <div className="rounded-2xl bg-sunken px-4 py-3 text-sm leading-relaxed">
        <span className="font-medium">Filtered out:</span> {filtered.detail}
      </div>
    );
  }
  if (!scored) return null;

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-muted">Your score</div>
          <div className="mt-1 text-sm text-muted">
            Ranked #{scored.rank} of {total}
          </div>
        </div>
        <div className="font-serif text-5xl leading-none tabular-nums">
          {scored.score.toFixed(0)}
          <span className="font-sans text-sm text-muted"> /100</span>
        </div>
      </div>
      {scored.partial && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
          Partial data: {scored.missing.length > 0 ? `no ${scored.missing.join(", ")} data` : "some risk data missing"}, so
          the score uses the other parts, reweighted.
          {scored.missing.includes("affordability") && " Ranked after every area with known rent for your home size, since we can't confirm it fits your budget."}
        </p>
      )}
      <ul className="mt-3">
        {(Object.keys(LABELS) as SubScoreKey[]).map((k) => {
          const sub = scored.subScores[k];
          if (unavailable.includes(k)) {
            return (
              <li key={k} className="border-t border-line py-3 text-xs text-muted">
                {LABELS[k]}: not scored yet (data coming in a later update)
              </li>
            );
          }
          return (
            <li key={k} className="border-t border-line py-3">
              <div className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 font-medium">{LABELS[k]}</span>
                {/* A simple bar: width = sub-score percent. */}
                <span className="h-1.5 flex-1 rounded-full bg-sunken">
                  <span
                    className="block h-1.5 rounded-full bg-accent"
                    style={{ width: `${sub.score ?? 0}%`, opacity: sub.score === null ? 0 : 1 }}
                  />
                </span>
                <span className="w-14 text-right tabular-nums">{sub.score === null ? "no data" : sub.score.toFixed(0)}</span>
              </div>
              <div className="mt-1.5 text-xs leading-relaxed text-muted">
                {sub.explanation}{" "}
                {sub.sources.map((s) => (
                  <a key={s.name} href={s.url} target="_blank" rel="noreferrer" className="mr-1 underline decoration-dotted underline-offset-2 hover:text-ink" title={s.vintage ?? undefined}>
                    {s.name.replace(/_/g, " ")}
                  </a>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
