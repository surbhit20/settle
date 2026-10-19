// "Which matters more?" pair cards -> priority slider values (decisions.md D027, D049).
// Each of the 4 priorities meets each other once: 6 pairs, which is every possible pair of four
// (4 choose 2). The cards are shown in a random order with random sides (shuffledDeck). A priority's slider value is
// 2 x (wins + 1), so the four values are always proportional to 1..4 and stay within 0..10,
// and nothing drops to zero.

import type { CommuteMode, Priorities, SubScoreKey } from "@/lib/scoring/types";

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

// The commute option reads differently for transit riders; the other three don't depend on mode.
const COMMUTE_TEXT: Record<CommuteMode, string> = {
  drive: TEXT.commute,
  transit: "Spend about 20 minutes less on public transit each way",
};

// What a card option says, for the user's chosen way of getting to work.
export function optionText(key: SubScoreKey, mode: CommuteMode = "drive"): string {
  return key === "commute" ? COMMUTE_TEXT[mode] : TEXT[key];
}

// A card's identity regardless of which side each option is shown on.
export const pairKey = (c: { a: SubScoreKey; b: SubScoreKey }) => [c.a, c.b].sort().join("|");

// The six cards in a fresh random order, each with a random left/right side (D049).
// Fisher-Yates: every one of the 720 orders is equally likely, so each card is equally likely
// to come first, and each option is shown on the left half the time. `random` is injectable so
// tests can check the distribution.
export function shuffledDeck(random: () => number = Math.random): PairCard[] {
  const deck = PAIR_CARDS.map((c) => ({ ...c }));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.map((c) => (random() < 0.5 ? c : { a: c.b, b: c.a, aText: c.bText, bText: c.aText }));
}

// One answered card: which two options it offered and which one won.
export type Answer = { card: PairCard; winner: SubScoreKey | null };

// Slider values from the answers so far. Unanswered cards count as no win for either side; an
// answer that isn't one of the card's two options is ignored.
export function prioritiesFromAnswers(answers: Answer[]): Priorities {
  const wins: Priorities = { affordability: 0, commute: 0, safety: 0, risks: 0 };
  for (const { card, winner } of answers) {
    if (winner === card.a || winner === card.b) wins[winner] += 1;
  }
  return {
    affordability: 2 * (wins.affordability + 1),
    commute: 2 * (wins.commute + 1),
    safety: 2 * (wins.safety + 1),
    risks: 2 * (wins.risks + 1),
  };
}
