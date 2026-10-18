import { describe, expect, it } from "vitest";
import { PAIR_CARDS, prioritiesFromChoices } from "@/lib/priorities";
import type { SubScoreKey } from "@/lib/scoring/types";

describe("PAIR_CARDS", () => {
  it("covers every pair of the four priorities exactly once", () => {
    expect(PAIR_CARDS).toHaveLength(6);
    const pairs = PAIR_CARDS.map((c) => [c.a, c.b].sort().join("|"));
    expect(new Set(pairs).size).toBe(6);
    expect(PAIR_CARDS.every((c) => c.aText && c.bText && c.a !== c.b)).toBe(true);
  });
});

describe("prioritiesFromChoices", () => {
  it("maps wins 3,2,1,0 to sliders 8,6,4,2", () => {
    // commute beats everything, affordability beats safety and risks, safety beats risks
    const choices: SubScoreKey[] = ["commute", "affordability", "affordability", "commute", "commute", "safety"];
    expect(prioritiesFromChoices(choices)).toEqual({ commute: 8, affordability: 6, safety: 4, risks: 2 });
  });

  it("gives equal sliders when nothing is answered (the Balanced default)", () => {
    expect(prioritiesFromChoices([null, null, null, null, null, null])).toEqual({
      affordability: 2, commute: 2, safety: 2, risks: 2,
    });
  });

  it("ignores an answer that isn't one of the card's two options", () => {
    const choices: (SubScoreKey | null)[] = ["safety", null, null, null, null, null]; // card 0 is affordability vs commute
    expect(prioritiesFromChoices(choices)).toEqual({ affordability: 2, commute: 2, safety: 2, risks: 2 });
  });

  it("keeps every slider within 0..10", () => {
    const all: SubScoreKey[] = ["affordability", "affordability", "affordability", "commute", "commute", "safety"];
    const p = prioritiesFromChoices(all);
    expect(Object.values(p).every((v) => v >= 0 && v <= 10)).toBe(true);
  });
});
