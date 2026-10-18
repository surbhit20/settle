import { Pool } from "pg";

// Reads DATABASE_URL and fails loudly if it is missing, instead of letting
// pg silently fall back to localhost defaults.
export function getDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  const url = env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  }
  return url;
}

// One shared connection pool for the whole server process.
// `let` + a getter (instead of creating the Pool at import time) means
// importing this file never opens a connection, e.g. during `next build`.
let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: getDatabaseUrl() });
  }
  return pool;
}
