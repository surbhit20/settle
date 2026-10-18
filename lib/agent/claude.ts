// Claude fallback for the chat router (CLAUDE.md section 6.3): explains rankings using only the
// grounding context, and can emit the same structured actions as the fast path via tools.

import Anthropic from "@anthropic-ai/sdk";
import { ungroundedNumbers } from "@/lib/agent/grounding";
import type { AgentAction } from "@/lib/agent/types";

export const CLAUDE_MODEL = "claude-opus-5-5";

const SYSTEM = `You are the assistant inside Settle, an app that ranks San Francisco Bay Area ZIP code areas for one user.
Rules:
- Use ONLY numbers that appear in the CONTEXT JSON, and only for the area they belong to. Check each number against that area's entry before writing it; never write a number and then correct it. Never estimate or bring in outside figures. If a number isn't in the context, say you don't have it.
- When you state a number, name its source from the context (e.g. "per Zillow Research (ZORI)").
- Keep replies short: 2-5 sentences, plain text, no markdown headings.
- If the user wants to change their budget, max commute, salary, or priorities, call the matching tool. If they ask about specific areas, call select_area or compare_areas so the map shows them.
- Call any tools first, without commentary. After the tool results come back, write your complete answer in that final message (the user only sees the final message).
- Safety only exists for areas with city crime data; say so if asked about an area without it.`;

// Strict schemas: every field required, nullable where optional (strict mode needs additionalProperties: false
// and rejects minimum/maximum on integers, so ranges are in descriptions and toolToAction clamps).
const TOOLS: Anthropic.Beta.Messages.BetaTool[] = [
  {
    name: "update_filter",
    description: "Change the user's search filters. Pass null for anything that should stay the same.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        rent_budget_usd: { type: ["number", "null"], description: "New monthly rent budget in USD" },
        max_commute_min: { type: ["number", "null"], description: "New maximum commute in minutes" },
        salary_usd: { type: ["number", "null"], description: "New annual salary in USD" },
      },
      required: ["rent_budget_usd", "max_commute_min", "salary_usd"],
      additionalProperties: false,
    },
  },
  {
    name: "set_priority",
    description: "Set all four priority sliders (0 = don't care, 10 = care most).",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        affordability: { type: "integer", description: "0 to 10" },
        commute: { type: "integer", description: "0 to 10" },
        safety: { type: "integer", description: "0 to 10" },
        risks: { type: "integer", description: "0 to 10" },
      },
      required: ["affordability", "commute", "safety", "risks"],
      additionalProperties: false,
    },
  },
  {
    name: "compare_areas",
    description: "Show two or more areas side by side on the map. Use 5-digit ZIP codes from the context.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { zctas: { type: "array", items: { type: "string" } } },
      required: ["zctas"],
      additionalProperties: false,
    },
  },
  {
    name: "select_area",
    description: "Open one area's detail card on the map. Use a 5-digit ZIP code from the context.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { zcta: { type: "string" } },
      required: ["zcta"],
      additionalProperties: false,
    },
  },
];

// Tool call -> AgentAction. Pure, so it is unit tested. Unknown or empty calls are dropped.
export function toolToAction(name: string, input: Record<string, unknown>): AgentAction | null {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);
  switch (name) {
    case "update_filter": {
      const changes = {
        rentBudgetUsd: num(input.rent_budget_usd),
        maxCommuteMin: num(input.max_commute_min),
        salaryUsd: num(input.salary_usd),
      };
      const defined = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
      return Object.keys(defined).length ? { type: "update_filter", changes: defined } : null;
    }
    case "set_priority": {
      const keys = ["affordability", "commute", "safety", "risks"] as const;
      if (!keys.every((k) => typeof input[k] === "number")) return null;
      const p = Object.fromEntries(keys.map((k) => [k, Math.max(0, Math.min(10, input[k] as number))]));
      return { type: "set_priority", priorities: p as Record<(typeof keys)[number], number> };
    }
    case "compare_areas": {
      const zctas = Array.isArray(input.zctas) ? input.zctas.filter((z): z is string => /^\d{5}$/.test(String(z))) : [];
      return zctas.length >= 2 ? { type: "compare", zctas } : null;
    }
    case "select_area":
      return /^\d{5}$/.test(String(input.zcta)) ? { type: "select_area", zcta: String(input.zcta) } : null;
    default:
      return null;
  }
}

export type LlmResponder = (message: string, context: unknown) => Promise<{ reply: string; actions: AgentAction[] }>;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const workspace = process.env.ANTHROPIC_WORKSPACE_ID;
    // Keys not scoped to a workspace must name one (decisions.md D034).
    client = new Anthropic(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {});
  }
  return client;
}

const REFUSAL_REPLY = "Sorry, I can't help with that one. Try asking about rent, commute, safety, or risks.";
const MAX_TURNS = 3; // tool calls, then the answer, plus at most one grounding rewrite

export const claudeResponder: LlmResponder = async (message, context) => {
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
    { role: "user", content: `CONTEXT:\n${JSON.stringify(context)}\n\nUSER MESSAGE:\n${message}` },
  ];
  const actions: AgentAction[] = [];
  let lastText = ""; // the reply is the last turn's text; earlier turns only lead up to tool calls
  let rewrote = false;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Typed as the non-streaming params so `create` returns a full message, not a stream.
    const params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming = {
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      // Refusal fallback: on a safety decline the API re-runs the request on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // medium (this model's default): low effort sometimes attached a number to the wrong area (D036).
      output_config: { effort: "medium" },
      system: SYSTEM,
      tools: TOOLS,
      messages,
    };
    const response = await getClient().beta.messages.create(params);
    if (response.stop_reason === "refusal") return { reply: REFUSAL_REPLY, actions: [] };

    const toolResults: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
    const turnText = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    if (turnText) lastText = turnText;
    for (const block of response.content) {
      if (block.type === "tool_use") {
        const action = toolToAction(block.name, block.input as Record<string, unknown>);
        if (action) actions.push(action);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: action ? "Applied. The app is updating the map." : "Ignored: invalid input.",
          is_error: !action,
        });
      }
    }
    if (response.stop_reason !== "tool_use" || toolResults.length === 0) {
      // Grounding check: every number in the answer must come from CONTEXT. One rewrite allowed.
      const bad = ungroundedNumbers(lastText, context);
      if (bad.length === 0 || rewrote) break;
      rewrote = true;
      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: `Your reply contains numbers that are not in CONTEXT: ${bad.join(", ")}. Rewrite the whole reply using only numbers that appear in CONTEXT. Do not mention this correction.`,
      });
      continue;
    }
    // Append the whole assistant turn (thinking blocks included, unchanged), then all results
    // in one user message, and let Claude write its answer.
    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResults });
  }

  // If the rewrite still has ungrounded numbers, say so rather than presenting them as fact.
  const stillBad = lastText ? ungroundedNumbers(lastText, context) : [];
  if (stillBad.length) lastText += ` (Note: I couldn't verify ${stillBad.join(", ")} against the app's data.)`;
  const reply = lastText || (actions.length ? "Done. Updating the map." : "I'm not sure how to help with that.");
  return { reply, actions };
};
