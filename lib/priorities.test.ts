import { describe, expect, it } from "vitest";
import { optionText, PAIR_CARDS, pairKey, prioritiesFromAnswers, shuffledDeck, type Answer } from "@/lib/priorities";
import type { SubScoreKey } from "@/lib/scoring/types";

// Small seeded random generator (mulberry32), so the distribution test is repeatable.
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const card = (a: SubScoreKey, b: SubScoreKey) => PAIR_CARDS.find((c) => pairKey(c) === pairKey({ a, b }))!;

describe("PAIR_CARDS", () => {
  it("covers every pair of the four priorities exactly once (4 choose 2 = 6)", () => {
    expect(PAIR_CARDS).toHaveLength(6);
    expect(new Set(PAIR_CARDS.map(pairKey)).size).toBe(6);
    expect(PAIR_CARDS.every((c) => c.aText && c.bText && c.a !== c.b)).toBe(true);
  });

  it("shows each priority in exactly 3 cards", () => {
    for (const k of ["affordability", "commute", "safety", "risks"] as SubScoreKey[]) {
      expect(PAIR_CARDS.filter((c) => c.a === k || c.b === k)).toHaveLength(3);
    }
  });
});

describe("shuffledDeck", () => {
  it("always deals all six pairs, with each side's text matching its option", () => {
    const random = seeded(1);
    for (let n = 0; n < 50; n++) {
      const deck = shuffledDeck(random);
      expect(new Set(deck.map(pairKey))).toEqual(new Set(PAIR_CARDS.map(pairKey)));
      for (const c of deck) {
        const orig = card(c.a, c.b);
        expect(c.aText).toBe(orig.a === c.a ? orig.aText : orig.bText);
      }
    }
  });

  it("gives every card an equal chance at every position, and every option an equal chance on the left", () => {
    const runs = 60000;
    const random = seeded(42);
    const atPosition: Record<string, number[]> = Object.fromEntries(PAIR_CARDS.map((c) => [pairKey(c), [0, 0, 0, 0, 0, 0]]));
    const onLeft: Record<string, number> = { affordability: 0, commute: 0, safety: 0, risks: 0 };
    for (let n = 0; n < runs; n++) {
      shuffledDeck(random).forEach((c, i) => {
        atPosition[pairKey(c)][i] += 1;
        onLeft[c.a] += 1;
      });
    }
    // Expected: each card at each position 1/6 of the time; each option on the left in half of
    // its 3 appearances per deck. Allow 3% relative error at this sample size.
    for (const counts of Object.values(atPosition)) {
      for (const k of counts) expect(Math.abs(k / runs - 1 / 6)).toBeLessThan(0.005);
    }
    for (const k of Object.values(onLeft)) expect(Math.abs(k / (runs * 3) - 0.5)).toBeLessThan(0.015);
  });
});

describe("prioritiesFromAnswers", () => {
  it("maps wins 3,2,1,0 to sliders 8,6,4,2, whatever order the cards came in", () => {
    const answers: Answer[] = [
      { card: card("safety", "risks"), winner: "safety" },
      { card: card("commute", "risks"), winner: "commute" },
      { card: card("affordability", "commute"), winner: "commute" },
      { card: card("affordability", "risks"), winner: "affordability" },
      { card: card("commute", "safety"), winner: "commute" },
      { card: card("affordability", "safety"), winner: "affordability" },
    ];
    expect(prioritiesFromAnswers(answers)).toEqual({ commute: 8, affordability: 6, safety: 4, risks: 2 });
  });

  it("gives equal sliders when nothing is answered (the Balanced default)", () => {
    expect(prioritiesFromAnswers([])).toEqual({ affordability: 2, commute: 2, safety: 2, risks: 2 });
  });

  it("ignores an answer that isn't one of the card's two options", () => {
    expect(prioritiesFromAnswers([{ card: card("affordability", "commute"), winner: "safety" }])).toEqual({
      affordability: 2, commute: 2, safety: 2, risks: 2,
    });
  });

  it("keeps every slider within 0..10", () => {
    const answers: Answer[] = PAIR_CARDS.map((c) => ({ card: c, winner: c.a }));
    expect(Object.values(prioritiesFromAnswers(answers)).every((v) => v >= 0 && v <= 10)).toBe(true);
  });
});

describe("optionText", () => {
  it("words the commute option for the chosen way of getting to work", () => {
    expect(optionText("commute", "drive")).toBe("Drive about 20 minutes less each way");
    expect(optionText("commute", "transit")).toBe("Spend about 20 minutes less on public transit each way");
  });

  it("leaves the other options the same in both modes", () => {
    for (const k of ["affordability", "safety", "risks"] as SubScoreKey[]) {
      expect(optionText(k, "transit")).toBe(optionText(k, "drive"));
    }
  });
});
