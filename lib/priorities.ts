// "Which matters more?" pair cards -> priority slider values (decisions.md D027).
// Each of the 4 priorities meets each other once: 6 pairs. A priority's slider value is
// 2 x (wins + 1), so the four values are always proportional to 1..4 and stay within 0..10,
// and nothing drops to zero.

import type { Priorities, SubScoreKey } from "@/lib/scoring/types";

export type PairCard = {
  a: SubScoreKey;
  b: SubScoreKey;
  // Concrete tradeoffs read better than abstract labels. Magnitudes are kept roughly comparable
  // so neither side looks obviously bigger; edit the wording here, not in components.
  aText: string;
  bText: string;
};

const TEXT: Record<SubScoreKey, string> = {
  affordability: "Pay about $400 a month less in rent",
  commute: "Drive about 20 minutes less each way",
  safety: "Live where reported crime is about half as common",
  risks: "Avoid flood, wildfire, earthquake, dam and chemical-plant risk flags",
};

export const PAIR_CARDS: PairCard[] = [
  ["affordability", "commute"],
  ["affordability", "safety"],
  ["affordability", "risks"],
  ["commute", "safety"],
  ["commute", "risks"],
  ["safety", "risks"],
].map(([a, b]) => ({ a, b, aText: TEXT[a as SubScoreKey], bText: TEXT[b as SubScoreKey] })) as PairCard[];

// `choices[i]` is the winner of PAIR_CARDS[i]. Unanswered cards count as no win for either side.
export function prioritiesFromChoices(choices: (SubScoreKey | null)[]): Priorities {
  const wins: Priorities = { affordability: 0, commute: 0, safety: 0, risks: 0 };
  PAIR_CARDS.forEach((card, i) => {
    const winner = choices[i];
    if (winner === card.a || winner === card.b) wins[winner] += 1;
  });
  return {
    affordability: 2 * (wins.affordability + 1),
    commute: 2 * (wins.commute + 1),
    safety: 2 * (wins.safety + 1),
    risks: 2 * (wins.risks + 1),
  };
}
