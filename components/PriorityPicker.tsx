"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { optionText, PAIR_CARDS, pairKey, prioritiesFromAnswers, shuffledDeck, type Answer, type PairCard } from "@/lib/priorities";
import { SCORING } from "@/lib/scoring/config";
import { SUB_SCORE_KEYS, type CommuteMode, type Priorities, type SubScoreKey } from "@/lib/scoring/types";

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
  // Tells the form whether the pair cards are showing, so it can hide its submit button.
  onAnsweringChange?: (answering: boolean) => void;
  // Drive or public transit: the commute card's wording follows the form's choice.
  commuteMode?: CommuteMode;
};

// useSyncExternalStore with a fixed snapshot: false while the server renders the page and while
// React hydrates it, true afterwards. The shuffle only happens in the browser, so the server's
// HTML and the browser's first render match (a random order on both would differ).
const noSubscribe = () => () => {};
function useIsClient() {
  return useSyncExternalStore(noSubscribe, () => true, () => false);
}

// Step 1: up to six "which matters more?" cards (optional), in a random order with random sides
// (D049). Step 2: sliders, always editable.
export default function PriorityPicker({
  priorities,
  onChange,
  unavailable = [],
  startWithSliders = false,
  onAnsweringChange,
  commuteMode = "drive",
}: Props) {
  // `null` = not answering cards; otherwise the answers so far.
  const [answers, setAnswers] = useState<Answer[] | null>(startWithSliders ? null : []);
  const isClient = useIsClient();
  // The first deck is shuffled once the page is running in the browser; "Redo the questions"
  // deals a new one into `redealt`.
  const firstDeck = useMemo(() => (isClient ? shuffledDeck() : PAIR_CARDS), [isClient]);
  const [redealt, setRedealt] = useState<PairCard[] | null>(null);
  const deck = redealt ?? firstDeck;

  // The next card is the first one in the deck not yet answered (matched by pair, not position).
  const done = new Set((answers ?? []).map((x) => pairKey(x.card)));
  const card = deck.find((c) => !done.has(pairKey(c)));
  const answering = answers !== null && card !== undefined;

  function choose(winner: SubScoreKey) {
    if (answers === null || !card) return;
    const next = [...answers, { card, winner }];
    if (next.length >= PAIR_CARDS.length) {
      onChange(prioritiesFromAnswers(next));
      setAnswers(null); // done: show sliders
      onAnsweringChange?.(false);
    } else {
      setAnswers(next);
    }
  }

  function skip() {
    onChange({ ...SCORING.defaultPriorities }); // "Balanced"
    setAnswers(null);
    onAnsweringChange?.(false);
  }

  if (answering) {
    const i = answers.length;
    return (
      // Invisible until the deck is shuffled in the browser, so the unshuffled order never flashes.
      <div className={isClient ? undefined : "invisible"}>
        <div className="mb-3 flex items-baseline justify-between">
          <span className="font-serif text-xl">What matters more to you?</span>
          <span className="text-xs tabular-nums text-muted">
            {i + 1} of {PAIR_CARDS.length}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { key: card.a, text: optionText(card.a, commuteMode) },
            { key: card.b, text: optionText(card.b, commuteMode) },
          ].map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => choose(opt.key)}
              className="min-h-24 rounded-2xl border border-line bg-surface p-4 text-left text-sm leading-snug shadow-sm transition hover:-translate-y-0.5 hover:border-accent hover:bg-accent-soft"
            >
              {opt.text}
            </button>
          ))}
        </div>
        <button type="button" onClick={skip} className="mt-3 text-xs text-muted underline decoration-dotted underline-offset-4 hover:text-ink">
          Skip and weigh everything equally
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-serif text-xl">Your priorities</span>
        <button
          type="button"
          onClick={() => {
            setRedealt(shuffledDeck()); // a new random order and sides each time
            setAnswers([]);
            onAnsweringChange?.(true);
          }}
          className="text-xs text-muted underline decoration-dotted underline-offset-4 hover:text-ink">
          Redo the questions
        </button>
      </div>
      {SUB_SCORE_KEYS.map((k) => (
        <label key={k} className="flex items-center gap-3 py-1.5 text-sm">
          <span className="w-36 shrink-0">{LABELS[k]}</span>
          <input
            type="range"
            min={0}
            max={SCORING.priorityMax}
            step={1}
            value={priorities[k]}
            // { ...priorities, [k]: value } copies the object and replaces one key.
            onChange={(e) => onChange({ ...priorities, [k]: Number(e.target.value) })}
            className="flex-1 accent-[var(--accent)]"
          />
          <span className="w-5 text-right tabular-nums text-muted">{priorities[k]}</span>
        </label>
      ))}
      {unavailable.includes("safety") && (
        <p className="text-xs text-muted">Safety isn&apos;t scored yet: crime data arrives in a later update.</p>
      )}
    </div>
  );
}
