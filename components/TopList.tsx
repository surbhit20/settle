"use client";

import type { ScoredArea } from "@/lib/scoring/types";
import { scoreColor } from "@/lib/scoreScale";

type Props = { ranked: ScoredArea[]; filteredCount: number; onSelect: (zcta: string) => void };

export default function TopList({ ranked, filteredCount, onSelect }: Props) {
  if (ranked.length === 0) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        No areas match. All {filteredCount} were filtered out. Try a longer max commute or a higher budget.
      </p>
    );
  }
  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold">Top 5 for you</h2>
      <ol className="flex flex-col gap-1">
        {ranked.slice(0, 5).map((a) => (
          <li key={a.zcta}>
            <button
              onClick={() => onSelect(a.zcta)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <span className="w-4 text-zinc-500">{a.rank}</span>
              <span className="inline-block h-3 w-3 rounded-sm" style={{ background: scoreColor(a.score) }} />
              <span className="flex-1">
                {a.name ?? "Unnamed"} <span className="text-zinc-500">{a.zcta}</span>
                {a.partial && <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800">partial data</span>}
              </span>
              <span className="font-semibold tabular-nums">{a.score.toFixed(0)}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="mt-1 text-xs text-zinc-500">
        {ranked.length} areas ranked, {filteredCount} filtered out. Click any area on the map for details.
      </p>
    </div>
  );
}
