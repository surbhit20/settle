// Every routed chat message is logged so real numbers can be reported later (share handled
// without the LLM, median latency per route). Never invent these numbers: query agent_logs.

import { getPool } from "@/lib/db";
import type { ChatReply } from "@/lib/agent/types";

export async function logAgentMessage(message: string, reply: ChatReply): Promise<void> {
  await getPool().query(
    "INSERT INTO agent_logs (message, intent, confidence, route, latency_ms) VALUES ($1, $2, $3, $4, $5)",
    [message, reply.intent, reply.confidence, reply.route, reply.latencyMs],
  );
}

// Summary for reporting: share of messages answered without the LLM, and median latency per route.
export const AGENT_STATS_SQL = `
  SELECT route,
         count(*) AS messages,
         round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct_of_messages,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS median_latency_ms
  FROM agent_logs
  GROUP BY route
`;
