// Deterministic check that Claude only states numbers present in its grounding context
// (CLAUDE.md section 6.3). Pure, so it is unit tested.

// Every number that appears in the context: JSON numbers and numbers inside strings
// (explanations like "About 17 min drive", addresses, ZIP codes).
export function contextNumbers(context: unknown): number[] {
  const out: number[] = [];
  const visit = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
    else if (typeof v === "string") out.push(...numbersIn(v));
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  visit(context);
  return out;
}

// "$4,486/mo", "29.9%", "1,000" -> 4486, 29.9, 1000.
export function numbersIn(text: string): number[] {
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, ""))).filter(Number.isFinite);
}

// A reply number is grounded if some context number equals it, or rounds to it at 0 or 1
// decimals (so "84.8" and "85" are both fine for 84.83). Single digits are skipped: they're
// mostly counting words ("five flags", "2 of 5") rather than data.
export function ungroundedNumbers(reply: string, context: unknown): number[] {
  const known = contextNumbers(context);
  const ok = (n: number) =>
    known.some((k) => k === n || Math.round(k) === n || Math.round(k * 10) / 10 === n || Math.abs(k * 100 - n) < 0.051);
  // The last check accepts shares stored as fractions (0.25) but written as percents (25%).
  return [...new Set(numbersIn(reply).filter((n) => n >= 10 || !Number.isInteger(n)).filter((n) => !ok(n)))];
}
