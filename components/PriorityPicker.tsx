"use client";

import { useState } from "react";
import { PAIR_CARDS, prioritiesFromChoices } from "@/lib/priorities";
import { SCORING } from "@/lib/scoring/config";
import { SUB_SCORE_KEYS, type Priorities, type SubScoreKey } from "@/lib/scoring/types";

const LABELS: Record<SubScoreKey, string> = {
  affordability: "Affordability",
  commute: "Short commute",
  safety: "Safety",
  risks: "Avoid hidden risks",
};

type Props = {
  priorities: Priorities;
  onChange: (p: Priorities) => void;
  // Shown under the Safety slider while crime data isn't loaded yet.
  unavailable?: SubScoreKey[];
  // Skip the pair cards (e.g. the form was refilled after a chat change).
  startWithSliders?: boolean;
};

// Step 1: up to six "which matters more?" cards (optional). Step 2: sliders, always editable.
export default function PriorityPicker({ priorities, onChange, unavailable = [], startWithSliders = false }: Props) {
  // `null` = still answering cards; the array holds one answer per card answered so far.
  const [choices, setChoices] = useState<SubScoreKey[] | null>(startWithSliders ? null : []);

  const answering = choices !== null && choices.length < PAIR_CARDS.length;

  function choose(winner: SubScoreKey) {
    if (choices === null) return;
    const next = [...choices, winner];
    setChoices(next);
    if (next.length === PAIR_CARDS.length) {
      onChange(prioritiesFromChoices(next));
      setChoices(null); // done: show sliders
    }
  }

  function skip() {
    onChange({ ...SCORING.defaultPriorities }); // "Balanced"
    setChoices(null);
  }

  if (answering) {
    const i = choices.length;
    const card = PAIR_CARDS[i];
    return (
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-sm font-medium">What matters more to you?</span>
          <span className="text-xs text-zinc-500">
            {i + 1} of {PAIR_CARDS.length}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            { key: card.a, text: card.aText },
            { key: card.b, text: card.bText },
          ].map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => choose(opt.key)}
              className="rounded-lg border border-zinc-300 p-3 text-left text-sm hover:border-emerald-600 hover:bg-emerald-50 dark:border-zinc-700 dark:hover:bg-emerald-950"
            >
              {opt.text}
            </button>
          ))}
        </div>
        <button type="button" onClick={skip} className="mt-2 text-xs text-zinc-500 underline">
          Skip and weigh everything equally
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm font-medium">Your priorities</span>
        <button type="button" onClick={() => setChoices([])} className="text-xs text-zinc-500 underline">
          Redo the questions
        </button>
      </div>
      {SUB_SCORE_KEYS.map((k) => (
        <label key={k} className="flex items-center gap-2 py-0.5 text-sm">
          <span className="w-36 shrink-0">{LABELS[k]}</span>
          <input
            type="range"
            min={0}
            max={SCORING.priorityMax}
            step={1}
            value={priorities[k]}
            // { ...priorities, [k]: value } copies the object and replaces one key.
            onChange={(e) => onChange({ ...priorities, [k]: Number(e.target.value) })}
            className="flex-1 accent-emerald-700"
          />
          <span className="w-5 text-right tabular-nums">{priorities[k]}</span>
        </label>
      ))}
      {unavailable.includes("safety") && (
        <p className="text-xs text-zinc-500">Safety isn&apos;t scored yet: crime data arrives in a later update.</p>
      )}
    </div>
  );
}
