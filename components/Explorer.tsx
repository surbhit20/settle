"use client";

import { useMemo, useRef, useState } from "react";
import AreaCard from "@/components/AreaCard";
import AreaMap from "@/components/AreaMap";
import ChatBox from "@/components/ChatBox";
import CompareView from "@/components/CompareView";
import ScoreBreakdown from "@/components/ScoreBreakdown";
import SearchForm from "@/components/SearchForm";
import TopList from "@/components/TopList";
import type { ChatReply } from "@/lib/agent/types";
import type { ScoreRequest, ScoreResponse } from "@/lib/scoring/request";
import type { Priorities } from "@/lib/scoring/types";

const MAX_COMPARE = 3; // columns in the comparison

// Owns the page state: the last request, the scoring result, and which area is selected.
// The form, map, list and card all read from here.
export default function Explorer() {
  const [result, setResult] = useState<ScoreResponse | null>(null);
  const [lastRequest, setLastRequest] = useState<ScoreRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedZcta, setSelectedZcta] = useState<string | null>(null);
  // Areas shown side by side (2-3); outlined in blue on the map. Fewer than 2 = no comparison.
  const [compared, setCompared] = useState<string[]>([]);
  // The little "Open / Add to compare" menu shown where the user clicked on the map.
  const [chooser, setChooser] = useState<{ zcta: string; name: string | null; x: number; y: number } | null>(null);
  // When the chat changes inputs, the form is refilled by remounting it with these values.
  const [formSeed, setFormSeed] = useState<ScoreRequest | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const [revealKey, setRevealKey] = useState(0); // bumped after each search; TopList scrolls into view
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0); // ignore responses to requests that have been superseded


  // Returns true when new results arrived (false on error or when a newer request replaced it).
  async function runScore(req: ScoreRequest): Promise<boolean> {
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
      if (id !== requestIdRef.current) return false; // a newer request is in flight
      if (!res.ok) {
        setError(body.error ?? `Something went wrong (HTTP ${res.status}).`);
        return false;
      }
      setResult(body as ScoreResponse);
      setLastRequest(req);
      return true;
    } catch {
      if (id === requestIdRef.current) setError("Could not reach the server.");
      return false;
    } finally {
      if (id === requestIdRef.current) setLoading(false);
    }
  }

  // The search button: score, then bring the top 5 into view. Each successful search bumps
  // `revealKey`, which TopList watches to scroll itself into view and flash a highlight.
  // (Slider and chat rescoring don't scroll, so the view doesn't jump while adjusting.)
  async function submitSearch(req: ScoreRequest) {
    if (await runScore(req)) setRevealKey((k) => k + 1);
  }

  // Sliders moved after a result: rescore with the same inputs, at most every 300 ms.
  // Geocode and commute are cached server-side, so this costs no API calls.
  function handlePrioritiesChange(priorities: Priorities) {
    if (!lastRequest) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runScore({ ...lastRequest, priorities }), 300);
  }

  // Apply the actions a chat reply carries. Both routes (Jev fast path, Claude) emit the same shapes.
  function handleChatReply(reply: ChatReply) {
    if (!lastRequest) return;
    let next = lastRequest;
    for (const action of reply.actions) {
      if (action.type === "update_filter") next = { ...next, ...action.changes };
      if (action.type === "set_priority") next = { ...next, priorities: action.priorities };
      if (action.type === "select_area") {
        setSelectedZcta(action.zcta);
        setCompared([]);
      }
      if (action.type === "compare") {
        setCompared(action.zctas.slice(0, MAX_COMPARE));
        setSelectedZcta(null);
      }
    }
    if (next !== lastRequest) {
      setFormSeed(next);
      setFormVersion((v) => v + 1); // new key -> SearchForm remounts showing the new values
      runScore(next);
    }
  }

  // --- Opening and comparing areas ---
  const comparing = compared.length >= 2;

  function openArea(zcta: string) {
    setChooser(null);
    setCompared([]);
    setSelectedZcta(zcta);
  }

  // Add to the comparison. Starts one from the open card; when full, the last column is replaced.
  function addToCompare(zcta: string) {
    setChooser(null);
    const base = comparing ? compared : selectedZcta ? [selectedZcta] : [];
    if (base.includes(zcta)) return;
    setCompared(base.length >= MAX_COMPARE ? [...base.slice(0, MAX_COMPARE - 1), zcta] : [...base, zcta]);
    setSelectedZcta(null);
  }

  function removeFromCompare(zcta: string) {
    const next = compared.filter((z) => z !== zcta);
    if (next.length >= 2) return setCompared(next);
    openArea(next[0]); // one left: show its card
  }

  // A click on the map. With nothing open it opens the area; with an area or a comparison open,
  // it asks first: open this one instead, or add it to the comparison.
  function handleMapSelect(zcta: string, point?: { x: number; y: number; name: string | null }) {
    const busyWithOther = (selectedZcta !== null && zcta !== selectedZcta) || (comparing && !compared.includes(zcta));
    if (busyWithOther && point) setChooser({ zcta, name: point.name, x: point.x, y: point.y });
    else if (!comparing) openArea(zcta);
  }

  // useMemo recomputes only when `result` changes, not on every render.
  const scores = useMemo(
    () => (result ? Object.fromEntries(result.ranked.map((a) => [a.zcta, a.score])) : null),
    [result],
  );
  const selectedScored = result?.ranked.find((a) => a.zcta === selectedZcta);
  const selectedFiltered = result?.filtered.find((a) => a.zcta === selectedZcta);
  // Name of the open area for the chat ("Los Altos 94022"); found in either list.
  const selectedArea = selectedScored ?? selectedFiltered;
  const labelOf = (z: string) => {
    const a = result?.ranked.find((x) => x.zcta === z) ?? result?.filtered.find((x) => x.zcta === z);
    return `${a?.name ?? "Area"} ${z}`;
  };
  const selectedLabel = comparing
    ? compared.map(labelOf).join(" vs ")
    : selectedArea
      ? `${selectedArea.name ?? "Area"} ${selectedArea.zcta}`
      : null;

  return (
    // Phones: map on top (55% of the screen), sidebar below, the whole page scrolls; a card
    // opened from the map starts right under it, so both stay in view.
    // Desktop (md and up): sidebar left with its own scroll, map fills the rest.
    <div className="flex flex-1 flex-col md:min-h-0 md:flex-row">
      {/* While comparing, the sidebar widens over part of the map to fit the columns. */}
      <aside
        // [scrollbar-width:none] and the ::-webkit-scrollbar rule hide the scroll bar; the
        // sidebar still scrolls with a wheel, trackpad, touch or keyboard.
        className={`relative w-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden shrink-0 bg-paper px-5 pb-24 pt-6 md:overflow-y-auto md:border-r md:border-line md:px-7 md:pb-6 ${
          comparing ? "md:w-[min(46rem,68vw)]" : "md:w-[26rem] lg:w-[28rem]"
        }`}
      >
        {comparing ? (
          <CompareView
            zctas={compared}
            result={result}
            homeType={result?.homeType ?? "any"}
            onRemove={removeFromCompare}
            onOpen={openArea}
            onClose={() => setCompared([])}
          />
        ) : selectedZcta ? (
          // key: a new ZIP means a new card (and a fresh fetch), not an update to the old one.
          <AreaCard
            key={selectedZcta}
            zcta={selectedZcta}
            onClose={() => setSelectedZcta(null)}
            homeType={result?.homeType}
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
        <div className={selectedZcta || comparing ? "hidden" : "flex flex-col gap-6"}>
          <SearchForm
            key={formVersion}
            initial={formSeed}
            onSubmit={submitSearch}
            onPrioritiesChange={handlePrioritiesChange}
            loading={loading}
            hasResult={result !== null}
          />
          {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
          {result && (
            <TopList ranked={result.ranked} filteredCount={result.filtered.length} onSelect={openArea} revealKey={revealKey} />
          )}
        </div>
      </aside>

      <div className="relative order-first h-[55vh] shrink-0 md:order-none md:h-auto md:flex-1">
        <AreaMap
          scores={scores}
          selectedZcta={selectedZcta}
          compared={compared}
          busy={loading}
          onSelect={handleMapSelect}
          office={result ? { lat: result.office.lat, lng: result.office.lng } : null}
        />
        {chooser && (
          <AreaChooser
            name={chooser.name ?? `ZIP ${chooser.zcta}`}
            zcta={chooser.zcta}
            x={chooser.x}
            y={chooser.y}
            full={compared.length >= MAX_COMPARE}
            onOpen={() => openArea(chooser.zcta)}
            onCompare={() => addToCompare(chooser.zcta)}
            onDismiss={() => setChooser(null)}
          />
        )}
      </div>

      {/* Chat window docked to the bottom-right of the screen (not part of the layout), shown once
          there are results to ask about. */}
      {lastRequest && (
        <ChatBox request={lastRequest} onReply={handleChatReply} view={{ selectedZcta, compared }} viewLabel={selectedLabel} />
      )}
    </div>
  );
}

// Small menu at the click point on the map. Positioned with min() so it never spills past the
// map's right or bottom edge.
function AreaChooser(props: {
  name: string;
  zcta: string;
  x: number;
  y: number;
  full: boolean;
  onOpen: () => void;
  onCompare: () => void;
  onDismiss: () => void;
}) {
  const { name, zcta, x, y, full, onOpen, onCompare, onDismiss } = props;
  return (
    <div
      role="dialog"
      aria-label={`${name} options`}
      className="absolute z-20 w-56 rounded-2xl border border-line bg-surface p-3 text-sm shadow-xl"
      style={{ left: `min(${x}px, calc(100% - 15rem))`, top: `min(${y + 8}px, calc(100% - 10rem))` }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-serif text-lg leading-tight">{name}</div>
          <div className="text-xs text-muted">{zcta}</div>
        </div>
        <button type="button" onClick={onDismiss} className="text-muted hover:text-ink" aria-label="Close">
          ×
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        <button type="button" onClick={onOpen} className="rounded-full border border-line px-3 py-2 text-left transition hover:bg-sunken">
          Open this area
        </button>
        <button type="button" onClick={onCompare} className="rounded-full bg-accent px-3 py-2 text-left font-semibold text-accent-ink transition hover:opacity-90">
          {full ? "Swap into comparison" : "Add to compare"}
        </button>
      </div>
    </div>
  );
}
