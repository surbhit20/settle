"use client";

import { useState, type FormEvent } from "react";
import PriorityPicker from "@/components/PriorityPicker";
import { SCORING } from "@/lib/scoring/config";
import type { ScoreRequest } from "@/lib/scoring/request";
import type { Priorities, SubScoreKey } from "@/lib/scoring/types";

type Props = {
  onSubmit: (req: ScoreRequest) => void;
  // Called when sliders move after a first result, so the map can rescore live.
  onPrioritiesChange: (p: Priorities) => void;
  loading: boolean;
  hasResult: boolean;
  unavailable: SubScoreKey[];
  // Starting values, e.g. after the chat changed a filter. The parent remounts this form
  // (with a new `key`) whenever they change, so they only need to be read once.
  initial?: ScoreRequest | null;
};

// Inputs are kept as strings while typing (an empty box is "", not 0) and converted on submit.
export default function SearchForm({ onSubmit, onPrioritiesChange, loading, hasResult, unavailable, initial }: Props) {
  const [salary, setSalary] = useState(initial ? initial.salaryUsd.toLocaleString("en-US") : "");
  const [office, setOffice] = useState(initial?.officeAddress ?? "");
  const [maxCommute, setMaxCommute] = useState(String(initial?.maxCommuteMin ?? 45));
  const [budget, setBudget] = useState(initial?.rentBudgetUsd != null ? String(initial.rentBudgetUsd) : "");
  const [priorities, setPriorities] = useState<Priorities>(initial?.priorities ?? { ...SCORING.defaultPriorities });

  function handleSubmit(e: FormEvent) {
    e.preventDefault(); // stop the browser from reloading the page
    onSubmit({
      salaryUsd: Number(salary.replace(/[$,\s]/g, "")),
      officeAddress: office,
      maxCommuteMin: Number(maxCommute),
      rentBudgetUsd: budget.trim() === "" ? null : Number(budget.replace(/[$,\s]/g, "")),
      priorities,
    });
  }

  function handlePriorities(p: Priorities) {
    setPriorities(p);
    if (hasResult) onPrioritiesChange(p);
  }

  const input = "w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="text-sm">
        <span className="mb-1 block font-medium">Annual salary (before tax)</span>
        <input className={input} inputMode="numeric" placeholder="e.g. 150,000" value={salary} onChange={(e) => setSalary(e.target.value)} required />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Office street address</span>
        <input className={input} placeholder="e.g. 1 Market St, San Francisco, CA" value={office} onChange={(e) => setOffice(e.target.value)} required />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Max commute (min)</span>
          <input className={input} inputMode="numeric" value={maxCommute} onChange={(e) => setMaxCommute(e.target.value)} required />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Rent budget / mo</span>
          <input className={input} inputMode="numeric" placeholder="optional" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </label>
      </div>
      <p className="-mt-2 text-xs text-zinc-500">
        Commute is drive time without traffic. Leave the budget empty to use 30% of your gross monthly pay.
      </p>

      <PriorityPicker priorities={priorities} onChange={handlePriorities} unavailable={unavailable} startWithSliders={!!initial} />

      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {loading ? "Scoring…" : hasResult ? "Update results" : "Show me where to live"}
      </button>
    </form>
  );
}
