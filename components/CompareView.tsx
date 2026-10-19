"use client";

import { Fragment, useEffect, useState, type CSSProperties } from "react";
import type { AreaDetails } from "@/lib/areaDetails";
import { buildCompareSections, type Cell } from "@/lib/compare";
import type { ScoreResponse } from "@/lib/scoring/request";
import type { HomeType } from "@/lib/scoring/types";

type Props = {
  zctas: string[]; // 2 or 3 areas, in column order
  result: ScoreResponse | null; // scores, if the user has searched
  homeType: HomeType;
  onRemove: (zcta: string) => void;
  onOpen: (zcta: string) => void; // show one area's full card
  onClose: () => void;
};

// Side-by-side comparison. Everything is one CSS grid (a label column plus one column per area),
// so every row lines up across areas and the whole table scrolls together with the sidebar.
export default function CompareView({ zctas, result, homeType, onRemove, onOpen, onClose }: Props) {
  // Details per ZIP, kept as areas are added so an added column doesn't refetch the others.
  const [details, setDetails] = useState<Record<string, AreaDetails>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const missing = zctas.filter((z) => !details[z]);
    if (missing.length === 0) return;
    Promise.all(
      missing.map(async (z) => {
        const res = await fetch(`/api/areas/${z}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as AreaDetails;
      }),
    )
      .then((list) => {
        if (cancelled) return;
        // The callback form (d => ...) builds on the latest state, not the one this effect saw.
        setDetails((d) => ({ ...d, ...Object.fromEntries(list.map((x) => [x.zcta, x])) }));
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [zctas, details]);

  const loaded = zctas.every((z) => details[z]);
  const cols = loaded
    ? zctas.map((z) => ({
        details: details[z],
        scored: result?.ranked.find((a) => a.zcta === z),
        filtered: result?.filtered.find((a) => a.zcta === z),
      }))
    : [];
  const sections = loaded ? buildCompareSections(cols, homeType, result !== null) : [];

  // Grid columns: labels get 8.5rem; areas share the rest equally. minmax(0, 1fr) lets long
  // values wrap instead of stretching a column.
  const gridStyle: CSSProperties = { gridTemplateColumns: `8.5rem repeat(${zctas.length}, minmax(0, 1fr))` };

  return (
    <div className="text-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-serif text-3xl leading-tight">Compare</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-line px-3 py-1.5 text-xs text-muted transition hover:bg-sunken hover:text-ink"
        >
          Close comparison
        </button>
      </div>
      <p className="-mt-2 text-xs text-muted">
        The better value in each row is highlighted. Click another area on the map to add it.
      </p>

      {error && <p className="text-red-600">Could not load an area: {error}</p>}
      {!loaded && !error && <p className="text-muted">Loading…</p>}

      {loaded && (
        <div className="grid" style={gridStyle}>
          {/* Header row, sticky so area names stay visible while scrolling (see STICKY). */}
          <div className={`${STICKY} -mx-px`} />
          {cols.map((c) => (
            <div key={c.details.zcta} className={`${STICKY} px-2 pb-3`}>
              <div className="flex items-start justify-between gap-1">
                <button type="button" onClick={() => onOpen(c.details.zcta)} className="min-w-0 text-left" title="Open the full card">
                  <span className="block truncate font-serif text-xl leading-tight hover:underline">{c.details.name ?? "Area"}</span>
                  <span className="text-xs text-muted">{c.details.zcta}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(c.details.zcta)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-sunken hover:text-ink"
                  aria-label={`Remove ${c.details.name ?? c.details.zcta} from the comparison`}
                >
                  ×
                </button>
              </div>
            </div>
          ))}

          {sections.map((s) => (
            // Fragment: groups the section's cells without adding a wrapper element to the grid.
            <Fragment key={s.title}>
              <h3
                className="pb-2 pt-6 text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-muted"
                style={{ gridColumn: "1 / -1" }} // span every column
              >
                {s.title}
              </h3>
              {s.rows.map((r) => (
                <Fragment key={r.key}>
                  <div className="border-b border-line py-2.5 pr-2 text-muted">
                    <span className={r.yourPick ? "font-semibold text-ink" : undefined}>{r.label}</span>
                    {r.yourPick && (
                      <span className="mt-1 block w-fit rounded-full bg-accent-soft px-2 py-0.5 text-[0.75rem] font-medium text-accent">your pick</span>
                    )}
                  </div>
                  {r.cells.map((cell, i) => (
                    <ValueCell key={i} cell={cell} best={r.best.includes(i)} />
                  ))}
                </Fragment>
              ))}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

// Pinned 1.5rem above the scroll area's top (-top-6) with matching extra padding (pt-7), so the
// header covers the sidebar's top padding while scrolling and rows never peek out above it.
const STICKY = "sticky -top-6 z-10 border-b border-line bg-paper pt-7";

function ValueCell({ cell, best }: { cell: Cell; best: boolean }) {
  return (
    // `relative` keeps the screen-reader-only "(better)" label (position: absolute) inside this
    // cell; otherwise it's placed against the whole page and makes the page itself scroll.
    <div className="relative border-b border-line px-1 py-1.5" title={cell.title}>
      <div className={`rounded-lg px-2 py-1 ${best ? "bg-accent-soft" : ""}`}>
        <div className={`tabular-nums ${best ? "font-semibold text-accent" : cell.value === null ? "text-muted" : "font-medium"}`}>
          {cell.text}
          {best && <span className="sr-only"> (better)</span>}
        </div>
        {cell.source && (
          <a
            href={cell.source.url}
            target="_blank"
            rel="noreferrer"
            title={cell.source.vintage ?? undefined}
            className="block truncate text-[0.75rem] text-muted underline decoration-dotted underline-offset-2 hover:text-ink"
          >
            {cell.source.name}
          </a>
        )}
      </div>
    </div>
  );
}
