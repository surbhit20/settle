"use client";

import { useEffect, useRef } from "react";
import type { ScoredArea } from "@/lib/scoring/types";
import { scoreColor } from "@/lib/scoreScale";

type Props = {
  ranked: ScoredArea[];
  filteredCount: number;
  onSelect: (zcta: string) => void;
  // Changes after each search: scroll this list into view and briefly highlight it.
  revealKey?: number;
};

export default function TopList({ ranked, filteredCount, onSelect, revealKey = 0 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);

  // After a search, scroll to the results and flash a green ring around the list.
  // Users who prefer reduced motion get an instant jump and no flash.
  useEffect(() => {
    if (revealKey === 0 || !wrapRef.current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    wrapRef.current.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    if (!reduce) {
      listRef.current?.animate(
        [
          { boxShadow: "0 0 0 0 transparent" },
          { boxShadow: "0 0 0 4px var(--accent)", offset: 0.3 },
          { boxShadow: "0 0 0 0 transparent" },
        ],
        { duration: 1600, delay: 300, easing: "ease-out" },
      );
    }
  }, [revealKey]);

  if (ranked.length === 0) {
    return (
      <div ref={wrapRef} className="scroll-mt-4">
        <p className="rounded-2xl bg-sunken px-4 py-3 text-sm leading-relaxed text-muted">
          No areas match. All {filteredCount} were filtered out. Try a longer max commute or a higher budget.
        </p>
      </div>
    );
  }
  return (
    // scroll-mt-4: leave a little space above the heading when scrolled to.
    <div ref={wrapRef} className="scroll-mt-4">
      <h2 className="mb-3 font-serif text-2xl">Top 5 for you</h2>
      <ol ref={listRef} className="overflow-hidden rounded-2xl border border-line bg-surface">
        {ranked.slice(0, 5).map((a) => (
          <li key={a.zcta} className="border-b border-line last:border-b-0">
            <button
              onClick={() => onSelect(a.zcta)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition hover:bg-sunken"
            >
              <span className="w-4 font-serif text-lg text-muted">{a.rank}</span>
              <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: scoreColor(a.score) }} />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{a.name ?? "Unnamed"}</span> <span className="text-muted">{a.zcta}</span>
                <span className="mt-1 flex flex-wrap gap-1 empty:hidden">
                  {a.partial && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[0.75rem] text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
                      partial data
                    </span>
                  )}
                  {a.subScores.safety.inputs.basis === "city-wide (FBI)" && (
                    // Safety here is the city's FBI rate, not neighborhood data (D040).
                    <span className="rounded-full bg-sunken px-2 py-0.5 text-[0.75rem] text-muted">city-wide safety</span>
                  )}
                </span>
              </span>
              <span className="font-serif text-2xl tabular-nums">{a.score.toFixed(0)}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-muted">
        {ranked.length} areas ranked, {filteredCount} filtered out. Click any area on the map for details.
      </p>
    </div>
  );
}
