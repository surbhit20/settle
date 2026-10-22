"use client";

import { useState, type FormEvent } from "react";
import PriorityPicker from "@/components/PriorityPicker";
import { HOME_TYPES, SCORING } from "@/lib/scoring/config";
import type { ScoreRequest } from "@/lib/scoring/request";
import type { CommuteMode, HomeType, Priorities } from "@/lib/scoring/types";

type Props = {
  onSubmit: (req: ScoreRequest) => void;
  // Called when sliders move after a first result, so the map can rescore live.
  onPrioritiesChange: (p: Priorities) => void;
  loading: boolean;
  hasResult: boolean;
  // Starting values, e.g. after the chat changed a filter. The parent remounts this form
  // (with a new `key`) whenever they change, so they only need to be read once.
  initial?: ScoreRequest | null;
};

// Inputs are kept as strings while typing (an empty box is "", not 0) and converted on submit.
export default function SearchForm({ onSubmit, onPrioritiesChange, loading, hasResult, initial }: Props) {
  const [salary, setSalary] = useState(initial ? initial.salaryUsd.toLocaleString("en-US") : "");
  const [office, setOffice] = useState(initial?.officeAddress ?? "");
  const [maxCommute, setMaxCommute] = useState(String(initial?.maxCommuteMin ?? 45));
  const [homeType, setHomeType] = useState<HomeType>(initial?.homeType ?? "any");
  const [commuteMode, setCommuteMode] = useState<CommuteMode>(initial?.commuteMode ?? "drive");
  const [budget, setBudget] = useState(initial?.rentBudgetUsd != null ? String(initial.rentBudgetUsd) : "");
  const [priorities, setPriorities] = useState<Priorities>(initial?.priorities ?? { ...SCORING.defaultPriorities });
  // True while the "which matters more?" cards are showing. The submit button stays hidden
  // until they're answered or skipped. A refilled form (`initial`) starts on the sliders.
  const [answeringCards, setAnsweringCards] = useState(!initial);

  function handleSubmit(e: FormEvent) {
    e.preventDefault(); // stop the browser from reloading the page
    onSubmit({
      salaryUsd: Number(salary.replace(/[$,\s]/g, "")),
      officeAddress: office,
      maxCommuteMin: Number(maxCommute),
      rentBudgetUsd: budget.trim() === "" ? null : Number(budget.replace(/[$,\s]/g, "")),
      priorities,
      homeType,
      commuteMode,
    });
  }

  function handlePriorities(p: Priorities) {
    setPriorities(p);
    if (hasResult) onPrioritiesChange(p);
  }

  const input =
    "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-muted/70 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20";
  const labelText = "mb-1.5 block text-xs font-medium text-muted";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h2 className="font-serif text-2xl leading-tight">
        Find your <em>ideal</em> home
      </h2>
      <label className="block">
        <span className={labelText}>Annual salary (before tax)</span>
        <input className={input} inputMode="numeric" value={salary} onChange={(e) => setSalary(e.target.value)} required />
      </label>
      <label className="block">
        <span className={labelText}>Office street address</span>
        <input className={input} value={office} onChange={(e) => setOffice(e.target.value)} required />
      </label>
      {/* Two buttons that behave like a radio choice (role="radiogroup" for screen readers). */}
      <div>
        <span className={labelText}>How do you get to work?</span>
        <div role="radiogroup" aria-label="How do you get to work?" className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface p-1">
          {(
            [
              ["drive", "Drive"],
              ["transit", "Public transit"],
            ] as [CommuteMode, string][]
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={commuteMode === m}
              onClick={() => setCommuteMode(m)}
              className={`rounded-lg px-3 py-2 text-sm transition ${
                commuteMode === m ? "bg-accent font-semibold text-accent-ink" : "text-muted hover:bg-sunken hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={labelText}>Max commute (min)</span>
          <input className={input} inputMode="numeric" value={maxCommute} onChange={(e) => setMaxCommute(e.target.value)} required />
        </label>
        <label className="block">
          <span className={labelText}>Rent budget / mo</span>
          <input className={input} inputMode="numeric" placeholder="optional" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </label>
      </div>
      <label className="block">
        <span className={labelText}>Home size</span>
        {/* `as HomeType`: a <select> always gives back a string; the options are the only values. */}
        <select className={input} value={homeType} onChange={(e) => setHomeType(e.target.value as HomeType)}>
          {(Object.keys(HOME_TYPES) as HomeType[]).map((t) => (
            <option key={t} value={t}>
              {HOME_TYPES[t].label}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-1 border-t border-line pt-5">
        <PriorityPicker
          priorities={priorities}
          onChange={handlePriorities}
          startWithSliders={!!initial}
          onAnsweringChange={setAnsweringCards}
          commuteMode={commuteMode}
        />
      </div>

      {/* The button appears only once the questions are answered or skipped. */}
      {!answeringCards && (
        <button
          type="submit"
          disabled={loading}
          className="rounded-full bg-accent px-5 py-3 text-sm font-semibold text-accent-ink shadow-sm transition hover:opacity-90 disabled:opacity-60"
        >
          {loading ? "Scoring…" : hasResult ? "Update results" : "Show me where to live"}
        </button>
      )}
    </form>
  );
}
