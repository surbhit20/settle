"use client";

import { useMemo, useRef, useState } from "react";
import AreaCard from "@/components/AreaCard";
import AreaMap from "@/components/AreaMap";
import ScoreBreakdown from "@/components/ScoreBreakdown";
import SearchForm from "@/components/SearchForm";
import TopList from "@/components/TopList";
import type { ScoreRequest, ScoreResponse } from "@/lib/scoring/request";
import type { Priorities } from "@/lib/scoring/types";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

// Owns the page state: the last request, the scoring result, and which area is selected.
// The form, map, list and card all read from here.
export default function Explorer() {
  const [result, setResult] = useState<ScoreResponse | null>(null);
  const [lastRequest, setLastRequest] = useState<ScoreRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedZcta, setSelectedZcta] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0); // ignore responses to requests that have been superseded

  async function runScore(req: ScoreRequest) {
    const id = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      const body = await res.json();
      if (id !== requestIdRef.current) return; // a newer request is in flight
      if (!res.ok) {
        setError(body.error ?? `Something went wrong (HTTP ${res.status}).`);
        return;
      }
      setResult(body as ScoreResponse);
      setLastRequest(req);
    } catch {
      if (id === requestIdRef.current) setError("Could not reach the server.");
    } finally {
      if (id === requestIdRef.current) setLoading(false);
    }
  }

  // Sliders moved after a result: rescore with the same inputs, at most every 300 ms.
  // Geocode and commute are cached server-side, so this costs no API calls.
  function handlePrioritiesChange(priorities: Priorities) {
    if (!lastRequest) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runScore({ ...lastRequest, priorities }), 300);
  }

  // useMemo recomputes only when `result` changes, not on every render.
  const scores = useMemo(
    () => (result ? Object.fromEntries(result.ranked.map((a) => [a.zcta, a.score])) : null),
    [result],
  );
  const selectedScored = result?.ranked.find((a) => a.zcta === selectedZcta);
  const selectedFiltered = result?.filtered.find((a) => a.zcta === selectedZcta);

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside className="w-full shrink-0 overflow-y-auto border-zinc-200 p-4 md:w-96 md:border-r dark:border-zinc-800">
        {selectedZcta ? (
          // key: a new ZIP means a new card (and a fresh fetch), not an update to the old one.
          <AreaCard
            key={selectedZcta}
            zcta={selectedZcta}
            onClose={() => setSelectedZcta(null)}
            scoreSection={
              result && (
                <ScoreBreakdown
                  scored={selectedScored}
                  filtered={selectedFiltered}
                  total={result.ranked.length}
                  unavailable={result.unavailableEverywhere}
                />
              )
            }
          />
        ) : null}

        {/* The form stays mounted (just hidden) while a card is open, so typed values survive. */}
        <div className={selectedZcta ? "hidden" : "flex flex-col gap-4"}>
          <SearchForm
            onSubmit={runScore}
            onPrioritiesChange={handlePrioritiesChange}
            loading={loading}
            hasResult={result !== null}
            unavailable={result?.unavailableEverywhere ?? ["safety"]}
          />
          {error && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
          {result && (
            <>
              <p className="text-xs text-zinc-500">
                Office: {result.office.address}. Budget {usd(result.budgetUsd)}/mo
                {result.budgetDerived ? " (30% of gross pay)" : ""}; areas more than 15% over it are filtered out.
              </p>
              <TopList ranked={result.ranked} filteredCount={result.filtered.length} onSelect={setSelectedZcta} />
            </>
          )}
        </div>
      </aside>

      <div className="relative min-h-[60vh] flex-1">
        <AreaMap
          scores={scores}
          selectedZcta={selectedZcta}
          onSelect={setSelectedZcta}
          office={result ? { lat: result.office.lat, lng: result.office.lng } : null}
        />
      </div>
    </div>
  );
}
