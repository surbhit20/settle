// Guards the Claude tool schemas against features the API's strict mode rejects. Both rules
// below came from real 400 errors (integer bounds in D036; enum on a ["string","null"] type in D038).
import { describe, expect, it } from "vitest";
import { TOOLS } from "@/lib/agent/claude";

type Node = Record<string, unknown>;

function problems(node: unknown, path: string, out: string[]): string[] {
  if (!node || typeof node !== "object") return out;
  const n = node as Node;
  if ("minimum" in n || "maximum" in n) out.push(`${path}: minimum/maximum not allowed in strict mode`);
  if ("enum" in n && Array.isArray(n.type)) out.push(`${path}: enum with a type array; use anyOf instead`);
  if (n.type === "object") {
    const props = Object.keys((n.properties as Node) ?? {});
    const required = (n.required as string[]) ?? [];
    if (n.additionalProperties !== false) out.push(`${path}: objects need additionalProperties: false`);
    for (const p of props) if (!required.includes(p)) out.push(`${path}.${p}: every property must be required`);
  }
  for (const [k, v] of Object.entries(n)) {
    if (k === "properties" && v && typeof v === "object") {
      for (const [pk, pv] of Object.entries(v as Node)) problems(pv, `${path}.${pk}`, out);
    } else if (k === "anyOf" && Array.isArray(v)) {
      v.forEach((x, i) => problems(x, `${path}.anyOf[${i}]`, out));
    } else if (k === "items") {
      problems(v, `${path}.items`, out);
    }
  }
  return out;
}

describe("Claude tool schemas (strict mode)", () => {
  it.each(TOOLS.map((t) => [t.name, t]))("%s uses only strict-mode-safe schema features", (_name, tool) => {
    const t = tool as { strict?: boolean; input_schema: unknown };
    expect(t.strict).toBe(true);
    expect(problems(t.input_schema, "input_schema", [])).toEqual([]);
  });

  it("the checker catches the two patterns that broke the API before", () => {
    expect(problems({ type: "integer", minimum: 0 }, "x", [])).toHaveLength(1);
    expect(problems({ type: ["string", "null"], enum: ["a", null] }, "x", [])).toHaveLength(1);
  });
});
