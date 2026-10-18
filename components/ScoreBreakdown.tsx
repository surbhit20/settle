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

// "Why this area scored what it did": final score, each sub-score with its weight, the plain
// explanation, the raw inputs (in the explanation) and source links.
export default function ScoreBreakdown({ scored, filtered, total, unavailable }: Props) {
  if (filtered) {
    return (
      <div className="rounded-md bg-zinc-100 p-2 text-sm dark:bg-zinc-800">
        <span className="font-medium">Filtered out:</span> {filtered.detail}
      </div>
    );
  }
  if (!scored) return null;

  return (
    <div className="rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold">Your score</span>
        <span className="text-sm">
          <span className="text-xl font-bold tabular-nums">{scored.score.toFixed(0)}</span>
          <span className="text-zinc-500"> / 100 · #{scored.rank} of {total}</span>
        </span>
      </div>
      {scored.partial && (
        <p className="text-xs text-amber-800 dark:text-amber-300">
          Partial data: {scored.missing.length > 0 ? `no ${scored.missing.join(", ")} data` : "some risk data missing"}, so
          the score uses the other parts, reweighted.
          {scored.missing.includes("affordability") && " Ranked after every area with known rent, since we can't confirm it fits your budget."}
        </p>
      )}
      <ul className="mt-1">
        {(Object.keys(LABELS) as SubScoreKey[]).map((k) => {
          const sub = scored.subScores[k];
          const weight = Math.round(scored.weightsUsed[k] * 100);
          if (unavailable.includes(k)) {
            return (
              <li key={k} className="py-1 text-xs text-zinc-500">
                {LABELS[k]}: not scored yet (data coming in a later update)
              </li>
            );
          }
          return (
            <li key={k} className="py-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="w-24 shrink-0">{LABELS[k]}</span>
                {/* A simple bar: width = sub-score percent. */}
                <span className="h-2 flex-1 rounded bg-zinc-200 dark:bg-zinc-700">
                  <span
                    className="block h-2 rounded bg-emerald-600"
                    style={{ width: `${sub.score ?? 0}%`, opacity: sub.score === null ? 0 : 1 }}
                  />
                </span>
                <span className="w-16 text-right tabular-nums">
                  {sub.score === null ? "no data" : sub.score.toFixed(0)}
                  <span className="text-xs text-zinc-500"> ×{weight}%</span>
                </span>
              </div>
              <div className="text-xs text-zinc-600 dark:text-zinc-400">
                {sub.explanation}{" "}
                {sub.sources.map((s) => (
                  <a key={s.name} href={s.url} target="_blank" rel="noreferrer" className="mr-1 underline decoration-dotted" title={s.vintage ?? undefined}>
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
